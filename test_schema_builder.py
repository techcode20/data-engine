import json
import pandas as pd
from schema_builder import build_pandera_schema, clean_json_text

def test_clean_json_text_strips_markdown_fences():
    raw = '```json\n{"a": 1}\n```'
    assert clean_json_text(raw) == '{"a": 1}'

def test_clean_json_text_passes_through_plain_json():
    raw = '{"a": 1}'
    assert clean_json_text(raw) == '{"a": 1}'

def test_build_schema_basic_types():
    schema_json = json.dumps({
        "user_id": {"type": "int", "nullable": False, "unique": True},
        "name": {"type": "str", "nullable": False},
    })
    schema = build_pandera_schema(schema_json)
    df_good = pd.DataFrame({"user_id": [1, 2], "name": ["Alice", "Bob"]})
    schema.validate(df_good)  # should not raise

def test_build_schema_rejects_bad_data():
    schema_json = json.dumps({
        "user_id": {"type": "int", "nullable": False, "unique": True},
    })
    schema = build_pandera_schema(schema_json)
    df_bad = pd.DataFrame({"user_id": [1, 1]})  # duplicate, violates unique=True
    try:
        schema.validate(df_bad)
        assert False, "expected a validation error for duplicate unique values"
    except Exception:
        pass  # expected

def test_build_schema_allowed_values_check():
    schema_json = json.dumps({
        "status": {"type": "str", "nullable": False, "allowed_values": ["PENDING", "SHIPPED"]},
    })
    schema = build_pandera_schema(schema_json)
    df_bad = pd.DataFrame({"status": ["CANCELLED"]})
    try:
        schema.validate(df_bad)
        assert False, "expected a validation error for a disallowed status value"
    except Exception:
        pass  # expected