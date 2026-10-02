import os
import subprocess
import sys

import dashboard


def test_summarize_excludes_dry_run_skips():
    history = [{
        "timestamp": "t",
        "results": [
            {"file": "a.csv", "success": True, "attempts": 1,
             "usage": {"total_tokens": 100}},
            {"file": "b.csv", "success": False, "attempts": 5,
             "usage": {"total_tokens": 200}},
            {"file": "c.csv", "success": None, "attempts": 0,
             "usage": {"total_tokens": 50}},
        ],
    }]
    stats = dashboard.summarize(history)
    assert stats["total_results"] == 2
    assert stats["passes"] == 1
    assert stats["pass_rate"] == 50.0
    assert stats["total_tokens"] == 300
    assert set(stats["per_ds"]) == {"a.csv", "b.csv"}
    assert stats["per_ds"]["a.csv"]["fail"] == 0
    assert stats["per_ds"]["b.csv"]["fail"] == 1


def test_load_json_missing_returns_default(tmp_path):
    assert dashboard.load_json("does-not-exist.json", {"x": 1}) == {"x": 1}


def test_load_fix_log_caps_entries(tmp_path, monkeypatch):
    monkeypatch.setattr(dashboard, "HERE", str(tmp_path))
    with open(tmp_path / "fix_log.jsonl", "w") as f:
        for i in range(20):
            f.write('{"timestamp": "t", "dataset": "d", "attempt": 1, "error": "e", "fix": "f"}\n')
    assert len(dashboard.load_fix_log(limit=15)) == 15


def test_dashboard_builds_valid_html(tmp_path):
    out = str(tmp_path / "dashboard.html")
    r = subprocess.run([sys.executable, "dashboard.py", "--out", out],
                       capture_output=True, text=True, cwd=os.path.dirname(dashboard.__file__))
    assert r.returncode == 0, r.stderr
    content = open(out, encoding="utf-8").read()
    for marker in ("Data Engine Dashboard", "Datasets", "Latest runs", "Recent self-corrections"):
        assert marker in content
