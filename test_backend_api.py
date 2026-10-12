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
from sandbox import _parquet_available

client = TestClient(app)

needs_parquet = pytest.mark.skipif(
    not _parquet_available(),
    reason="no working parquet engine here (pyarrow blocked/missing)")


@pytest.fixture(autouse=True)
def _isolated_caches(tmp_path, monkeypatch):
    monkeypatch.setattr(code_cache, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json"))
    monkeypatch.setattr(schema_cache, "CACHE_PATH", str(tmp_path / "schema_cache.json"))
    # Deterministic mode per test: dev-open unless a test sets PF_API_TOKEN.
    monkeypatch.delenv("PF_API_TOKEN", raising=False)


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


@needs_parquet
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
    refused = _post_run()
    assert refused.status_code == 409  # second run refused while one boards
    assert "already boarding" in refused.json()["detail"]
    assert "started" in refused.json()["detail"] and "ago" in refused.json()["detail"]
    run_id = first.json()["run_id"]
    cancel = client.post(f"/runs/{run_id}/cancel")
    assert cancel.status_code == 200
    release.set()
    events = _stream_events(run_id)
    assert events[-1]["type"] == "done"
    assert client.post(f"/runs/{run_id}/cancel").json()["status"] in ("failed", "done")


def test_health():
    assert client.get("/health").json()["ok"] is True


@pytest.mark.parametrize("ok,expected", [(True, "passed"), (False, "failed")])
def test_teardown_resolves_repair_badge(monkeypatch, ok, expected):
    """The engine only marks repair passed when another attempt starts, so
    without teardown help a terminal run leaves Repair Depot RUNNING —
    looking stuck while the board already says HELD/ARRIVED."""

    def fake_process_one(*a, **k):
        return {"success": ok, "attempts": 1, "input_hash": "h",
                "rows_in": 1, "rows_out": 1 if ok else 0,
                "error": None if ok else "boom"}

    monkeypatch.setattr(backend_api, "process_one", fake_process_one)
    run_id = _post_run().json()["run_id"]
    events = _stream_events(run_id)
    assert events[-1]["type"] == "done"
    repair_statuses = [e["status"] for e in events
                       if e["type"] == "stage" and e["id"] == "repair"]
    assert repair_statuses, "no repair event emitted at teardown"
    assert repair_statuses[-1] == expected
    assert repair_statuses[-1] != "running"


def _token_post(headers=None, **kw):
    return client.post("/runs", files={"file": ("t.csv", b"id\n1\n", "text/csv")},
                       data={"rules": "id int", "retries": "1"},
                       headers=headers, **kw)


def test_token_mode_gates_creation_and_ownership(monkeypatch):
    import sandbox as _sb
    monkeypatch.setenv("PF_API_TOKEN", "shared-secret")
    # No token → 401; wrong token → 403.
    assert _token_post().status_code == 401
    assert _token_post(headers={"Authorization": "Bearer wrong"}).status_code == 403
    # Token set but docker unavailable here → 503, never a silent downgrade.
    good = {"Authorization": "Bearer shared-secret"}
    r = _token_post(headers=good)
    assert r.status_code == 503
    # With docker (mocked) available: creation returns an ownership token.
    monkeypatch.setattr(_sb, "_check_docker", lambda: None)
    seen = {}

    def fake_process_one(*a, **k):
        seen.update(k)
        return {"success": True, "attempts": 1, "input_hash": "h",
                "rows_in": 1, "rows_out": 1}

    monkeypatch.setattr(backend_api, "process_one", fake_process_one)
    r = _token_post(headers=good)
    assert r.status_code == 202
    run_id = r.json()["run_id"]
    run_token = r.json()["run_token"]
    assert run_token and run_token != run_id
    assert seen.get("sandbox_backend") == "docker"  # forced, not opt-in
    # Run-scoped endpoints: no/wrong token → 403; run token (header or
    # query — EventSource/anchors cannot set headers) → through.
    assert client.get(f"/runs/{run_id}").status_code == 403
    assert client.get(f"/runs/{run_id}",
                      headers={"Authorization": "Bearer shared-secret"}).status_code == 403
    owner = {"Authorization": f"Bearer {run_token}"}
    assert client.get(f"/runs/{run_id}", headers=owner).status_code == 200
    assert client.get(f"/runs/{run_id}?token={run_token}").status_code == 200
    assert client.post(f"/runs/{run_id}/cancel", headers=owner).status_code == 200
    assert client.get("/runs/nope", headers=owner).status_code == 404


def test_sweep_expired_drops_frames_tmpdirs_snapshots(tmp_path, monkeypatch):
    import os as _os
    monkeypatch.delenv("ARTIFACT_TTL_S", raising=False)
    tmpdir = tmp_path / "pf_run_old"
    tmpdir.mkdir()
    (tmpdir / "upload.csv").write_text("id\n1\n")
    old = {"id": "old", "status": "failed", "seq": 1, "events": [{"seq": 1}],
           "attempts": {1: {}}, "frames": {"raw": object()},
           "tmpdir": str(tmpdir), "created": 1000.0, "finished_at": 1000.0,
           "cancel_flag": None, "cond": threading.Condition()}
    fresh_dir = tmp_path / "pf_run_new"
    fresh_dir.mkdir()
    fresh = dict(old, id="new", finished_at=2000.0, tmpdir=str(fresh_dir))
    running = dict(old, id="run", status="running", finished_at=None,
                   tmpdir=str(tmp_path / "pf_run_live"))
    monkeypatch.setattr(backend_api, "_registry",
                        {"old": old, "new": fresh, "run": running})
    swept = backend_api._sweep_expired(now=1000.0 + 601.0)
    assert swept == ["old"]
    assert "old" not in backend_api._registry
    assert not (tmpdir / "upload.csv").exists()
    assert "new" in backend_api._registry and "run" in backend_api._registry


def test_process_one_forwards_sandbox_backend(tmp_path, monkeypatch):
    from unittest.mock import patch
    import code_cache as _cc
    import schema_cache as _sc
    monkeypatch.setattr(_cc, "CODE_CACHE_PATH", str(tmp_path / "cc.json"))
    monkeypatch.setattr(_sc, "CACHE_PATH", str(tmp_path / "sc.json"))
    p = tmp_path / "a.csv"
    p.write_text("id\n1\n")
    seen = {}

    def fake_run(code, df, backend=None, timeout=None):
        seen["backend"] = backend
        return None, "boom"

    with patch("code_gen.generate", return_value="def clean(df):\n    return df"), \
         patch("schema_inference.generate",
               return_value='{"id": {"type": "int"}}'), \
         patch("engine.run_generated_code", side_effect=fake_run):
        from engine import process_one
        process_one(str(p), "id int", retries=1, output_path=None,
                    sandbox_backend="docker")
        assert seen["backend"] == "docker"
        process_one(str(p), "id int", retries=1, output_path=None)
        assert seen["backend"] is None
