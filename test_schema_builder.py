import json
import pandas as pd
import pytest
from engine import _ground_uniqueness
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


def _dup_df():
    return pd.DataFrame({"id": [1, 2, 3],
                         "email": ["a@x.io", "a@x.io", "b@x.io"]})


def test_ground_uniqueness_relaxes_disproven_claim():
    schema = '{"id": {"type": "int", "unique": true}, "email": {"type": "str", "unique": true}}'
    new_json, _ = _ground_uniqueness(_dup_df(), schema, object(), "f.csv", "id required")
    parsed = json.loads(new_json)
    assert parsed["id"]["unique"] is True      # truly unique: untouched
    assert parsed["email"]["unique"] is False  # 2/3 unique: relaxed


def test_ground_uniqueness_keeps_true_claims():
    df = pd.DataFrame({"id": [1, 2, 3]})
    schema = '{"id": {"type": "int", "unique": true}}'
    sentinel = object()
    new_json, schema_obj = _ground_uniqueness(df, schema, sentinel, "f.csv", "r")
    assert json.loads(new_json)["id"]["unique"] is True
    assert schema_obj is sentinel  # no rebuild when nothing changes


def test_ground_uniqueness_fails_fast_on_demanded_unique():
    with pytest.raises(ValueError, match="unsatisfiable"):
        _ground_uniqueness(_dup_df(),
                           '{"email": {"type": "str", "unique": true}}',
                           object(), "f.csv", "email must be unique")