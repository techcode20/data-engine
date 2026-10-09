from unittest.mock import patch
import os
import pandas as pd
import pytest
from engine import process_one
from sandbox import _parquet_available

import code_cache
import schema_cache

# Every test here runs the retry loop, which executes a child: needs a
# working parquet engine (blocked by policy on some Windows boxes).
pytestmark = pytest.mark.skipif(
    not _parquet_available(),
    reason="no working parquet engine here (pyarrow blocked/missing)")


@pytest.fixture(autouse=True)
def _isolated_caches(tmp_path, monkeypatch):
    """Hermetic caches: never read/write the developer's real cache files."""
    monkeypatch.setattr(code_cache, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json"))
    monkeypatch.setattr(schema_cache, "CACHE_PATH", str(tmp_path / "schema_cache.json"))


def _write_temp_csv(tmp_path, content):
    p = tmp_path / "test_data.csv"
    p.write_text(content)
    return str(p)

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_succeeds_first_try(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n2,Bob\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false, "unique": true}, "name": {"type": "str", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"

    result = process_one(csv_path, "id is required and unique", retries=3, output_path=None)

    assert result["success"] is True
    assert result["attempts"] == 1

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_stops_when_model_repeats_itself(mock_schema_gen, mock_code_gen, tmp_path):
    # The model returns byte-identical code for the fix: retrying is pointless,
    # so the loop must stop early instead of burning all retries (A12).
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    return df"  # id stays a string, never becomes int

    result = process_one(csv_path, "id must be an integer", retries=5, output_path=None)

    assert result["success"] is False
    assert result["attempts"] == 1
    assert mock_code_gen.call_count == 2  # 1 generate + 1 fix, then repeat detected

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_succeeds_on_retry(mock_schema_gen, mock_code_gen, tmp_path):
    # Attempt 1 fails validation; the fix (different code) passes on attempt 2.
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.side_effect = [
        "def clean(df):\n    return df",  # attempt 1: id stays a string -> fail
        "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df",  # fixed
    ]

    result = process_one(csv_path, "id must be an integer", retries=3, output_path=None)

    assert result["success"] is True
    assert result["attempts"] == 2
    assert mock_code_gen.call_count == 2
    assert result["rows_in"] == 1 and result["rows_out"] == 1

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_strict_stops_after_first_failure(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    return df"

    result = process_one(csv_path, "id must be an integer", retries=5, output_path=None, strict=True)

    assert result["success"] is False
    assert result["attempts"] == 1
    assert mock_code_gen.call_count == 1  # initial generation only — no fix calls in strict mode

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_retries_on_sanity_failure(mock_schema_gen, mock_code_gen, tmp_path):
    # Schema passes (id becomes int) but the cleaner drops 4/5 rows -> sanity
    # failure must feed the retry loop like a validation failure. The two
    # attempts use DIFFERENT code so change-detection does not stop the loop.
    csv_path = _write_temp_csv(tmp_path, "id\n1\n2\n3\n4\n5\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.side_effect = [
        "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df.iloc[:1]  # v1",
        "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df.iloc[:1]  # v2",
    ]

    result = process_one(csv_path, "id must be an integer", retries=2, output_path=None)

    assert result["success"] is False
    assert result["attempts"] == 2
    assert mock_code_gen.call_count == 2  # 1 generate + 1 fix; no fix after the final attempt

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_reuses_cached_code_with_zero_llm_calls(mock_schema_gen, mock_code_gen, tmp_path):
    import code_cache
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n2,Bob\n")
    schema = '{"id": {"type": "int", "nullable": false, "unique": true}, "name": {"type": "str", "nullable": false}}'
    rules = "id is required and unique"
    mock_schema_gen.return_value = schema
    cached = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"
    with patch.object(code_cache, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json")):
        code_cache.set_cached_code(schema, rules, cached)
        result = process_one(csv_path, rules, retries=3, output_path=None)

    assert result["success"] is True
    assert result["attempts"] == 1
    assert mock_code_gen.call_count == 0  # code came from cache — zero codegen calls
    assert result["usage"]["calls"] == 0

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_falls_back_to_fresh_generation_on_stale_cache(mock_schema_gen, mock_code_gen, tmp_path):
    import code_cache
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n")
    schema = '{"id": {"type": "int", "nullable": false}}'
    rules = "id must be an integer"
    mock_schema_gen.return_value = schema
    mock_code_gen.return_value = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"
    stale = "def clean(df):\n    return df"  # id stays string -> fails validation
    with patch.object(code_cache, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json")):
        code_cache.set_cached_code(schema, rules, stale)
        result = process_one(csv_path, rules, retries=2, output_path=None)

    assert result["success"] is True
    assert result["attempts"] == 2
    assert mock_code_gen.call_count == 1  # one fresh generation, no fix calls for stale cache

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_budget_guard_stops_retries(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    return df"  # always fails
    big_spend = {"calls": 5, "prompt_tokens": 10_000_000,
                 "completion_tokens": 5_000_000, "total_tokens": 15_000_000}
    rates = {"GEMINI_PRICE_INPUT_PER_MTOK": "1.0", "GEMINI_PRICE_OUTPUT_PER_MTOK": "2.0"}
    with patch.dict(os.environ, rates):
        with patch("engine.usage_totals", return_value=big_spend):
            result = process_one(csv_path, "id must be an integer", retries=5,
                                 output_path=None, max_cost_usd=0.01)

    assert result["success"] is False
    assert result["attempts"] == 1
    assert result["budget_stopped"] is True
    assert mock_code_gen.call_count == 1  # initial generation only — no paid fix calls

@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_smart_parse_reduces_llm_work(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_temp_csv(tmp_path, "id,revenue\n1, $49.99 \n2,$10\n")
    schema = '{"id": {"type": "int", "nullable": false}, "revenue": {"type": "float", "nullable": false}}'
    rules = "smart parse demo rules"
    mock_schema_gen.return_value = schema
    # Trivial code: only casts id. Passes iff smart-parse already made revenue numeric.
    mock_code_gen.return_value = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"

    good = process_one(csv_path, rules, retries=1, output_path=None, smart_parse_cols=True)
    assert good["success"] is True
    assert good["attempts"] == 1

    bad = process_one(csv_path, rules, retries=1, output_path=None, smart_parse_cols=False)
    assert bad["success"] is False