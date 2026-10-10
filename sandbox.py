"""Sandbox for model-generated cleaning code.

Defense in depth (see SECURITY notes in README):

1. Allowlist AST gate — every function is statically scanned BEFORE it runs.
   Only these survive: ``pd.<allowlisted>`` names, methods/attributes on the
   dataframe (or values derived from it) except known file-writing methods,
   a small set of pure builtins, and names bound inside the function itself.
   A second layer scans interpreted strings: string arguments naming a
   blocked method are rejected (dict keys and print() text are data, not
   code, and stay allowed); agg/apply/transform accept only a fixed set of
   aggregation names; path-like keyword names (buf, fname, …) are rejected.
   Everything else — imports, class definitions, unknown names or calls,
   dunder access — is rejected without executing anything.
2. Process isolation — approved code runs in a child Python process (or an
   optional Docker container with ``--network none``) with a scrubbed
   environment (no *API_KEY*/*SECRET*/*TOKEN*), a foreign cwd, a kill-on-
   timeout, and POSIX memory/CPU caps where available.
3. Data-only result transport — the child returns the frame as PARQUET plus
   a small JSON status file. The parent NEVER unpickles worker output, so a
   hostile ``__reduce__`` gadget in the result path cannot execute here.

Residual risk (documented): the input frame still travels parent→child as
pickle (dump direction is safe — unpickling is where gadgets fire — and the
loader is the sacrificial child); the child shares the filesystem with the
user in subprocess mode; treat hostile datasets like hostile input — use
--strict, review --dry-run output, and prefer containers for truly
untrusted sources. Static analysis limits: composed strings (``"to_" +
"csv"``, f-string joints) are not constant-folded, and a dict bound to a
name (``d = {"a": "to_csv"}; df.agg(d)``) is not traced — single-constant
aliases (``fn = "mean"``) are. Anything downstream of those residuals still
faces the subprocess/docker boundary and the data-only result transport.
"""
import ast
import json
import os
import pickle
import shutil
import subprocess
import sys
import tempfile
import uuid
from functools import lru_cache

import pandas as pd

WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_sandbox_worker.py")

DEFAULT_TIMEOUT_S = 120

# pd.* names a cleaning function may touch. Deliberately data-only: no
# readers (read_*), no writers, no config mutation (set_option), no
# introspection (api), no test/plotting/io namespaces. Anything else under
# ``pd.`` is rejected — a bare ``pd.HDFStore(...)`` or ``pd.read_csv(...)``
# must never slip past the gate again.
_PD_ALLOWLIST = frozenset({
    "to_datetime", "to_numeric", "to_timedelta",
    "DataFrame", "Series", "Index", "MultiIndex", "RangeIndex",
    "Categorical", "CategoricalDtype", "StringDtype",
    "NA", "NaT", "isna", "notna", "isnull", "notnull",
    "concat", "merge", "cut", "qcut", "get_dummies", "crosstab",
    "pivot_table", "pivot", "melt", "factorize", "unique",
    "Timestamp", "Timedelta", "date_range", "bdate_range",
    "period_range", "interval_range", "Interval", "IntervalIndex",
    "Period", "PeriodIndex", "DatetimeIndex", "TimedeltaIndex",
    "Grouper", "NamedAgg",
})

# Pure builtins + the exception types model code plausibly raises.
# Everything else (open/eval/exec/getattr/globals/type/...) is rejected by
# omission — this is the point of an allowlist over the old denylist.
_BUILTIN_ALLOWLIST = frozenset({
    "print", "len", "range", "str", "int", "float", "bool",
    "list", "dict", "set", "tuple", "frozenset",
    "min", "max", "sum", "abs", "round", "pow", "divmod",
    "enumerate", "zip", "sorted", "reversed", "map", "filter",
    "any", "all", "isinstance",
    "ValueError", "TypeError", "KeyError", "IndexError",
    "AttributeError", "Exception",
})

