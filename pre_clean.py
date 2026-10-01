"""Deterministic pre-clean pass: zero-LLM normalization applied to every dataset.

Runs inside engine.process_one right after ingest, before schema inference,
so the model sees (and the schema is inferred from) already-tidied data.
All operations are dtype-preserving and information-preserving except the
explicit removal of wholly-empty rows:

- strip leading/trailing whitespace on string columns (counts cells changed)
- map empty / whitespace-only strings to NaN (uniform missing-value signal)
- drop rows that are entirely NaN (nothing to clean there)

Opt-in second stage, smart_parse(): best-effort currency/datetime parsing.
A column converts ONLY if every non-null value parses — otherwise it is left
byte-identical. Never touches non-string dtypes or non-string objects.
"""
import pandas as pd

CURRENCY_RE = r"-?\$?[\d,]*\.?\d+"


def try_parse_currency(series: pd.Series) -> tuple[pd.Series, bool]:
    """'$1,234.56' / '49.99' -> float64 (Int64 when all integral). All-or-nothing."""
    non_null = series.dropna()
    if non_null.empty:
        return series, False
    text = non_null.astype(str)
    if not text.str.fullmatch(CURRENCY_RE).all():
        return series, False
    try:
        nums = pd.to_numeric(
            text.str.replace("$", "", regex=False).str.replace(",", "", regex=False),
            errors="raise",
        )
    except (ValueError, TypeError):
        return series, False
    # Fresh Series: pandas 3 StringDtype forbids in-place numeric writes.
    # (float64 can't hold pd.NA at construction — use NaN there.)
    target = "Int64" if (nums % 1 == 0).all() else "float64"
    fill = pd.NA if target == "Int64" else float("nan")
    out = pd.Series(fill, index=series.index, dtype=target)
    out.loc[non_null.index] = nums.values
    return out, True


def try_parse_datetime(series: pd.Series) -> tuple[pd.Series, bool]:
    """Common date spellings -> datetime64[ns]. All-or-nothing, tz stripped."""
    non_null = series.dropna()
    if non_null.empty or pd.api.types.is_datetime64_any_dtype(series):
        return series, False
    text = non_null.astype(str)
    if text.str.fullmatch(r"\d{4}").all():
        return series, False  # bare years ("2023") are not dates — refuse the guess
    parsed = pd.to_datetime(text, format="mixed", errors="coerce")
    if parsed.isna().any():
        return series, False
    if getattr(parsed.dt, "tz", None) is not None:
        parsed = parsed.dt.tz_localize(None)
    out = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    out.loc[non_null.index] = parsed.values
    return out, True


def smart_parse(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Apply try_parse_currency then try_parse_datetime per string column."""
    df = df.copy()
    report: dict = {"currency_parsed": [], "dates_parsed": []}
    for col in df.select_dtypes(include=["object", "string"]).columns:
        converted, ok = try_parse_currency(df[col])
        if ok:
            df[col] = converted
            report["currency_parsed"].append(col)
            continue
        converted, ok = try_parse_datetime(df[col])
        if ok:
            df[col] = converted
            report["dates_parsed"].append(col)
    return df, report


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


def sanitize_export_cells(df: pd.DataFrame) -> pd.DataFrame:
    """Neutralize spreadsheet formula injection on CSV export.

    A cell like ``=cmd|'/c calc'!A0`` executes when the CSV is opened in
    Excel/Sheets. Prefix string cells starting with = + @ | tab/CR (and
    -/+ only when NOT followed by a digit/dot, so '-5' and '+3.2' survive)
    with a single quote. Numeric dtypes are never touched.
    """
    df = df.copy()
    for col in df.select_dtypes(include=["object", "string"]).columns:
        df[col] = df[col].map(_quote_if_formula)
    return df


def _quote_if_formula(v):
    if not isinstance(v, str):
        return v
    s = v.lstrip()
    if not s:
        return v
    if s[0] in ("=", "@", "|"):
        return "'" + v
    if v[0] in ("\t", "\r", "\n"):
        # Leading control whitespace can smuggle a trigger past readers
        return "'" + v
    if s[0] in ("-", "+") and (len(s) == 1 or not (s[1].isdigit() or s[1] == ".")):
        return "'" + v
    return v
