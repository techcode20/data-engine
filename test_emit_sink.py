"""--emit-pipeline and --sink: exportable clean() scripts + SQLite warehouse loads."""
import os
import sqlite3
import subprocess
import sys
from unittest.mock import patch

import pandas as pd
import pytest

from engine import process_one
from pipeline_emit import (
    check_pipeline_path,
    default_pipeline_path,
    render_pipeline,
    write_pipeline,
)
from sinks import check_table, derive_table, parse_sink, write_sink

import code_cache
import schema_cache


@pytest.fixture(autouse=True)
def _isolated_caches(tmp_path, monkeypatch):
    """Hermetic caches: never read/write the developer's real cache files."""
    monkeypatch.setattr(code_cache, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json"))
    monkeypatch.setattr(schema_cache, "CACHE_PATH", str(tmp_path / "schema_cache.json"))
    monkeypatch.chdir(tmp_path)  # auto-derived artifacts land here, never in the repo


CANNED_CODE = "def clean(df):\n    df['id'] = df['id'].astype(int)\n    return df"
SCHEMA_JSON = '{"id": {"type": "int", "nullable": false}}'


# --- render ---------------------------------------------------------------

def test_render_embeds_code_and_provenance():
    text = render_pipeline(CANNED_CODE, source="in.csv", rules="id is int",
                           input_hash="abc123", schema_json=SCHEMA_JSON, validated=True)
    assert "VALIDATED clean()" in text
    assert "UNVALIDATED" not in text
    assert CANNED_CODE in text
    assert "in.csv" in text and "abc123" in text
    assert "import pandas as pd" in text
    assert "def main(" in text  # standalone CLI included
    # No data-engine dependency: only stdlib + pandas imports allowed.
    imports = [ln.strip() for ln in text.splitlines()
               if ln.strip().startswith(("import ", "from "))]
    assert imports == ["import argparse", "import sys", "import pandas as pd"]


def test_render_dry_run_is_bannered_unvalidated():
    text = render_pipeline(CANNED_CODE, source="in.csv", rules="r",
                           input_hash="h", schema_json=SCHEMA_JSON, validated=False)
    assert "UNVALIDATED DRY-RUN" in text


def test_default_path_prefers_output_sibling(tmp_path):
    assert default_pipeline_path("in.csv", str(tmp_path / "clean.csv")) == \
        str(tmp_path / "clean.pipeline.py")
    assert default_pipeline_path("data/in.csv", None).endswith("in.pipeline.py")


def test_pipeline_path_refuses_parent_escape():
    with pytest.raises(ValueError, match="parent escape"):
        check_pipeline_path("../evil.pipeline.py")
    with pytest.raises(ValueError, match="parent escape"):
        write_pipeline("../evil.pipeline.py", "x")


# --- emitted script actually runs ------------------------------------------

def test_emitted_pipeline_executes_and_sanitizes(tmp_path):
    src = tmp_path / "raw.csv"
    src.write_text("id,note\n1,=1+1\n2,plain\n")
    pipe = tmp_path / "run.pipeline.py"
    out = tmp_path / "out.csv"
    write_pipeline(str(pipe), render_pipeline(
        CANNED_CODE, source=str(src), rules="id is int",
        input_hash="h", schema_json=SCHEMA_JSON, validated=True))
    proc = subprocess.run([sys.executable, str(pipe), "--input", str(src),
                           "--output", str(out)], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    got = pd.read_csv(out, dtype=str)
    assert list(got["id"]) == ["1", "2"]
    # CSV-export sanitizer is baked in: the formula cell is neutralized.
    assert list(got["note"]) == ["'=1+1", "plain"]


# --- sink parsing -----------------------------------------------------------

def test_parse_sink_explicit_and_derived_table():
    assert parse_sink("sqlite:///wh.db:customers", "in.csv") == \
        {"kind": "sqlite", "db": "wh.db", "table": "customers"}
    assert parse_sink("sqlite:///wh.db", "data/my-file.csv")["table"] == "my_file"


def test_parse_sink_rejects_everything_else():
    with pytest.raises(ValueError, match="sqlite"):
        parse_sink("postgres://u@h/db:customers", "in.csv")
    with pytest.raises(ValueError, match="malformed sink table"):
        parse_sink("sqlite:///wh.db:bad-table!", "in.csv")
    with pytest.raises(ValueError, match="parent escape"):
        parse_sink("sqlite:///../evil.db:t", "in.csv")
    with pytest.raises(ValueError, match="table name"):
        check_table("0abc")
    assert derive_table("!!!") == "cleaned"


def test_write_sink_round_trip_and_modes(tmp_path):
    db = str(tmp_path / "wh.db")
    df = pd.DataFrame({"id": [1, 2], "note": ["=1+1", "x"]})
    info = write_sink(df, {"kind": "sqlite", "db": db, "table": "t"}, if_exists="replace")
    assert info == {"db": db, "table": "t", "rows": 2}
    conn = sqlite3.connect(db)
    try:
        got = pd.read_sql("SELECT * FROM t", conn)
    finally:
        conn.close()
    # Warehouse stores RAW values — the Excel-quote prefix would corrupt data.
    assert list(got["note"]) == ["=1+1", "x"]
    write_sink(df.head(1), {"kind": "sqlite", "db": db, "table": "t"}, if_exists="append")
    conn = sqlite3.connect(db)
    try:
        assert len(pd.read_sql("SELECT * FROM t", conn)) == 3
    finally:
        conn.close()
    with pytest.raises(Exception, match="already exists"):
        write_sink(df, {"kind": "sqlite", "db": db, "table": "t"}, if_exists="fail")
    with pytest.raises(ValueError, match="sink-if-exists"):
        write_sink(df, {"kind": "sqlite", "db": db, "table": "t"}, if_exists="drop")


# --- engine integration (LLM stubbed, same pattern as test_engine) -----------

def _write_csv(tmp_path, name, content):
    p = tmp_path / name
    p.write_text(content)
    return str(p)


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_process_one_emits_pipeline_and_sink(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_csv(tmp_path, "orders.csv", "id,name\n1,Alice\n2,Bob\n")
    mock_schema_gen.return_value = \
        '{"id": {"type": "int", "nullable": false}, "name": {"type": "str", "nullable": false}}'
    mock_code_gen.return_value = (
        "def clean(df):\n"
        "    df['id'] = df['id'].astype(int)\n"
        "    return df"
    )
    out_csv = str(tmp_path / "clean.csv")
    result = process_one(csv_path, "id is required", retries=2, output_path=out_csv,
                         emit_pipeline="auto", sink="sqlite:///wh.db")
    assert result["success"] is True
    assert result["pipeline_path"] == str(tmp_path / "clean.pipeline.py")
    assert os.path.exists(result["pipeline_path"])
    assert "VALIDATED clean()" in open(result["pipeline_path"]).read()
    assert result["sink"] == {"db": "wh.db", "table": "orders", "rows": 2}
    conn = sqlite3.connect("wh.db")
    try:
        assert len(pd.read_sql("SELECT * FROM orders", conn)) == 2
    finally:
        conn.close()
    # The emitted pipeline replays the run byte-for-byte.
    replay = str(tmp_path / "replay.csv")
    proc = subprocess.run([sys.executable, result["pipeline_path"], "--input", csv_path,
                           "--output", replay], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    assert (pd.read_csv(replay, dtype=str).to_csv(index=False)
            == pd.read_csv(out_csv, dtype=str).to_csv(index=False))


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_failed_run_emits_neither(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_csv(tmp_path, "bad.csv", "id,name\n1,Alice\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    return df"  # never casts -> repeat -> stop
    result = process_one(csv_path, "id must be an integer", retries=5, output_path=None,
                         emit_pipeline="auto", sink="sqlite:///wh.db")
    assert result["success"] is False
    assert result["pipeline_path"] is None and result["sink"] is None
    assert not list(tmp_path.glob("*.pipeline.py"))
    assert not (tmp_path / "wh.db").exists()


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_dry_run_writes_draft_but_no_sink(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_csv(tmp_path, "d.csv", "id\n1\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = CANNED_CODE
    pipe = str(tmp_path / "draft.pipeline.py")
    result = process_one(csv_path, "id is int", retries=1, output_path=None,
                         dry_run=True, emit_pipeline=pipe, sink="sqlite:///wh.db")
    assert result["success"] is None
    assert result["pipeline_path"] == pipe
    assert "UNVALIDATED DRY-RUN" in open(pipe).read()
    assert result["sink"] is None
    assert not (tmp_path / "wh.db").exists()


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_bad_sink_spec_fails_loudly(mock_schema_gen, mock_code_gen, tmp_path):
    csv_path = _write_csv(tmp_path, "s.csv", "id\n1\n")
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = CANNED_CODE
    result = process_one(csv_path, "id is int", retries=1, output_path=None,
                         sink="postgres://u@h/db:t")
    assert result["success"] is False
    assert "sink failed" in result["error"]
    assert result["sink"] is None and result["pipeline_path"] is None
