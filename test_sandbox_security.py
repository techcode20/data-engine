"""Security battery for the sandbox: nothing hostile may execute.

Covers B1 (escape primitives), B2 (timeout kill), B12 (env scrub).
Legitimate cleaning code must keep passing — see the eval fixtures check.
"""
import glob
import os

import pandas as pd
import pytest

from sandbox import _parquet_available, gate_code, run_generated_code

DF = pd.DataFrame({"x": [1, 2]})

# Executes a child — engine-independent gate tests below stay unmarked.
needs_parquet = pytest.mark.skipif(
    not _parquet_available(),
    reason="no working parquet engine here (pyarrow blocked/missing)")


@pytest.mark.parametrize("evil,reason", [
    ("def clean(df):\n    import os\n    return df", "import"),
    ("def clean(df):\n    import pandas as pd\n    return df", "even pandas import (pd pre-imported)"),
    ("def clean(df):\n    open('x', 'w')\n    return df", "open()"),
    ("def clean(df):\n    return eval('df')", "eval"),
    ("def clean(df):\n    exec('x = 1')\n    return df", "exec"),
    ("def clean(df):\n    import subprocess\n    return df", "subprocess import"),
    ("def clean(df):\n    import socket\n    return df", "socket import"),
    ("def clean(df):\n    x = __import__('os')\n    return df", "dunder import"),
    ("def clean(df):\n    return df.__class__", "dunder attribute"),
    ("def clean(df):\n    return df.__dict__", "dunder dict"),
    ("def clean(df):\n    f = getattr(df, 'copy')\n    return f()", "getattr"),
    ("def clean(df):\n    x = globals()\n    return df", "globals"),
    ("def clean(df):\n    x = os.environ\n    return df", "os name"),
    ("def clean(df):\n    return pd.read_csv('/etc/passwd')", "pd.read_csv"),
    ("def clean(df):\n    df.to_csv('/tmp/x.csv')\n    return df", "df.to_csv"),
    ("def clean(df):\n    df.to_pickle('/tmp/x.pkl')\n    return df", "df.to_pickle"),
    ("def clean(df):\n    return df.to_json()", "df.to_json"),
    ("def clean(df):\n    __x = 1\n    return df", "dunder name"),
])
def test_gate_rejects_hostile_code_without_executing(evil, reason):
    violations = gate_code(evil)
    assert violations, f"gate approved hostile code ({reason})"
    out, err = run_generated_code(evil, DF)
    assert out is None and err is not None and "SandboxRejected" in err


@needs_parquet
@pytest.mark.parametrize("good", [
    "def clean(df):\n    df['x'] = df['x'] * 2\n    return df",
    "def clean(df):\n    df = df.dropna()\n    return df.astype({'x': 'int64'})",
    "def clean(df):\n    df['d'] = pd.to_datetime(df['x'], format='mixed', errors='coerce')\n    return df",
    "def clean(df):\n    m = {'a': 1}\n    df['y'] = df['x'].map(m)\n    f = lambda v: v + 1\n    df['z'] = df['x'].apply(f)\n    return df",
    "def clean(df):\n    print('debug')\n    return df",
])
def test_gate_approves_legitimate_cleaning_code(good):
    assert gate_code(good) == []
    out, err = run_generated_code(good, DF)
    assert err is None and out is not None


def test_gate_rejects_syntax_errors():
    assert gate_code("def clean(df):\n  oops [[[") != []


@needs_parquet
def test_timeout_kills_hung_code():
    out, err = run_generated_code(
        "def clean(df):\n    while True:\n        pass", DF, timeout=3)
    assert out is None
    assert err is not None and "Timeout" in err


def test_child_env_scrubs_secrets_but_keeps_runtime():
    from sandbox import _scrubbed_env
    import os as _os

    fake = {"GEMINI_API_KEY": "sk", "MY_SECRET": "s", "AUTH_TOKEN": "t",
            "AWS_KEY": "a", "SYSTEMROOT": "C:/x", "PATH": "p", "SANDBOX_TIMEOUT_S": "9"}
    old = dict(_os.environ)
    try:
        _os.environ.clear()
        _os.environ.update(fake)
        scrubbed = _scrubbed_env()
    finally:
        _os.environ.clear()
        _os.environ.update(old)
    for leaked in ("GEMINI_API_KEY", "MY_SECRET", "AUTH_TOKEN", "AWS_KEY"):
        assert leaked not in scrubbed
    for kept in ("SYSTEMROOT", "PATH", "SANDBOX_TIMEOUT_S"):
        assert scrubbed.get(kept) == fake[kept]


def test_all_eval_fixture_solutions_pass_the_gate():
    repo = os.path.dirname(os.path.abspath(__file__))
    files = glob.glob(os.path.join(repo, "eval_fixtures", "*.clean.py"))
    assert files, "no eval fixtures found"
    for path in files:
        with open(path, encoding="utf-8") as f:
            code = f.read()
        assert gate_code(code) == [], f"gate rejects checked-in solution {path}"
