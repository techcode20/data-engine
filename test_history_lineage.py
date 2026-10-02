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
    import code_cache
    import schema_cache
    from unittest.mock import patch
    from engine import process_one

    monkeypatch.setattr(run_summary, "SUMMARY_PATH", str(tmp_path / "run_summary.json"))
    monkeypatch.setattr(code_cache, "CODE_CACHE_PATH", str(tmp_path / "cc.json"))
    monkeypatch.setattr(schema_cache, "CACHE_PATH", str(tmp_path / "sc.json"))
    p = tmp_path / "a.csv"
    p.write_text("id\n1\n")
    schema = '{"id": {"type": "int"}}'
    code = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"
    with patch("code_gen.generate", return_value=code), \
         patch("schema_inference.generate", return_value=schema):
        first = process_one(str(p), "id int", retries=1, output_path=None)
    assert first["success"] is True
    write_summary([first], run_id="abc123")
    entry = json.loads((tmp_path / "run_summary.json").read_text())[0]
    assert entry["run_id"] == "abc123"
    h1 = entry["results"][0].get("input_hash")
    assert h1, "no content fingerprint — reruns are indistinguishable"

    # Same path+rules over CHANGED content must hash differently.
    p.write_text("id\n1\n2\n")
    with patch("code_gen.generate", return_value=code), \
         patch("schema_inference.generate", return_value=schema):
        second = process_one(str(p), "id int", retries=1, output_path=None)
    assert second["input_hash"] != h1


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
