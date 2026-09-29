import pandas as pd
from sandbox import run_generated_code

def test_sandbox_runs_valid_code():
    code = "def clean(df):\n    df['x'] = df['x'] * 2\n    return df"
    df = pd.DataFrame({"x": [1, 2, 3]})
    result_df, error = run_generated_code(code, df)
    assert error is None
    assert list(result_df["x"]) == [2, 4, 6]

def test_sandbox_captures_broken_code():
    code = "def clean(df):\n    return df['this_column_does_not_exist']"
    df = pd.DataFrame({"x": [1, 2, 3]})
    result_df, error = run_generated_code(code, df)
    assert result_df is None
    assert error is not None
    assert "this_column_does_not_exist" in error or "KeyError" in error

def test_sandbox_does_not_mutate_original_df():
    code = "def clean(df):\n    df['x'] = 999\n    return df"
    df = pd.DataFrame({"x": [1, 2, 3]})
    original_values = list(df["x"])
    run_generated_code(code, df)
    assert list(df["x"]) == original_values  # original untouched