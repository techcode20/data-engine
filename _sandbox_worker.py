"""Child side of the sandbox: unpickles {code, df}, execs clean(df), pickles the result.

Runs with a scrubbed environment (no API keys) and an optional POSIX
resource cap. stdlib + pandas only. Never import this module — it is
launched as a subprocess by sandbox.py.
"""
import pickle
import sys
import traceback


def _apply_limits():
    try:
        import resource
    except ImportError:
        return  # Windows: no setrlimit; timeout kill (parent side) is the guard
    try:
        mem = int(float(__import__("os").getenv("SANDBOX_MAX_RSS_BYTES", "0")))
    except ValueError:
        mem = 0
    if mem > 0:
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    cpu = int(float(__import__("os").getenv("SANDBOX_MAX_CPU_S", "0")))
    if cpu > 0:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    try:
        with open(inp, "rb") as f:
            payload = pickle.load(f)
        _apply_limits()
        import pandas as pd

        namespace = {"pd": pd}
        exec(payload["code"], namespace)
        result = namespace["clean"](payload["df"])
        with open(outp, "wb") as f:
            pickle.dump({"ok": True, "df": result}, f)
    except Exception:
        with open(outp, "wb") as f:
            pickle.dump({"ok": False, "error": traceback.format_exc()}, f)


if __name__ == "__main__":
    main()
