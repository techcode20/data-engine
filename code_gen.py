from gemini_client import generate
from fix_memory import load_past_fixes, format_fixes_for_prompt
def generate_transform_code(schema_json: str, business_rules: str, tag: str = "") -> str:
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
- Handle mixed date formats using pd.to_datetime with format="mixed" and errors='coerce' (pandas 3 infers one format per Series — without format="mixed", valid dates in other formats silently become NaT)
- Strip currency symbols and convert to float
- Keep EVERY input column in the output unless the rules say to drop it:
  derived columns (splits, extracts) are ADDED alongside the originals,
  never replacements — dropping a required column fails validation.
- When splitting a string column into new columns, split on a delimiter
  VERIFIED against the actual values (e.g. "A-B" splits on '-', not '_'),
  and never index the split result positionally: rows missing the delimiter
  yield fewer columns and crash with KeyError. Guard the width (e.g. check
  the split frame has the expected columns) or use str.extract with a regex.
- Normalize string casing where relevant (e.g. uppercase plan names)
- Drop or flag rows missing required fields — do not crash on bad data
- Cast EVERY column to its exact target pandas dtype as the LAST step before return:
  int -> df[col].astype('int64') (via pd.to_numeric(errors='coerce') + dropna first),
  float -> df[col].astype('float64'),
  bool -> map raw values with True/False strings, 1/0 and 1.0/0.0 to Python bool then .astype('bool') (never leave as 'boolean' or object),
  str -> df[col].astype('str'), datetime -> pd.to_datetime(errors='coerce').
  Validation checks exact numpy dtypes, so 'boolean' vs 'bool' or object vs str WILL FAIL — finish with df.astype with a column-to-dtype dict using int64/float64/bool/str/datetime64[ns].
- Do NOT include import statements other than pandas as pd, which is already imported
- Sandbox rules (violations are rejected WITHOUT running): no import statements
  at all, no open()/eval()/exec()/getattr(), no file or network access
  (pd.read_*/df.to_* are blocked), no dunder/private attributes.
  No df.eval/df.query/df.pipe; agg/apply/transform take only
  sum/mean/min/max/count/first/last/median/nunique; string arguments must
  never name file methods (nothing starting with to_); avoid path-like
  keyword names (path_or_buf, buf, fname)
- Return ONLY the raw Python code for the function, no markdown fences, no explanation, no example usage"""
    code = (generate(prompt, purpose="generate_code", tag=tag) or "").strip()
    if not code:
        raise ValueError("empty model response for code generation")
    if code.startswith("```"):
        code = code.split("```")[1]
        if code.startswith("python"):
            code = code[len("python"):]
    return code.strip()
def fix_transform_code(broken_code: str, error_info: str, schema_json: str, tag: str = "",
                     sample_csv: str = "") -> str:
    sample_block = ""
    if sample_csv.strip():
        sample_block = f"""
RAW SAMPLE (first rows of the actual input — the failing code ran against THESE values,
not imagined ones; diagnose against them):
{sample_csv}
"""
    prompt = f"""You are a senior Python data engineer. This function was supposed to clean a DataFrame to match a target schema, but it has a problem.

BROKEN CODE:
{broken_code}

TARGET SCHEMA:
{schema_json}
{sample_block}
THE PROBLEM (either a Python exception or a validation failure report):
{error_info}

Fix the function. Return ONLY the corrected raw Python code for the function
def clean(df):
    ...
No markdown fences, no explanation, no example usage. Keep everything that already worked — only change what's needed to fix this specific problem.
When the traceback points at string splitting or positional indexing, verify the delimiter against the actual
cell values first — a wrong or missing delimiter (fewer split columns than indexed) is the usual cause.
Sandbox rules: no imports, no open()/eval()/exec()/getattr(), no file or network calls, no dunder attributes,
no df.eval/df.query/df.pipe, agg/apply/transform only with sum/mean/min/max/count/first/last/median/nunique."""
    code = (generate(prompt, purpose="fix_code", tag=tag) or "").strip()
    if not code:
        raise ValueError("empty model response for code fix")
    if code.startswith("```"):
        code = code.split("```")[1]
        if code.startswith("python"):
            code = code[len("python"):]
    return code.strip()