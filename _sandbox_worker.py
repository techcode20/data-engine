"""Child side of the sandbox: reads code.py (text) + in.pkl, execs clean(df),
writes out.parquet + status.json.

Runs with a scrubbed environment (no API keys) and an optional POSIX
resource cap. stdlib + pandas (+ pyarrow for the result write) only.
Never import this module — it is launched as a subprocess (or a
--network none container) by sandbox.py.

argv: code.py in.pkl out.parquet status.json
status.json is ALWAYS written (ok true/false) so the parent never hangs
waiting on it; the frame travels as parquet so the parent never unpickles
worker output.
"""
import json
import os
import pickle
import sys
import traceback


def _apply_limits():
    try:
        import resource
    except ImportError:
        return  # Windows: no setrlimit; timeout kill (parent side) is the guard
    try:
        mem = int(float(os.getenv("SANDBOX_MAX_RSS_BYTES", "0")))
    except ValueError:
        mem = 0
    if mem > 0:
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    try:
        cpu = int(float(os.getenv("SANDBOX_MAX_CPU_S", "0")))
    except ValueError:
        cpu = 0
    if cpu > 0:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))


def _write_status(status_path, ok, error=None):
    try:
        with open(status_path, "w", encoding="utf-8") as f:
            json.dump({"ok": ok, "error": error}, f)
    except Exception:
        pass  # parent treats a missing status as worker-died; never crash here


def main():
    code_path, in_path, out_path, status_path = sys.argv[1:5]
    try:
        with open(code_path, encoding="utf-8") as f:
            code = f.read()
        with open(in_path, "rb") as f:
            df = pickle.load(f)
        _apply_limits()
        import pandas as pd

        namespace = {"pd": pd}
        exec(code, namespace)
        result = namespace["clean"](df)
        if not isinstance(result, pd.DataFrame):
            _write_status(status_path, False,
                          f"SandboxError: clean() must return a pandas DataFrame, "
                          f"got {type(result).__name__}")
            return
        try:
            result.to_parquet(out_path)
        except ImportError as e:
            _write_status(status_path, False,
                          f"SandboxError: worker has no parquet engine ({e}); "
                          "the container/image needs pyarrow")
            return
        _write_status(status_path, True)
    except Exception:
        _write_status(status_path, False, traceback.format_exc())


if __name__ == "__main__":
    main()
