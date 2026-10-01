import json
try:
    import pandera.pandas as pa
except ImportError:  # older pandera without the pandas submodule
    import pandera as pa
from pandera import Column, Check

TYPE_MAP = {
    "int": int,
    "float": float,
    "str": str,
    "datetime": "datetime64[ns]",
    "bool": bool,
}

def clean_json_text(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[len("json"):]
    return text.strip()

ALLOWED_TYPES = ("int", "float", "str", "datetime", "bool")


def _check_shape(schema_dict) -> str | None:
    """Return an error message if the model output is not a column-spec dict."""
    if not isinstance(schema_dict, dict) or not schema_dict:
        return f"schema must be a non-empty JSON object, got {type(schema_dict).__name__}"
    for col_name, spec in schema_dict.items():
        if not isinstance(spec, dict):
            return f"column {col_name!r} must map to an object, got {type(spec).__name__}"
        t = spec.get("type", "str")
        if t not in ALLOWED_TYPES:
            return f"column {col_name!r} has unknown type {t!r} (allowed: {', '.join(ALLOWED_TYPES)})"
    return None


def build_pandera_schema(schema_json_text: str) -> pa.DataFrameSchema:
    try:
        schema_dict = json.loads(clean_json_text(schema_json_text))
    except (ValueError, AttributeError) as e:
        raise ValueError(f"schema is not valid JSON: {e}") from e
    problem = _check_shape(schema_dict)
    if problem:
        raise ValueError(f"schema has wrong shape: {problem}")
    columns = {}
    for col_name, spec in schema_dict.items():
        py_type = TYPE_MAP.get(spec.get("type", "str"), str)
        checks = []

        if spec.get("format_hint") == "email":
            checks.append(Check.str_contains("@"))

        if "allowed_values" in spec:
            checks.append(Check.isin(spec["allowed_values"]))

        if "min_value" in spec:
            checks.append(Check.greater_than_or_equal_to(spec["min_value"]))

        columns[col_name] = Column(
            py_type,
            nullable=spec.get("nullable", True),
            unique=spec.get("unique", False),
            checks=checks if checks else None,
        )
    return pa.DataFrameSchema(columns)