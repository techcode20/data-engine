"""Y1+Y2: run-history lineage gaps.

Y1: entries carry run_id but no input_hash, so identical re-runs cannot be
    told apart from distinct runs over different data (idempotency gap).
Y2: trends.py counts dry-run SKIP entries (success=None) as failures,
    depressing pass rates for runs that never executed anything.
"""
import json

from run_summary import write_summary
from trends import summarize_by_dataset


def test_history_entries_carry_input_hash(tmp_path, monkeypatch):
    import run_summary

    monkeypatch.setattr(run_summary, "SUMMARY_PATH", str(tmp_path / "run_summary.json"))
    write_summary(
        [{"file": "a.csv", "success": True, "attempts": 1}],
        run_id="abc123",
    )
    entry = json.loads((tmp_path / "run_summary.json").read_text())[0]
    assert entry["run_id"] == "abc123"
    assert entry.get("input_hash"), "no content fingerprint — reruns are indistinguishable"


def test_trends_does_not_count_skips_as_failures():
    history = [{
        "timestamp": "t",
        "results": [
            {"file": "a.csv", "success": True, "attempts": 1},
            {"file": "b.csv", "success": None, "attempts": 0},  # dry-run SKIP
        ],
    }]
    stats = summarize_by_dataset(history)
    assert stats["a.csv"]["passes"] == 1
    # SKIP must be excluded from the denominator, not scored as a failure.
    assert stats["b.csv"]["runs"] == 0
