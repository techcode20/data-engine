"""Adversarial ingestion edges (A1-A7): hostile-but-plausible inputs."""
import json

import pytest

from ingest import ingest


def _w(tmp_path, name, data, mode="w", encoding="utf-8"):
    p = tmp_path / name
    if "b" in mode:
        p.write_bytes(data)
    else:
        p.write_text(data, encoding=encoding)
    return str(p)


def test_latin1_falls_back_not_crashes(tmp_path):
    p = _w(tmp_path, "latin.csv", "id,name\n1,José\n".encode("latin-1"), mode="wb")
    df = ingest(p)
    assert df["name"].tolist() == ["José"]


def test_semicolon_and_tab_delimiters_detected(tmp_path):
    for name, content in [("s.csv", "id;name\n1;Al\n"), ("t.csv", "id\tname\n1\tAl\n")]:
        df = ingest(_w(tmp_path, name, content))
        assert list(df.columns) == ["id", "name"], name


def test_pipe_delimiter_detected(tmp_path):
    df = ingest(_w(tmp_path, "p.csv", "id|name\n1|Al\n"))
    assert list(df.columns) == ["id", "name"]


def test_empty_csv_fails_cleanly_not_traceback(tmp_path):
    with pytest.raises(ValueError, match="empty"):
        ingest(_w(tmp_path, "e.csv", ""))


def test_empty_json_fails_cleanly(tmp_path):
    with pytest.raises(ValueError, match="empty"):
        ingest(_w(tmp_path, "e.json", ""))


def test_json_lines_supported(tmp_path):
    df = ingest(_w(tmp_path, "d.json", '{"id": 1}\n{"id": 2}\n'))
    assert len(df) == 2 and list(df.columns) == ["id"]


def test_json_scalar_rejected_with_type_name(tmp_path):
    with pytest.raises(ValueError, match="int"):
        ingest(_w(tmp_path, "s.json", "42"))


def test_duplicate_columns_rejected(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        ingest(_w(tmp_path, "d.csv", "id,id\n1,2\n"))


def test_blank_column_rejected(tmp_path):
    with pytest.raises(ValueError, match="blank"):
        ingest(_w(tmp_path, "b.csv", ",name\n1,Al\n"))


def test_single_column_csv_accepted(tmp_path):
    df = ingest(_w(tmp_path, "one.csv", "id\n1\n2\n"))
    assert list(df.columns) == ["id"] and len(df) == 2


def test_size_guard(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_MAX_BYTES", "10")
    with pytest.raises(ValueError, match="limit"):
        ingest(_w(tmp_path, "big.csv", "id,name\n1,Alice\n"))


def test_nested_json_still_flattens(tmp_path):
    p = _w(tmp_path, "n.json", json.dumps([{"id": 1, "c": {"e": "a@b.c"}}]))
    assert "c.e" in ingest(p).columns
