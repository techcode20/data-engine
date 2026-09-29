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

def build_pandera_schema(schema_json_text: str) -> pa.DataFrameSchema:
    schema_dict = json.loads(clean_json_text(schema_json_text))
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