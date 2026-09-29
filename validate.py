try:
    import pandera.pandas as pa
except ImportError:
    import pandera as pa

DEFAULT_MAX_DROP_FRACTION = 0.75


def validate(df, schema: pa.DataFrameSchema):
    try:
        schema.validate(df, lazy=True)
        return True, None
    except pa.errors.SchemaErrors as err:
        return False, err.failure_cases


def sanity_checks(raw_df, cleaned_df, max_drop_fraction: float = DEFAULT_MAX_DROP_FRACTION) -> list[str]:
    """Dataset-level guards that a column schema cannot express.

    Returns a list of issue strings (empty = sane). Checked:
    - cleaning emptied a non-empty dataset
    - row drop fraction exceeds max_drop_fraction (silent mass deletion)
    - a column is entirely null after cleaning without being so before
    """
    issues = []
    n_raw, n_clean = len(raw_df), len(cleaned_df)
    if n_raw > 0 and n_clean == 0:
        issues.append(f"cleaning emptied the dataset ({n_raw} rows in, 0 out)")
    elif n_raw > 0:
        drop_frac = 1 - n_clean / n_raw
        if drop_frac > max_drop_fraction:
            issues.append(
                f"dropped {drop_frac:.0%} of rows "
                f"({n_raw} -> {n_clean}; limit {max_drop_fraction:.0%})"
            )
    for col in cleaned_df.columns:
        if col in raw_df.columns:
            if cleaned_df[col].isnull().all() and not raw_df[col].isnull().all():
                issues.append(f"column '{col}' is entirely null after cleaning")
    return issues