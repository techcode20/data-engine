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