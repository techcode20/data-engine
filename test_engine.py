from unittest.mock import patch
import pandas as pd
from engine import process_one

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
def test_process_one_gives_up_after_max_retries(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_temp_csv(tmp_path, "id,name\n1,Alice\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    # code that will always fail validation no matter how many times we "fix" it
    mock_code_gen.return_value = "def clean(df):\n    return df"  # id stays a string, never becomes int

    result = process_one(csv_path, "id must be an integer", retries=2, output_path=None)

    assert result["success"] is False
    assert result["attempts"] == 2
    assert mock_code_gen.call_count == 3  # 1 initial generation + 1 fix per failed attempt (2 attempts)

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
    # failure must feed the retry loop like a validation failure.
    csv_path = _write_temp_csv(tmp_path, "id\n1\n2\n3\n4\n5\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df.iloc[:1]"

    result = process_one(csv_path, "id must be an integer", retries=2, output_path=None)

    assert result["success"] is False
    assert result["attempts"] == 2
    assert mock_code_gen.call_count == 3

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