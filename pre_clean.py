"""Deterministic pre-clean pass: zero-LLM normalization applied to every dataset.

Runs inside engine.process_one right after ingest, before schema inference,
so the model sees (and the schema is inferred from) already-tidied data.
All operations are dtype-preserving and information-preserving except the
explicit removal of wholly-empty rows:

- strip leading/trailing whitespace on string columns (counts cells changed)
- map empty / whitespace-only strings to NaN (uniform missing-value signal)
- drop rows that are entirely NaN (nothing to clean there)
"""
import pandas as pd


def pre_clean(df: pd.DataFrame, drop_empty_rows: bool = True) -> tuple[pd.DataFrame, dict]:
    df = df.copy()
    report = {"cells_stripped": 0, "empties_to_nan": 0, "rows_dropped": 0}

    str_cols = list(df.select_dtypes(include=["object", "string"]).columns)
    for col in str_cols:
        # Element-wise on purpose: .str.strip() would coerce non-string
        # objects (e.g. lists from flattened JSON) to NaN.
        original = df[col]
        stripped = original.map(lambda v: v.strip() if isinstance(v, str) else v)
        changed = (stripped.ne(original) & original.notna()).sum()
        report["cells_stripped"] += int(changed)
        df[col] = stripped
        emptied = (df[col] == "").sum()
        report["empties_to_nan"] += int(emptied)
        df[col] = df[col].mask(df[col] == "")

    if drop_empty_rows:
        before = len(df)
        df = df.dropna(how="all").reset_index(drop=True)
        report["rows_dropped"] = before - len(df)

    return df, report


def format_report(report: dict) -> str:
    parts = []
    if report["cells_stripped"]:
        parts.append(f"{report['cells_stripped']} cells stripped")
    if report["empties_to_nan"]:
        parts.append(f"{report['empties_to_nan']} empties→NaN")
    if report["rows_dropped"]:
        parts.append(f"{report['rows_dropped']} empty rows dropped")
    return ", ".join(parts) if parts else "already tidy"
