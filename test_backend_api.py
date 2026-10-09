"""Live backend: upload → real clean → SSE stream → download.

Full runs use stubbed LLM calls (same pattern as test_engine) with
hermetic caches; failure/409/cancel paths are deterministic.
"""
import json
import threading
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import code_cache
import schema_cache
import backend_api
from backend_api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_caches(tmp_path, monkeypatch):
    monkeypatch.setattr(code_cache, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json"))
    monkeypatch.setattr(schema_cache, "CACHE_PATH", str(tmp_path / "schema_cache.json"))


def _post_run(content=b"id,name\n1,Alice\n2,Bob\n", name="t.csv",
              rules="id is required", retries="2"):
    return client.post("/runs", files={"file": (name, content, "text/csv")},
                       data={"rules": rules, "retries": retries})


def _stream_events(run_id):
    resp = client.get(f"/runs/{run_id}/events")
    assert resp.status_code == 200
    events = []
    for line in resp.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: "):]))
    return events


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_full_run_streams_real_events(mock_schema_gen, mock_code_gen):
    mock_schema_gen.return_value = \
        '{"id": {"type": "int", "nullable": false}, "name": {"type": "str", "nullable": false}}'
    mock_code_gen.return_value = (
        "def clean(df):\n"
        "    df['id'] = df['id'].astype(int)\n"
        "    return df"
    )
    r = _post_run()
    assert r.status_code == 202
    run_id = r.json()["run_id"]

    events = _stream_events(run_id)
    kinds = [e["type"] for e in events]
    for required in ("board", "stage", "attempt", "code", "checks",
                     "score", "carriages", "rows", "tickets", "done"):
        assert required in kinds, f"missing {required} in {[k for k in kinds]}"
    code_ev = next(e for e in events if e["type"] == "code")
    assert code_ev["version"] == 1 and "astype(int)" in code_ev["source"]
    score_ev = next(e for e in events if e["type"] == "score")
    assert score_ev["value"] == 100
    rows_ev = next(e for e in events if e["type"] == "rows")
    assert rows_ev["columns"] == ["id", "name"] and len(rows_ev["rows"]) == 2
    assert all(row["fate"] == "kept" for row in rows_ev["rows"])
    done_ev = next(e for e in events if e["type"] == "done")
    assert done_ev["status"] == "done"

    snap = client.get(f"/runs/{run_id}").json()
    assert snap["status"] == "done" and snap["scores"] == [100]

    att = client.get(f"/runs/{run_id}/attempts/1").json()
    assert att["attempt"] == 1 and "astype(int)" in att["code"]

    csv = client.get(f"/runs/{run_id}/cleaned.csv")
    assert csv.status_code == 200
    assert "Alice" in csv.text and "id,name" in csv.text.splitlines()[0]

    pipe = client.get(f"/runs/{run_id}/pipeline.py")
    assert pipe.status_code == 200
    assert "def clean(df):" in pipe.text and "VALIDATED" in pipe.text


@patch("code_gen.generate")
@patch("schema_inference.generate")
def test_failed_run_has_no_downloads(mock_schema_gen, mock_code_gen):
    mock_schema_gen.return_value = '{"id": {"type": "int", "nullable": false}}'
    mock_code_gen.return_value = "def clean(df):\n    return df"  # never casts
    r = _post_run(content=b"id\n1\n", retries="1")
    assert r.status_code == 202
    events = _stream_events(r.json()["run_id"])
    assert next(e for e in events if e["type"] == "done")["status"] == "failed"
    assert any(e["type"] == "error" for e in events)
    assert client.get(f"/runs/{r.json()['run_id']}/cleaned.csv").status_code == 404
    assert client.get(f"/runs/{r.json()['run_id']}/pipeline.py").status_code == 404


def test_rejects_bad_uploads():
    assert _post_run(name="evil.exe", content=b"x").status_code == 400
    assert _post_run(rules="   ").status_code == 400
    big = _post_run(content=b"x" * (10 * 1024 * 1024 + 1))
    assert big.status_code == 413
    assert client.get("/runs/nope/events").status_code == 404
    assert client.get("/runs/nope").status_code == 404


def test_single_flight_409_and_cancel(monkeypatch):
    gate = threading.Event()
    release = threading.Event()

    def fake_process_one(*a, **k):
        gate.set()
        assert release.wait(timeout=30)
        return {"success": False, "attempts": 0, "input_hash": None,
                "rows_in": 0, "rows_out": 0, "error": "stalled"}

    monkeypatch.setattr(backend_api, "process_one", fake_process_one)
    first = _post_run()
    assert first.status_code == 202
    assert gate.wait(timeout=30)
    assert _post_run().status_code == 409  # second run refused while one boards
    run_id = first.json()["run_id"]
    cancel = client.post(f"/runs/{run_id}/cancel")
    assert cancel.status_code == 200
    release.set()
    events = _stream_events(run_id)
    assert events[-1]["type"] == "done"
    assert client.post(f"/runs/{run_id}/cancel").json()["status"] in ("failed", "done")


def test_health():
    assert client.get("/health").json()["ok"] is True
