import pandas as pd
from gemini_client import generate

DEFAULT_SAMPLE_ROWS = 15


def get_sample(df: pd.DataFrame, n: int = DEFAULT_SAMPLE_ROWS, seed: int = 42) -> pd.DataFrame:
    """Adaptive sample: head rows plus a deterministic random slice.

    Pure head-sampling blinds inference to edge cases that only appear later
    in the file. Keeping the head (often the cleanest rows, good for the
    canonical shape) plus a seeded random draw covers both.
    """
    if n <= 0:
        raise ValueError("sample rows must be positive")
    if len(df) <= n:
        return df
    n_head = min(len(df), n // 2 + n % 2)
    n_rand = n - n_head
    head = df.head(n_head)
    rest = df.iloc[n_head:].sample(n=min(n_rand, len(df) - n_head), random_state=seed)
    return pd.concat([head, rest]).sort_index()


def infer_schema(df: pd.DataFrame, business_rules: str, sample_rows: int = DEFAULT_SAMPLE_ROWS, tag: str = "") -> str:
    sample = get_sample(df, sample_rows).to_csv(index=False)
    prompt = f"""You are a senior data engineer. Given this sample of raw CSV data:

{sample}

And these business rules:
{business_rules}

Propose a target schema as a JSON object, one key per column. For each column give:
- "type": exactly one of "int", "float", "str", "datetime", "bool" (nothing else)
- "nullable": true or false
- "unique": true or false
- "allowed_values": a JSON list of allowed strings if the business rules restrict this column to a fixed set (e.g. status codes, plan names). Omit this key entirely if there's no such restriction.
- "min_value": a number, only if the business rules imply a numeric floor (e.g. "must be non-negative" → 0). Omit if not applicable.
- "format_hint": for email-like columns, the string "email". Omit otherwise.
- "notes": any cleaning needed

Return ONLY the raw JSON object. No markdown fences, no explanation, no trailing commas."""
    return generate(prompt, purpose="infer_schema", tag=tag)
if __name__ == "__main__":
    from ingest import ingest
    df = ingest("sample_data.csv")
    rules = "customer_id is required and unique. name is required. plan must be one of FREE, BASIC, PRO. revenue must be numeric."
    schema_json = infer_schema(df, rules)
    print("\n--- PROPOSED SCHEMA ---")
    print(schema_json)