"""Allowlist gate + the three sandbox exploits, replayed.

E1 — file write through a gap in the old denylist: ``df.to_hdf`` /
  ``pd.HDFStore`` were never denied, so the old gate APPROVED them.
E2 — class-definition smuggling: the old gate never modeled ClassDef, so
  class bodies / decorators (which execute at definition time) slipped past.
E3 — pickle deserialization RCE on the result path: the parent used to
  ``pickle.load`` worker output, so a hostile ``__reduce__`` gadget in the
  result executed in the PARENT. Results now travel as parquet + JSON.

Gate-only tests run everywhere. Anything that executes a child needs a
working parquet engine (blocked by policy on some Windows boxes) and is
marked — it runs on CI/Linux.
"""
import io
import json
import os
import pickle
import shutil

import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

import sandbox
from sandbox import _parquet_available, _read_result, gate_code, run_generated_code

needs_parquet = pytest.mark.skipif(
    not _parquet_available(),
    reason="no working parquet engine here (pyarrow blocked/missing) — runs on CI/Linux")

DF = pd.DataFrame({"x": [1, 2]})

GOOD_CODE = "def clean(df):\n    df['x'] = df['x'] * 2\n    return df"


# --- allowlist approvals (must stay usable for real cleaning) ---------------

@pytest.mark.parametrize("good", [
    GOOD_CODE,
    "def clean(df):\n    def _fix(v):\n        return v\n    df['x'] = df['x'].map(_fix)\n    return df",
    "def clean(df):\n    try:\n        df['x'] = df['x'].astype(int)\n    except ValueError as e:\n        raise ValueError(f'bad: {e}')\n    return df",
    "def clean(df):\n    assert isinstance(df, pd.DataFrame)\n    n = (y := len(df))\n    del df['x']\n    return df",
    "def clean(df):\n    g = df.groupby('x')['x'].sum().reset_index()\n    return df.merge(g, on='x')",
    "def clean(df):\n    d = pd.get_dummies(df['x'])\n    t = pd.Timestamp('2020-01-01')\n    df['n'] = pd.NA\n    return pd.concat([df, d], axis=1)",
    "def clean(df):\n    df['b'] = pd.cut(df['x'], bins=2)\n    agg = df.groupby('x').agg(total=pd.NamedAgg(column='x', aggfunc='sum'))\n    return df",
    "def clean(df):\n    xs = [v * 2 for v in df['x'] if v]\n    seen = {v for v in xs}\n    return df",
])
def test_gate_approves_allowlisted_cleaning_idioms(good):
    assert gate_code(good) == []


# --- allowlist rejections ----------------------------------------------------

@pytest.mark.parametrize("evil,fragment", [
    ("def clean(df):\n    class E:\n        pass\n    return df", "class definitions"),
    ("def clean(df):\n    @dec\n    class E:\n        pass\n    return df", "class definitions"),
    ("def clean(df):\n    class E(pd.DataFrame):\n        pass\n    return df", "class definitions"),
    ("def clean(df):\n    async def h():\n        pass\n    return df", "async"),
    ("def clean(df):\n    global x\n    return df", "global"),
    ("def clean(df):\n    yield df\n", "generators"),
    ("def clean(df):\n    return pd.read_csv('/etc/passwd')", "pd.read_csv"),
    ("def clean(df):\n    s = pd.HDFStore('/tmp/x.h5')\n    return df", "pd.HDFStore"),
    ("def clean(df):\n    return pd.to_hdf(df, 'x')", "to_hdf"),
    ("def clean(df):\n    x = pd.options.display.max_rows\n    return df", "pd.options"),
    ("def clean(df):\n    return pd.api.types.is_list_like([1])", "pd.api"),
    ("def clean(df):\n    df['x'] = np.nan\n    return df", "'np'"),
    ("def clean(df):\n    df.to_hdf('/tmp/x.h5', key='x')\n    return df", "to_hdf"),
    ("def clean(df):\n    df.to_sql('t', 'sqlite:///x.db')\n    return df", "to_sql"),
    ("def clean(df):\n    df.to_latex('/tmp/x.tex')\n    return df", "to_latex"),
    ("def clean(df):\n    open('x', 'w')\n    return df", "open"),
    ("def clean(df):\n    return eval('df')", "eval"),
    ("def clean(df):\n    c = compile('1', 's', 'eval')\n    return df", "compile"),
    ("def clean(df):\n    t = type(df)\n    return df", "type"),
    ("def clean(df):\n    d = dir(df)\n    return df", "dir"),
    ("x = 1", "no top-level function clean"),
    ("def clean(df):\n    __x = 1\n    return df", "__x"),
])
def test_gate_rejects_non_allowlisted_code(evil, fragment):
    violations = gate_code(evil)
    assert violations, f"gate approved hostile code ({fragment})"
    assert any(fragment in v for v in violations), f"{fragment!r} not in {violations}"
    # Rejection happens before anything executes — engine-independent.
    out, err = run_generated_code(evil, DF)
    assert out is None and err is not None and "SandboxRejected" in err


# --- E1: file write through the old denylist gap ------------------------------