# Method names that are never legitimate on a cleaning path, whatever object
# they hang off. Two families: (1) file-writers — the gate cannot tell
# ``df.to_json()`` (harmless string) from ``df.to_json(path)`` (file write),
# so the whole family is out, including via accessors (Styler.to_excel) and
# figures (Figure.savefig — ``df.plot().get_figure().savefig(...)`` writes);
# (2) string-evaluating / arbitrary-call methods — ``df.eval``/``df.query``
# run string code through pandas' expression engine (a sandbox of its own
# with a history of escapes), and ``df.pipe`` invokes an arbitrary callable.
_DF_FILE_METHODS = frozenset({
    "to_csv", "to_json", "to_excel", "to_parquet", "to_sql",
    "to_html", "to_clipboard", "to_pickle", "to_feather",
    "to_orc", "to_stata", "to_hdf", "to_latex", "to_markdown",
    "to_string", "savefig",
})
_DF_EVAL_METHODS = frozenset({"eval", "query", "pipe"})
# Pure in-memory siblings (to_dict, to_records, to_numpy) stay allowed.
# ``df.style``/``df.plot`` ACCESSORS stay allowed: render()/show() return
# strings/axes (no files, no string-eval); their dangerous sub-methods are
# caught above by name.
_DF_IO_METHODS = _DF_FILE_METHODS | _DF_EVAL_METHODS


class SandboxRejected(Exception):
    """Raised when generated code fails the static gate (never executed)."""


def _bound_names(tree: ast.AST) -> set:
    """Names bound inside the code: args, assignments, loop/comprehension
    targets, with/except/namedexpr bindings, and nested def names (so a
    helper or a recursive ``clean`` passes the Name check — their BODIES
    are still walked and gated)."""
    bound = set()

    def _bind_target(t):
        for n in ast.walk(t):
            if isinstance(n, ast.Name):
                bound.add(n.id)

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not isinstance(node, ast.AsyncFunctionDef):
                bound.add(node.name)
            a = node.args
            for arg in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs):
                bound.add(arg.arg)
            if a.vararg:
                bound.add(a.vararg.arg)
            if a.kwarg:
                bound.add(a.kwarg.arg)
        elif isinstance(node, ast.Lambda):
            a = node.args
            for arg in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs):
                bound.add(arg.arg)
            if a.vararg:
                bound.add(a.vararg.arg)
            if a.kwarg:
                bound.add(a.kwarg.arg)
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            targets = getattr(node, "targets", None)
            if targets is None:
                targets = [node.target]
            for t in targets:
                _bind_target(t)
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
            _bind_target(node.target)
        elif isinstance(node, ast.With):
            for item in node.items:
                if item.optional_vars is not None:
                    _bind_target(item.optional_vars)
        elif isinstance(node, ast.ExceptHandler):
            if node.name:
                bound.add(node.name)
    bound.discard("")
    return bound


def _attr_chain_root(node: ast.Attribute):
    """Innermost value of an attribute chain (``a.b.c`` → Name ``a``),
    or None when the chain grows out of a call/subscript instead."""
    v = node.value
    while isinstance(v, ast.Attribute):
        v = v.value
    return v if isinstance(v, ast.Name) else None


def _attr_violation(attr: str, node: ast.Attribute) -> str | None:
    """Allowlist check for any attribute access or method call."""
    if attr.startswith("_"):
        return f"dunder/private attribute .{attr} is not allowed"
    if attr in _DF_FILE_METHODS:
        return f".{attr}(...) file-writing access is not allowed"
    if attr in _DF_EVAL_METHODS:
        return f".{attr}(...) string-evaluation access is not allowed"
    root = _attr_chain_root(node)
    if root is not None and root.id == "pd" and attr not in _PD_ALLOWLIST:
        return f"pd.{attr} is not on the allowlist"
    return None


# Aggregation names a cleaning function may pass to agg/aggregate/apply/
# transform. Anything else in that position is either a blocked method
# smuggled as a string ("to_csv") or an unknown callable.
_AGG_FUNCS = frozenset({
    "sum", "mean", "min", "max", "count", "first", "last", "median", "nunique",
})
_AGG_METHODS = frozenset({"agg", "aggregate", "apply", "transform"})

