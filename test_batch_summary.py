"""Batch survival, summary semantics, exit codes (A13-A15)."""
from unittest.mock import patch

from engine import process_one, summarize_results


def _csv(tmp_path, content="id,name\n1,Alice\n"):
    p = tmp_path / "t.csv"
    p.write_text(content)
    return str(p)


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_batch_survives_one_crashed_dataset(mock_schema_gen, mock_code_gen, tmp_path, monkeypatch):
    import code_cache
    import schema_cache
    monkeypatch.setattr(code_cache, "CODE_CACHE_PATH", str(tmp_path / "cc.json"))
    monkeypatch.setattr(schema_cache, "CACHE_PATH", str(tmp_path / "sc.json"))
    mock_schema_gen.return_value = '{"id": {"type": "int"}}'
    mock_code_gen.return_value = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"

    good = process_one(_csv(tmp_path, "id\n1\n"), "id int", retries=2, output_path=None)
    assert good["success"] is True
    # A missing file becomes a FAIL result, not an exception (batch survives).
    bad = process_one(str(tmp_path / "missing.csv"), "id int", retries=2, output_path=None)
    assert bad["success"] is False
    assert "error" in bad and bad["attempts"] == 0


def test_summarize_reports_skip_pass_fail(capsys):
    results = [
        {"file": "a.csv", "success": True, "attempts": 1},
        {"file": "b.csv", "success": False, "attempts": 5, "error": "boom"},
        {"file": "c.csv", "success": None, "attempts": 0},
    ]
    failed = summarize_results(results)
    out = capsys.readouterr().out
    assert failed == ["b.csv"]  # dry-run SKIP never counts as failure
    assert "SKIP" in out and "PASS" in out and "FAIL" in out
    assert "boom" in out


def test_load_config_rejects_bad_numerics(tmp_path):
    from engine import load_config
    import pytest as _pt

    p = tmp_path / "c.yaml"
    p.write_text('file: "a.csv"\nrules: "r"\nretries: 0\n')
    with _pt.raises(ValueError, match="retries"):
        load_config(str(p))
    p.write_text('file: "a.csv"\nrules: "r"\nmax_drop: 5\n')
    with _pt.raises(ValueError, match="max_drop"):
        load_config(str(p))
    p.write_text('file: "a.csv"\nrules: "r"\noutput: "../evil.csv"\n')
    with _pt.raises(ValueError, match="parent escape"):
        load_config(str(p))