@pytest.mark.parametrize("evil,target", [
    ("def clean(df):\n    df.to_hdf(TARGET, key='x')\n    return df", "pwn.h5"),
    ("def clean(df):\n    s = pd.HDFStore(TARGET)\n    s.close()\n    return df", "pwn2.h5"),
])
def test_exploit_file_write_now_fails(evil, target, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # relative TARGET lands here, never in the repo
    evil = evil.replace("TARGET", repr(target))
    out, err = run_generated_code(evil, DF)
    assert out is None and err is not None and "SandboxRejected" in err
    assert not os.path.exists(target), "exploit wrote a file!"


# --- E2: class-definition smuggling --------------------------------------------

@pytest.mark.parametrize("evil", [
    "def clean(df):\n    class E:\n        x = 1\n    return df",
    "def clean(df):\n    fired = []\n    @fired.append\n    class E:\n        pass\n    return df",
    "def clean(df):\n    class E(pd.DataFrame):\n        pass\n    return df",
])
def test_exploit_class_definition_now_fails(evil):
    out, err = run_generated_code(evil, DF)
    assert out is None and err is not None and "SandboxRejected" in err
    assert "class definitions" in err


# --- E3: pickle gadget on the result path ---------------------------------------

class _EvilReduce:
    """Stands in for a hostile worker result: unpickling runs open()."""
    def __init__(self, path):
        self.path = path

    def __reduce__(self):
        return (open, (self.path, "w"))


def test_exploit_pickle_gadget_potency(tmp_path):
    """Control: the gadget REALLY executes under pickle.load (non-vacuous)."""
    sentinel = str(tmp_path / "pwned.txt")
    blob = pickle.dumps({"ok": True, "df": _EvilReduce(sentinel)})
    assert not os.path.exists(sentinel)
    pickle.loads(blob)
    assert os.path.exists(sentinel), "gadget did not fire — control is vacuous"
    os.remove(sentinel)


def test_exploit_pickle_gadget_never_executes_on_result_path(tmp_path):
    """Same bytes where out.parquet should be: no execution, clean error."""
    sentinel = str(tmp_path / "pwned.txt")
    blob = pickle.dumps({"ok": True, "df": _EvilReduce(sentinel)})
    (tmp_path / "out.parquet").write_bytes(blob)
    (tmp_path / "status.json").write_text(json.dumps({"ok": True}))
    out, err = _read_result(str(tmp_path), "")
    assert out is None and err is not None and "parquet" in err
    assert not os.path.exists(sentinel), "PICKLE GADGET EXECUTED on the result path"


def test_result_path_never_unpickles():
    """Structural invariant: no pickle.load in the parent result path."""
    src = open(sandbox.__file__, encoding="utf-8").read()
    assert "pickle.load" not in src, "parent must never unpickle worker output"


# --- transport fidelity (needs a live engine) ------------------------------------

@needs_parquet
def test_parquet_round_trip_preserves_frame_exactly():
    df = pd.DataFrame({
        "i": [1, 2], "f": [1.5, None], "s": ["a", "=1+1"],
        "b": [True, False],
        "d": pd.to_datetime(["2020-01-01", "bad"], errors="coerce"),
    })
    buf = io.BytesIO()
    df.to_parquet(buf)
    buf.seek(0)
    assert_frame_equal(pd.read_parquet(buf), df)


# --- docker backend ---------------------------------------------------------------

def test_docker_cmd_is_locked_down(tmp_path):
    argv = sandbox._docker_cmd("img:1", str(tmp_path), "pf-test")
    assert argv[:7] == ["docker", "run", "--rm", "--pull", "never", "--network", "none"]
    assert "--privileged" not in argv
    assert argv.count("-v") == 2  # workdir + single worker file, never the whole repo
    vol_srcs = [argv[i + 1].rsplit(":", 1)[0] for i, a in enumerate(argv) if a == "-v"]
    assert any(p.endswith("_sandbox_worker.py") for p in vol_srcs)
    assert "img:1" in argv
    assert "/app/_sandbox_worker.py" in argv
    assert "none" in argv[argv.index("--network") + 1]


def test_docker_cmd_memory_cap_opt_in(monkeypatch, tmp_path):
    monkeypatch.setenv("SANDBOX_MAX_RSS_BYTES", "134217728")
    argv = sandbox._docker_cmd("img:1", str(tmp_path), "pf-test")
    assert "--memory" in argv and "134217728" in argv


def test_docker_mode_needs_image(monkeypatch):
    monkeypatch.delenv("SANDBOX_DOCKER_IMAGE", raising=False)
    out, err = run_generated_code(GOOD_CODE, DF, backend="docker")
    assert out is None and "SANDBOX_DOCKER_IMAGE" in err


def test_docker_mode_missing_binary_fails_loudly(monkeypatch):
    monkeypatch.setenv("SANDBOX_DOCKER_IMAGE", "img:1")
    monkeypatch.setattr(sandbox.shutil, "which", lambda *_a, **_k: None)
    out, err = run_generated_code(GOOD_CODE, DF, backend="docker")
    assert out is None and "no docker binary" in err


def test_docker_mode_unknown_backend_rejected():
    out, err = run_generated_code(GOOD_CODE, DF, backend="lxc")
    assert out is None and "unknown backend" in err


@pytest.mark.skipif(
    shutil.which("docker") is None or not os.getenv("SANDBOX_DOCKER_IMAGE"),
    reason="live docker run is operator opt-in (needs daemon + image with pandas/pyarrow)")
def test_docker_backend_executes_trivial_code():
    out, err = run_generated_code(GOOD_CODE, DF, backend="docker", timeout=240)
    assert err is None, err
    assert list(out["x"]) == [2, 4]