# Keyword names that can reference files. Checked on every call regardless
# of method — no legitimate cleaning idiom writes through these.
_PATH_KWARGS = frozenset({
    "path_or_buf", "buf", "fname", "excel_writer",
    "filepath", "filepath_or_buffer", "filename", "file_path",
})


def _norm_str(s: str) -> str:
    return s.strip().lower()


def _string_aliases(tree: ast.AST) -> dict:
    """Names bound once to a plain string constant: fn = "mean". One step
    of alias resolution so df.agg(fn) is judged by the string's content."""
    aliases = {}
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            aliases[node.targets[0].id] = node.value.value
    return aliases


def _arg_strings(node: ast.AST):
    """String constants under a call argument. Dict KEYS are skipped (column
    names and rename mappings are identifiers, never interpreted); dict
    values, list elements, and f-string literal parts are checked."""
    if isinstance(node, ast.Dict):
        for v in node.values:
            yield from _arg_strings(v)
        return
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        yield node.value
        return
    for child in ast.iter_child_nodes(node):
        yield from _arg_strings(child)


def _resolve_value(node: ast.AST, aliases: dict):
    """Resolve an agg-spec argument to a string when it trivially is one;
    None otherwise (lambdas, calls, unresolvable names — their bodies are
    gated separately, so they pass this check)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return aliases.get(node.id)
    return None


def _check_agg_spec(arg: ast.AST, aliases: dict) -> str | None:
    """Violation message for a non-conforming agg/apply/transform function
    spec, else None. Containers recurse (dict values only — keys skipped)."""
    if isinstance(arg, (ast.List, ast.Tuple)):
        for e in arg.elts:
            bad = _check_agg_spec(e, aliases)
            if bad:
                return bad
        return None
    if isinstance(arg, ast.Dict):
        for v in arg.values:
            bad = _check_agg_spec(v, aliases)
            if bad:
                return bad
        return None
    s = _resolve_value(arg, aliases)
    if s is None:
        return None
    n = _norm_str(s)
    if n in _AGG_FUNCS:
        return None
    if n in _DF_IO_METHODS or n.startswith("to_"):
        return f"string '{s}' would resolve to a blocked method"
    return (f"agg/apply/transform function must be one of "
            f"{sorted(_AGG_FUNCS)}, got '{s}'")


def gate_code(code_str: str) -> list[str]:
    """Static allowlist scan. Returns violations (empty = approved to run).

    Never raises — arbitrary model text must produce a list, not a crash.
    """
    try:
        tree = ast.parse(code_str)
    except Exception as e:  # SyntaxError, ValueError (null bytes), ...
        return [f"syntax error: {e}"]
    violations = []
    if not any(isinstance(n, ast.FunctionDef) and n.name == "clean"
               for n in tree.body):
        return ["no top-level function clean(df) defined"]
    bound = _bound_names(tree)
    aliases = _string_aliases(tree)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            violations.append("import statements are not allowed (pd is pre-imported)")
        elif isinstance(node, ast.ClassDef):
            violations.append("class definitions are not allowed")
        elif isinstance(node, ast.AsyncFunctionDef):
            violations.append("async functions are not allowed")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            violations.append("global/nonlocal statements are not allowed")
        elif isinstance(node, (ast.Yield, ast.YieldFrom)):
            violations.append("generators are not allowed (clean must return a DataFrame)")
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                if func.id not in _BUILTIN_ALLOWLIST and func.id not in bound:
                    violations.append(f"call to {func.id}() is not allowed")
                fname = func.id
            elif isinstance(func, ast.Attribute):
                bad = _attr_violation(func.attr, func)
                if bad:
                    violations.append(bad)
                fname = func.attr
            else:
                fname = ""
            for kw in node.keywords:
                if kw.arg in _PATH_KWARGS:
                    violations.append(f"keyword argument '{kw.arg}' can reference files")
            # String arguments are checked where they can be interpreted.
            # print() text is never interpreted (exempt); dict keys are
            # identifiers, skipped inside _arg_strings.
            if fname != "print":
                for a in list(node.args) + [kw.value for kw in node.keywords]:
                    for s in _arg_strings(a):
                        if _norm_str(s) in _DF_IO_METHODS:
                            violations.append(f"string '{s}' matches a blocked method")
            if (isinstance(func, ast.Attribute) and func.attr in _AGG_METHODS
                    and node.args):
                bad = _check_agg_spec(node.args[0], aliases)
                if bad:
                    violations.append(bad)
        elif isinstance(node, ast.Attribute):
            bad = _attr_violation(node.attr, node)
            if bad:
                violations.append(bad)
        elif isinstance(node, ast.Name):
            if node.id.startswith("__"):
                violations.append(f"name '{node.id}' is not allowed")
            elif (node.id not in bound and node.id != "pd"
                    and node.id not in _BUILTIN_ALLOWLIST):
                violations.append(f"name '{node.id}' is not allowed")
    # De-duplicate while preserving order.
    return list(dict.fromkeys(violations))


def _scrubbed_env() -> dict:
    """Child environment: enough for Python to run, none of your secrets."""
    keep = {"SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "OS",
            "PYTHONHOME", "PYTHONPATH", "PYTHONIOENCODING", "LANG", "LC_ALL"}
    banned = ("API_KEY", "SECRET", "TOKEN", "PASSWORD", "PRIVATE_KEY", "AWS_", "AZURE_")
    env = {k: v for k, v in os.environ.items()
           if k in keep or k.startswith("SANDBOX_")}
    return {k: v for k, v in env.items() if not any(b in k.upper() for b in banned)}


def _timeout_s() -> float:
    try:
        return float(os.getenv("SANDBOX_TIMEOUT_S", str(DEFAULT_TIMEOUT_S)))
    except ValueError:
        return float(DEFAULT_TIMEOUT_S)


@lru_cache(maxsize=1)
def _parquet_available() -> bool:
    """Probe a real round-trip: pyarrow may import while its _parquet DLL is
    blocked by policy (seen under Device Guard) — only a live write+read
    proves the transport works."""
    try:
        import io as _io
        buf = _io.BytesIO()
        pd.DataFrame({"probe": [1]}).to_parquet(buf)
        buf.seek(0)
        pd.read_parquet(buf)
        return True
    except Exception:
        return False


def _docker_cmd(image: str, tmpdir: str, container_name: str) -> list:
    """argv for the containerized child. Single-file worker mount (never the
    whole repo — that would expose .env/secrets to hostile code), no network,
    no implicit pulls, no privileged flag, memory cap when configured."""
    work = tmpdir.replace("\\", "/")
    worker = WORKER.replace("\\", "/")
    cmd = ["docker", "run", "--rm", "--pull", "never", "--network", "none",
           "--name", container_name,
           "-v", f"{work}:/work",
           "-v", f"{worker}:/app/_sandbox_worker.py:ro"]
    try:
        mem = int(float(os.getenv("SANDBOX_MAX_RSS_BYTES", "0")))
    except ValueError:
        mem = 0
    if mem > 0:
        cmd += ["--memory", str(mem)]
    cmd += [image, "python", "/app/_sandbox_worker.py",
            "/work/code.py", "/work/in.pkl",
            "/work/out.parquet", "/work/status.json"]
    return cmd


def _check_docker() -> str | None:
    """Return an error string when docker mode is misconfigured, else None."""
    if not os.getenv("SANDBOX_DOCKER_IMAGE", ""):
        return "SANDBOX_BACKEND=docker needs SANDBOX_DOCKER_IMAGE set"
    if shutil.which("docker") is None:
        return "SANDBOX_BACKEND=docker but no docker binary on PATH"
    return None


def _launch(tmpdir: str, backend: str, timeout: float):
    """Run the worker; return (proc-ish, stderr_text).

    Docker mode never falls back to subprocess — a silent downgrade would
    void the operator's explicit isolation choice; missing binary or image
    is a loud error instead.
    """
    code_p = os.path.join(tmpdir, "code.py")
    in_p = os.path.join(tmpdir, "in.pkl")
    out_p = os.path.join(tmpdir, "out.parquet")
    status_p = os.path.join(tmpdir, "status.json")
    if backend == "docker":
        bad = _check_docker()
        if bad:
            raise RuntimeError(bad)
        image = os.getenv("SANDBOX_DOCKER_IMAGE", "")
        name = f"pf-sandbox-{uuid.uuid4().hex[:12]}"
        argv = _docker_cmd(image, tmpdir, name)
        try:
            proc = subprocess.run(argv, capture_output=True, text=True,
                                  timeout=timeout, env=_scrubbed_env())
        except subprocess.TimeoutExpired:
            # Killing the CLI does not stop the container — kill by name,
            # best effort, then report the timeout like subprocess mode.
            for mop in (["docker", "kill", name], ["docker", "rm", "-f", name]):
                try:
                    subprocess.run(mop, capture_output=True, timeout=30)
                except Exception:
                    pass
            raise
        return proc, (proc.stderr or "")
    proc = subprocess.run(
        [sys.executable, WORKER, code_p, in_p, out_p, status_p],
        capture_output=True, text=True,
        timeout=timeout, cwd=tmpdir, env=_scrubbed_env(),
    )
    return proc, (proc.stderr or "")


def _read_result(tmpdir: str, stderr_tail: str):
    """Data-only result read: JSON status first, parquet frame only on ok.

    Worker output is never deserialized with pickle on this path — a
    hostile payload sitting where out.parquet should be raises from the
    parquet reader instead of executing.
    """
    try:
        with open(os.path.join(tmpdir, "status.json"), encoding="utf-8") as f:
            status = json.load(f)
    except Exception:
        return None, f"SandboxError: worker died without a result\n{stderr_tail[-2000:]}"
    if not isinstance(status, dict) or not status.get("ok"):
        err = status.get("error", "unknown worker failure") if isinstance(status, dict) else "unreadable status"
        return None, err if isinstance(err, str) else str(err)
    try:
        result = pd.read_parquet(os.path.join(tmpdir, "out.parquet"))
    except Exception as e:
        return None, f"SandboxError: result is not valid parquet: {e}"
    if not isinstance(result, pd.DataFrame):
        return None, (
            "SandboxError: clean() must return a pandas DataFrame, "
            f"got {type(result).__name__}"
        )
    return result, None


def run_generated_code(code_str: str, df: pd.DataFrame, timeout=None, backend=None):
    """Execute model-generated code in an isolated child process.

    Returns (DataFrame, None) on success, (None, error_text) otherwise —
    including gate rejections, crashes, non-DataFrame returns, and timeouts.
    ``backend`` overrides SANDBOX_BACKEND ("subprocess"|"docker").
    """
    violations = gate_code(code_str)
    if violations:
        return None, "SandboxRejected: " + "; ".join(violations)

    if timeout is None:
        timeout = _timeout_s()
    backend = backend or os.getenv("SANDBOX_BACKEND", "subprocess")
    if backend not in ("subprocess", "docker"):
        return None, f"SandboxError: unknown backend {backend!r} (want subprocess|docker)"
    if backend == "docker":
        # Misconfiguration must fail here — engine-independently — never as
        # a confusing parquet/timeout error three steps later.
        bad = _check_docker()
        if bad:
            return None, f"SandboxError: {bad}"
    if not _parquet_available():
        return None, ("SandboxError: no working parquet engine (pyarrow missing "
                      "or its DLL blocked) — refusing pickle fallback for results")

    tmpdir = tempfile.mkdtemp(prefix="pf_sandbox_")
    try:
        with open(os.path.join(tmpdir, "code.py"), "w", encoding="utf-8") as f:
            f.write(code_str)
        # Dump direction only: the loader is the sacrificial child, and the
        # frame was built by our own ingest (plain dtypes + strings).
        with open(os.path.join(tmpdir, "in.pkl"), "wb") as f:
            pickle.dump(df, f)
    except Exception as e:
        return None, f"SandboxRejected: input not serializable: {e}"

    try:
        _, stderr_tail = _launch(tmpdir, backend, timeout)
    except subprocess.TimeoutExpired:
        return None, f"SandboxTimeout: clean() exceeded {timeout:g}s and was killed"
    except RuntimeError as e:
        return None, f"SandboxError: {e}"
    except Exception as e:
        return None, f"SandboxError: could not launch worker: {e}"

    return _read_result(tmpdir, stderr_tail)
