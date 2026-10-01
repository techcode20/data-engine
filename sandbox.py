"""Sandbox for model-generated cleaning code.

Defense in depth (see SECURITY notes in README):

1. AST gate — every function is statically scanned BEFORE it runs. Imports,
   file/network/process primitives, dynamic evaluation and dunder access are
   rejected without executing anything.
2. Subprocess isolation — approved code runs in a child Python process with a
   scrubbed environment (no *API_KEY*/*SECRET*/*TOKEN*), a foreign cwd, a
   kill-on-timeout, and POSIX memory/CPU caps where available.
3. Result check — only a pandas DataFrame comes back; anything else is
   treated as a failure, never validated.

Residual risk (documented): the child shares the filesystem with the user, so
treat hostile datasets like hostile input — use --strict, review --dry-run
output, and prefer containers for truly untrusted sources.
"""
import ast
import os
import pickle
import subprocess
import sys
import tempfile

import pandas as pd

WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_sandbox_worker.py")

DEFAULT_TIMEOUT_S = 120

# Calls that are never legitimate in a cleaning function.
_DENY_CALLS = frozenset({
    "eval", "exec", "open", "compile", "__import__", "input",
    "globals", "locals", "vars", "dir", "help", "exit", "quit",
    "breakpoint", "memoryview", "getattr", "setattr", "delattr",
    "hasattr", "type", "super", "object",
})
# Attribute roots that escape the DataFrame world (files, OS, network, loader).
_DENY_ATTRS = frozenset({
    "read_csv", "read_json", "read_excel", "read_parquet", "read_sql",
    "read_html", "read_clipboard", "read_pickle", "read_feather",
    "read_orc", "read_sas", "read_spss", "read_stata",
    "to_csv", "to_json", "to_excel", "to_parquet", "to_sql",
    "to_html", "to_clipboard", "to_pickle", "to_feather", "to_orc",
    "to_stata", "system", "popen", "spawn", "exec", "run", "call",
})
# Bare names that must never appear (modules + interpreter hooks).
_DENY_NAMES = frozenset({
    "os", "sys", "subprocess", "socket", "shutil", "pathlib",
    "importlib", "builtins", "__builtins__", "io", "pickle",
    "requests", "urllib", "http", "ctypes", "multiprocessing",
    "threading", "pty", "signal",
})


class SandboxRejected(Exception):
    """Raised when generated code fails the static gate (never executed)."""


def gate_code(code_str: str) -> list[str]:
    """Static scan. Returns a list of violations (empty = approved to run)."""
    try:
        tree = ast.parse(code_str)
    except SyntaxError as e:
        return [f"syntax error: {e}"]
    violations = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            violations.append("import statements are not allowed (pd is pre-imported)")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in _DENY_CALLS:
                violations.append(f"call to {node.func.id}() is not allowed")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in _DENY_ATTRS:
                violations.append(f".{node.func.attr}(...) file/process access is not allowed")
            if node.func.attr.startswith("_"):
                violations.append(f"dunder/private attribute .{node.func.attr} is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                violations.append(f"dunder/private attribute .{node.attr} is not allowed")
        elif isinstance(node, ast.Name):
            if node.id in _DENY_NAMES:
                violations.append(f"name '{node.id}' is not allowed")
            if node.id.startswith("__"):
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


def run_generated_code(code_str: str, df: pd.DataFrame, timeout=None):
    """Execute model-generated code in an isolated child process.

    Returns (DataFrame, None) on success, (None, error_text) otherwise —
    including gate rejections, crashes, non-DataFrame returns, and timeouts.
    """
    violations = gate_code(code_str)
    if violations:
        return None, "SandboxRejected: " + "; ".join(violations)

    if timeout is None:
        timeout = _timeout_s()
    tmpdir = tempfile.mkdtemp(prefix="pf_sandbox_")
    inp = os.path.join(tmpdir, "in.pkl")
    outp = os.path.join(tmpdir, "out.pkl")
    try:
        with open(inp, "wb") as f:
            pickle.dump({"code": code_str, "df": df}, f)
    except Exception as e:
        return None, f"SandboxRejected: input not serializable: {e}"

    try:
        proc = subprocess.run(
            [sys.executable, WORKER, inp, outp],
            capture_output=True, text=True,
            timeout=timeout, cwd=tmpdir, env=_scrubbed_env(),
        )
    except subprocess.TimeoutExpired:
        return None, f"SandboxTimeout: clean() exceeded {timeout:g}s and was killed"
    except Exception as e:
        return None, f"SandboxError: could not launch worker: {e}"

    try:
        with open(outp, "rb") as f:
            payload = pickle.load(f)
    except Exception:
        stderr = (proc.stderr or "")[-2000:]
        return None, f"SandboxError: worker died without a result\n{stderr}"

    if not payload.get("ok"):
        return None, payload.get("error", "SandboxError: unknown worker failure")
    result = payload.get("df")
    if not isinstance(result, pd.DataFrame):
        return None, (
            "SandboxError: clean() must return a pandas DataFrame, "
            f"got {type(result).__name__}"
        )
    return result, None
