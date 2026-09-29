from gemini_client import generate
from fix_memory import load_past_fixes, format_fixes_for_prompt
def generate_transform_code(schema_json: str, business_rules: str) -> str:
    past_fixes = format_fixes_for_prompt(load_past_fixes())
    prompt = f"""You are a senior Python data engineer. Write a single Python function:

def clean(df):
    # your code here
    return df

It must take a pandas DataFrame matching this raw schema and target schema:
{schema_json}

Business rules: {business_rules}

Here are fixes from past runs on other datasets — avoid repeating these same mistakes if they apply here:
{past_fixes}

Requirements:
- Handle mixed date formats using pd.to_datetime with errors='coerce'
- Strip currency symbols and convert to float
- Normalize string casing where relevant (e.g. uppercase plan names)
- Drop or flag rows missing required fields — do not crash on bad data
- Cast EVERY column to its exact target pandas dtype as the LAST step before return:
  int -> df[col].astype('int64') (via pd.to_numeric(errors='coerce') + dropna first),
  float -> df[col].astype('float64'),
  bool -> map raw values with True/False strings, 1/0 and 1.0/0.0 to Python bool then .astype('bool') (never leave as 'boolean' or object),
  str -> df[col].astype('str'), datetime -> pd.to_datetime(errors='coerce').
  Validation checks exact numpy dtypes, so 'boolean' vs 'bool' or object vs str WILL FAIL — finish with df.astype with a column-to-dtype dict using int64/float64/bool/str/datetime64[ns].
- Do NOT include import statements other than pandas as pd, which is already imported
- Return ONLY the raw Python code for the function, no markdown fences, no explanation, no example usage"""
    code = generate(prompt).strip()
    if code.startswith("```"):
        code = code.split("```")[1]
        if code.startswith("python"):
            code = code[len("python"):]
    return code.strip()
def fix_transform_code(broken_code: str, error_info: str, schema_json: str) -> str:
    prompt = f"""You are a senior Python data engineer. This function was supposed to clean a DataFrame to match a target schema, but it has a problem.

BROKEN CODE:
{broken_code}

TARGET SCHEMA:
{schema_json}

THE PROBLEM (either a Python exception or a validation failure report):
{error_info}

Fix the function. Return ONLY the corrected raw Python code for the function
def clean(df):
    ...
No markdown fences, no explanation, no example usage. Keep everything that already worked — only change what's needed to fix this specific problem."""
    code = generate(prompt).strip()
    if code.startswith("```"):
        code = code.split("```")[1]
        if code.startswith("python"):
            code = code[len("python"):]
    return code.strip()