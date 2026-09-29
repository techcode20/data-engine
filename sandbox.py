import pandas as pd
import traceback

def run_generated_code(code_str: str, df: pd.DataFrame):
    """Execute model-generated code in a restricted namespace and capture errors."""
    namespace = {"pd": pd}
    try:
        exec(code_str, namespace)          # defines clean() inside namespace
        clean_fn = namespace["clean"]
        result_df = clean_fn(df.copy())    # never mutate the original
        return result_df, None
    except Exception:
        error_trace = traceback.format_exc()
        return None, error_trace