"""Golden-file evaluation: end-to-end cleaning quality, no LLM calls.

Each fixture in eval_fixtures/ is a quadruple:
  <name>.dirty.csv   — known-messy input (bad dates, casing, currency, bad emails…)
  <name>.clean.csv   — the hand-verified expected output
  <name>.schema.json — the target schema in schema_builder format
  <name>.clean.py    — a reviewed reference clean(df) implementation

The test replays the production path (ingest → sandbox exec → pandera
validate) and asserts the result frame-equals the expected output. Add a new
quadruple whenever you onboard a dataset shape; if a pipeline change breaks a
previously-passing shape, this goes red.
"""
import glob
import json
import os

import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from ingest import ingest
from sandbox import run_generated_code
from schema_builder import build_pandera_schema, clean_json_text
from validate import validate

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "eval_fixtures")


def _fixture_names():
    return sorted(
        os.path.splitext(os.path.basename(p))[0].removesuffix(".dirty")
        for p in glob.glob(os.path.join(FIXTURES_DIR, "*.dirty.csv"))
    )


@pytest.mark.parametrize("name", _fixture_names())
def test_golden_fixture(name):
    dirty_path = os.path.join(FIXTURES_DIR, f"{name}.dirty.csv")
    expected_path = os.path.join(FIXTURES_DIR, f"{name}.clean.csv")
    code_path = os.path.join(FIXTURES_DIR, f"{name}.clean.py")
    schema_path = os.path.join(FIXTURES_DIR, f"{name}.schema.json")

    with open(schema_path) as f:
        schema_json = f.read()
    schema_dict = json.loads(clean_json_text(schema_json))
    schema = build_pandera_schema(schema_json)

    df = ingest(dirty_path)
    with open(code_path) as f:
        code = f.read()
    cleaned, err = run_generated_code(code, df)
    assert err is None, f"clean() crashed on {name}: {err}"

    ok, failures = validate(cleaned, schema)
    assert ok, f"schema validation failed on {name}:\n{failures}"

    datetime_cols = [c for c, spec in schema_dict.items() if spec.get("type") == "datetime"]
    expected = pd.read_csv(expected_path, parse_dates=datetime_cols)
    # Values must match exactly; dtypes are already enforced by validate().
    assert_frame_equal(cleaned.reset_index(drop=True), expected,
                        check_dtype=False, check_like=True)
