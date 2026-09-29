from unittest.mock import patch
from code_gen import generate_transform_code, fix_transform_code

FAKE_CODE_RESPONSE = """```python
def clean(df):
    return df
```"""

@patch("code_gen.generate")
def test_generate_transform_code_strips_markdown_fences(mock_generate):
    mock_generate.return_value = FAKE_CODE_RESPONSE
    result = generate_transform_code('{"col": {"type": "str"}}', "col is required")
    assert result.strip() == "def clean(df):\n    return df"
    assert "```" not in result

@patch("code_gen.generate")
def test_generate_transform_code_passes_plain_code_through(mock_generate):
    mock_generate.return_value = "def clean(df):\n    return df"
    result = generate_transform_code('{"col": {"type": "str"}}', "col is required")
    assert result == "def clean(df):\n    return df"

@patch("code_gen.generate")
def test_fix_transform_code_calls_model_with_error_context(mock_generate):
    mock_generate.return_value = "def clean(df):\n    return df.dropna()"
    broken_code = "def clean(df):\n    return df['missing_col']"
    result = fix_transform_code(broken_code, "KeyError: 'missing_col'", '{"col": {"type": "str"}}')
    assert result == "def clean(df):\n    return df.dropna()"
    # confirm the error message actually made it into the prompt sent to the model
    sent_prompt = mock_generate.call_args[0][0]
    assert "KeyError" in sent_prompt
    assert "missing_col" in sent_prompt