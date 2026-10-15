"""Live backend for PipelineForge Transit: upload → real clean → download.

The frontend's scripted demo (TransitEngine) plays canned events; this
service streams the SAME event shapes from genuine pipeline runs so the
map needs no changes — only the event source. Run with::

    python -m uvicorn backend_api:app --port 8000

Endpoints (all local-only; bind 127.0.0.1):
    POST /runs                  multipart {file, rules, retries?} → 202 {run_id}
    GET  /runs/{id}/events      SSE stream of EngineEvent JSON (Last-Event-ID resume)
    GET  /runs/{id}             status snapshot
    GET  /runs/{id}/attempts/{n} per-attempt snapshot (code/checks/score/rows)
    GET  /runs/{id}/cleaned.csv validated output download
    GET  /runs/{id}/pipeline.py standalone clean() download
    POST /runs/{id}/cancel      cooperative cancel (takes effect between steps)
    GET  /health                {ok, version, parquet}

Single-flight: one live run at a time; a second POST while one runs → 409.

Sharing modes (env):
    unset PF_API_TOKEN → open dev mode (localhost): no auth, env-default
    sandbox backend, no ownership checks.
    PF_API_TOKEN set → shared mode: every POST needs
    `Authorization: Bearer <token>`; each run returns a secret run_token
    required (header or ?token=) for all run-scoped endpoints; Docker
    backend is MANDATORY (POST → 503 while docker is misconfigured);
    finished runs are swept (frames, tmpdirs, snapshots) after
    ARTIFACT_TTL_S (default 600). Serve behind a VPN + TLS terminator;
    query-string tokens can land in access logs — prefer the header
    everywhere a client can set one (EventSource/download anchors cannot).
"""
import hmac
import io
import os
import secrets
import shutil
import tempfile
import threading
import time
import uuid
from importlib.metadata import version as _pkg_version

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response, StreamingResponse

from engine import process_one
from pipeline_emit import render_pipeline
from pre_clean import sanitize_export_cells

try:
    _VERSION = _pkg_version("data-engine")
except Exception:
    _VERSION = "dev"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # same cap as the frontend gate
MAX_SAMPLE_ROWS = 8
MAX_CELL_CHARS = 200
ALLOWED_EXTENSIONS = (".csv", ".json")
ARTIFACT_TTL_S = 600  # finished runs swept after this; env ARTIFACT_TTL_S overrides

app = FastAPI(title="pipelineforge-transit-live", version=_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_registry: dict = {}
_registry_lock = threading.Lock()
_sweeper_started = False


def _api_token() -> str | None:
    """Shared bearer token, or None for open dev mode. Read per-request so
    tests (and operators) can flip modes without a restart."""
    return os.getenv("PF_API_TOKEN") or None


def _token_mode() -> bool:
    return _api_token() is not None


def _credential(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.query_params.get("token")


def _require_shared(request: Request) -> None:
    """Gate run creation on the shared token (no-op in dev mode)."""
    expected = _api_token()
    if not expected:
        return
    got = _credential(request)
    if not got:
        raise HTTPException(status_code=401, detail="missing bearer token")
    if not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=403, detail="wrong token")


def _require_ownership(request: Request, run: dict) -> None:
    """Gate run-scoped endpoints on the per-run secret (no-op in dev mode).
    The run token is unguessable and only ever returned to the creator, so
    it doubles as the ownership proof — no per-user accounts needed."""
    if not _token_mode():
        return
    got = _credential(request) or ""
    if not hmac.compare_digest(got, run.get("run_token") or ""):
        raise HTTPException(status_code=403, detail="not your run")


def _ttl_s() -> float:
    try:
        return max(60.0, float(os.getenv("ARTIFACT_TTL_S", str(ARTIFACT_TTL_S))))
    except ValueError:
        return float(ARTIFACT_TTL_S)


def _sweep_expired(now: float | None = None) -> list:
    """Delete terminal runs older than the TTL: frames, tmpdirs, snapshots,
    registry entries. Running runs are never touched. Returns swept ids."""
    now = time.time() if now is None else now
    ttl = _ttl_s()
    swept = []
    with _registry_lock:
        for rid, run in list(_registry.items()):
            if run["status"] == "running":
                continue
            finished = run.get("finished_at") or run.get("created", now)
            if now - finished < ttl:
                continue
            tmpdir = run.get("tmpdir")
            if tmpdir:
                try:
                    shutil.rmtree(tmpdir, ignore_errors=True)
                except Exception:
                    pass
            del _registry[rid]
            swept.append(rid)
    return swept


def _sweeper_loop():
    while True:
        time.sleep(60)
        try:
            _sweep_expired()
        except Exception:
            pass


def _ensure_sweeper():
    global _sweeper_started
    with _registry_lock:
        if _sweeper_started:
            return
        _sweeper_started = True
    thread = threading.Thread(target=_sweeper_loop, daemon=True)
    thread.start()


def _new_run_id() -> str:
    return uuid.uuid4().hex[:12]


def _emit(run: dict, event: dict) -> dict:
    """Append an event with a sequence number; wake SSE waiters."""
    with run["cond"]:
        run["seq"] += 1
        event = {"seq": run["seq"], **event}
        run["events"].append(event)
        run["cond"].notify_all()
    return event


def _cell(v) -> str:
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    return str(v)[:MAX_CELL_CHARS]


def _row_key(values: list) -> tuple:
    return tuple(values)


def _build_rows(raw: pd.DataFrame, cleaned) -> tuple[list, list]:
    """Sample ≤8 raw rows with kept/dropped fates (exact-match against the
    cleaned frame) + carriage states. Best-effort and documented as such:
    without row identity, content matching is the honest approximation.
    Rows that were never evaluated (no cleaned frame — the attempt died in
    the sandbox) report dirty/orange, never rejected: grey means the
    pipeline looked at the row and dropped it, not that code crashed."""
    columns = [str(c) for c in raw.columns]
    kept = set()
    evaluated = isinstance(cleaned, pd.DataFrame)
    if evaluated:
        for _, r in cleaned.iterrows():
            kept.add(_row_key([_cell(r[c]) for c in cleaned.columns]))
    rows = []
    states = []
    for _, r in raw.head(MAX_SAMPLE_ROWS).iterrows():
        values = [_cell(r[c]) for c in raw.columns]
        is_kept = evaluated and _row_key(values) in kept
        match = None
        if is_kept:
            for _, cr in cleaned.iterrows():
                if _row_key([_cell(cr[c]) for c in cleaned.columns]) == _row_key(values):
                    match = [_cell(cr[c]) for c in cleaned.columns]
                    break
        if not evaluated:
            # The attempt died before producing a frame: the row was never
            # judged, so it must not wear rejected-grey. Dirty/orange keeps
            # the theme and tells the truth (fate stays in the kept/dropped
            # vocabulary the frontend renders).
            fate, reason, state = "dropped", "not evaluated — attempt died before validation", "dirty"
        else:
            fate = "kept" if is_kept else "dropped"
            reason = "survived validation" if is_kept else "removed during cleaning"
            state = "clean" if is_kept else "rejected"
        rows.append({"values": values, "cleaned": match, "fate": fate, "reason": reason})
        states.append(state)
    return columns, rows, states


def _build_checks(info: dict) -> list:
    cases = info.get("failure_cases")
    if isinstance(cases, pd.DataFrame) and not cases.empty:
        items = []
        try:
            grouped = cases.groupby(["column", "check"], dropna=False).size()
        except (KeyError, TypeError, ValueError):
            grouped = None
        if grouped is not None:
            for (col, check), n in grouped.items():
                items.append({
                    "id": f"{col}::{check}",
                    "label": f"{col} — {check}",
                    "status": "fail",
                    "detail": f"{int(n)} failing case(s)",
                })
            return items
    text = (info.get("failures_text") or "")[:300]
    if text:
        return [{"id": "run", "label": "attempt failed", "status": "fail",
                 "detail": text}]
    return []


def _drive(run: dict, saved_path: str):
    """Background thread: real pipeline → EngineEvent stream."""
    rules = run["rules"]
    filename = run["filename"]
    frames: dict = {}
    run["attempts"] = {}

    def log(level, text):
        _emit(run, {"type": "log", "level": level, "text": text})

    def on_stage(stage, status):
        _emit(run, {"type": "stage", "id": stage, "status": status})

    def on_attempt(n, info):
        rows_in = info.get("rows_in", 0) or 0
        rows_out = info.get("rows_out", 0) or 0
        score = round(rows_out / rows_in * 100) if rows_in else 0
        checks = (_build_checks(info) if not info.get("ok")
                  else [{"id": "schema", "label": "Schema validation",
                         "status": "pass",
                         "detail": f"{rows_out}/{rows_in} rows"}])
        raw = frames.get("raw")
        cleaned = info.get("frame")
        if not isinstance(cleaned, pd.DataFrame):
            cleaned = frames.get("cleaned")
        if raw is not None:
            columns, rows, states = _build_rows(raw, cleaned)
        else:
            columns, rows, states = [], [], []
        run["attempts"][n] = {"code": info.get("code", ""), "checks": checks,
                              "score": score, "columns": columns, "rows": rows,
                              "states": states}
        if info.get("schema_json") and not run.get("schema_json"):
            run["schema_json"] = info["schema_json"]
        _emit(run, {"type": "attempt", "n": n})
        _emit(run, {"type": "code", "version": n, "source": info.get("code", "")})
        if n > 1:
            _emit(run, {"type": "reroute", "on": True})
            _emit(run, {"type": "disruption", "on": False})
        _emit(run, {"type": "checks", "items": checks})
        _emit(run, {"type": "score", "value": score})
        _emit(run, {"type": "carriages", "states": states})
        _emit(run, {"type": "rows", "columns": columns, "rows": rows})
        if info.get("ok"):
            log("OK", f"attempt {n} validated ({rows_out}/{rows_in} rows)")
        else:
            _emit(run, {"type": "disruption", "on": True,
                        "label": f"attempt {n} held at the gate"})
            log("WARN", f"attempt {n} failed validation — repair dispatched")

    def on_frames(raw, cleaned):
        if raw is not None:
            frames["raw"] = raw
        frames["cleaned"] = cleaned
        with _registry_lock:
            run["frames"] = dict(frames)

    _emit(run, {"type": "board", "next": filename, "status": "RUNNING"})
    _emit(run, {"type": "crew", "visible": True})
    log("INFO", f"departing with {filename} — live backend")
    for stage in ("intake", "schema", "code"):
        _emit(run, {"type": "stage", "id": stage, "status": "running"})
    try:
        result = process_one(
            saved_path, rules, run["retries"], None, quiet=True,
            on_stage=on_stage, on_attempt=on_attempt, on_frames=on_frames,
            should_cancel=run["cancel_flag"].is_set,
            sandbox_backend=run.get("sandbox_backend"),
        )
    except Exception as e:  # noqa: BLE001 — driver boundary: record, never crash the thread
        result = {"success": False, "attempts": 0, "input_hash": None,
                  "rows_in": 0, "rows_out": 0,
                  "error": f"driver crashed: {type(e).__name__}: {e}"}
    run["result"] = result
    run["finished_at"] = time.time()
    ok = result.get("success") is True
    cancelled = result.get("cancelled") is True
    run["status"] = "cancelled" if cancelled else ("done" if ok else "failed")
    # Resolve the Repair Depot badge: the engine only marks repair "passed"
    # when another attempt starts, so a terminal run would leave it RUNNING
    # forever — looking stuck while the board already says HELD/ARRIVED.
    _emit(run, {"type": "stage", "id": "repair",
                "status": "passed" if ok else "failed"})
    run["final_code"] = (run["attempts"].get(result.get("attempts", 0), {})
                         .get("code", ""))
    _emit(run, {"type": "crew", "visible": False})
    _emit(run, {"type": "reroute", "on": False})
    if cancelled:
        _emit(run, {"type": "disruption", "on": False})
        _emit(run, {"type": "board", "next": filename, "status": "CANCELLED"})
        log("WARN", "run cancelled by the conductor — partial progress kept")
    elif ok:
        _emit(run, {"type": "disruption", "on": False})
        _emit(run, {"type": "board", "next": filename, "status": "ARRIVED"})
        _emit(run, {"type": "tickets"})
        log("OK", f"arrived: {result.get('rows_out')}/{result.get('rows_in')} rows validated")
    else:
        err = str(result.get("error") or "validation failed")[:300]
        _emit(run, {"type": "error", "text": err})
        _emit(run, {"type": "alert", "text": f"{filename}: {err}"})
        _emit(run, {"type": "board", "next": filename, "status": "HELD"})
        log("ERROR", err)
    _emit(run, {"type": "done", "attempts": max(run["attempts"].keys(), default=0),
                "status": run["status"]})


def _active_run():
    with _registry_lock:
        for run in _registry.values():
            if run["status"] == "running":
                return run
    return None


@app.get("/health")
def health():
    # A dead parquet transport fails EVERY attempt with a confusing
    # sandbox error three steps later — surface it here instead.
    from sandbox import _parquet_available
    return {"ok": True, "version": _VERSION, "parquet": _parquet_available()}


@app.post("/runs", status_code=202)
async def create_run(request: Request, file: UploadFile = File(...), rules: str = Form(...),
                     retries: int = Form(3)):
    _require_shared(request)
    # Docker is mandatory in token (shared) mode: the gate's documented
    # residuals (composed strings, untraced aliases) are acceptable for
    # your own data behind localhost, not for anyone else's. Fail fast
    # here, never silently downgrade to subprocess.
    force_docker = _token_mode()
    if force_docker:
        from sandbox import _check_docker
        bad = _check_docker()
        if bad:
            raise HTTPException(status_code=503, detail=f"docker backend required: {bad}")
    active = _active_run()
    if active is not None:
        age = int(time.time() - active.get("created", time.time()))
        raise HTTPException(
            status_code=409,
            detail=f"a live run is already boarding (started {age}s ago) — "
                   f"wait for it to arrive")
    name = (file.filename or "upload").lower()
    if not name.endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(status_code=400, detail="gate accepts .csv and .json only")
    if not (rules or "").strip():
        raise HTTPException(status_code=400, detail="rules must not be empty")
    retries = max(1, min(5, int(retries)))
    tmpdir = tempfile.mkdtemp(prefix="pf_run_")
    saved = os.path.join(tmpdir, os.path.basename(file.filename or "upload"))
    size = 0
    with open(saved, "wb") as f:
        while True:
            chunk = await file.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                try:
                    os.remove(saved)
                except OSError:
                    pass
                raise HTTPException(status_code=413, detail="file exceeds the 10 MB gate")
            f.write(chunk)
    run_id = _new_run_id()
    run = {"id": run_id, "filename": file.filename or "upload",
           "rules": rules.strip(), "retries": retries,
           "status": "running", "seq": 0, "events": [],
           "cond": threading.Condition(), "attempts": {},
           "cancel_flag": threading.Event(),
           "run_token": secrets.token_hex(16),
           "sandbox_backend": "docker" if force_docker else None,
           "tmpdir": tmpdir, "created": time.time(), "finished_at": None}
    with _registry_lock:
        # Bound memory: previous runs keep events/snapshots for replay but
        # drop frames (downloads stay available for the latest run only).
        for old in _registry.values():
            old.pop("frames", None)
        _registry[run_id] = run
    _ensure_sweeper()
    thread = threading.Thread(target=_drive, args=(run, saved), daemon=True)
    thread.start()
    return {"run_id": run_id, "run_token": run["run_token"]}


def _get_run(run_id: str) -> dict:
    with _registry_lock:
        run = _registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown run")
    return run


def _sse_line(event: dict) -> str:
    import json as _json
    payload = {k: v for k, v in event.items() if k != "seq"}
    return f"id: {event['seq']}\ndata: {_json.dumps(payload)}\n\n"


@app.get("/runs/{run_id}/events")
def run_events(run_id: str, request: Request):
    run = _get_run(run_id)
    _require_ownership(request, run)
    last = request.headers.get("last-event-id")
    try:
        resume_from = int(last) if last is not None else -1
    except ValueError:
        resume_from = -1

    def stream():
        pos = resume_from
        yield ": connected\n\n"
        while True:
            # Decide under the lock, yield outside it: yielding while
            # holding run["cond"] wedges _emit (and the whole run) whenever
            # the client stalls or disconnects uncleanly.
            with run["cond"]:
                pending = [e for e in run["events"] if e["seq"] > pos]
                if not pending and run["status"] == "running":
                    run["cond"].wait(timeout=15)
                    pending = [e for e in run["events"] if e["seq"] > pos]
                alive = run["status"] == "running"
            if not pending and alive:
                yield ": ping\n\n"
                continue
            for event in pending:
                pos = event["seq"]
                yield _sse_line(event)
                if event.get("type") == "done":
                    return

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            # Proxies (Cloudflare edge, Caddy, nginx) must not buffer this
            # stream: buffered SSE arrives as one end-of-run burst, and the
            # map then fast-forwards start→end instead of riding along.
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/runs/{run_id}")
def run_snapshot(run_id: str, request: Request):
    run = _get_run(run_id)
    _require_ownership(request, run)
    result = run.get("result") or {}
    return {"run_id": run_id, "filename": run["filename"],
            "status": run["status"],
            "attempts": sorted(run["attempts"].keys()),
            "scores": [run["attempts"][n]["score"] for n in sorted(run["attempts"])],
            "rows_in": result.get("rows_in"), "rows_out": result.get("rows_out"),
            "error": result.get("error")}


@app.get("/runs/{run_id}/attempts/{n}")
def run_attempt(run_id: str, n: int, request: Request):
    run = _get_run(run_id)
    _require_ownership(request, run)
    snap = run["attempts"].get(n)
    if snap is None:
        raise HTTPException(status_code=404, detail="attempt not reached yet")
    return {"attempt": n, **snap}


@app.get("/runs/{run_id}/cleaned.csv")
def run_cleaned_csv(run_id: str, request: Request):
    run = _get_run(run_id)
    _require_ownership(request, run)
    frames = run.get("frames") or {}
    cleaned = frames.get("cleaned")
    if not isinstance(cleaned, pd.DataFrame):
        raise HTTPException(status_code=404, detail="no validated output for this run")
    buf = io.StringIO()
    sanitize_export_cells(cleaned).to_csv(buf, index=False)
    name = (run["filename"].rsplit(".", 1)[0] or "cleaned") + ".cleaned.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/runs/{run_id}/pipeline.py")
def run_pipeline_py(run_id: str, request: Request):
    run = _get_run(run_id)
    _require_ownership(request, run)
    result = run.get("result") or {}
    code = run.get("final_code") or ""
    schema_json = run.get("schema_json") or "{}"
    if result.get("success") is not True or not code:
        raise HTTPException(status_code=404, detail="no validated pipeline for this run")
    text = render_pipeline(code, source=run["filename"], rules=run["rules"],
                           input_hash=result.get("input_hash") or "unknown",
                           schema_json=schema_json, validated=True)
    return PlainTextResponse(
        text, media_type="text/x-python",
        headers={"Content-Disposition": 'attachment; filename="pipeline.py"'})


@app.post("/runs/{run_id}/cancel")
def run_cancel(run_id: str, request: Request):
    run = _get_run(run_id)
    _require_ownership(request, run)
    if run["status"] != "running":
        return {"run_id": run_id, "status": run["status"]}
    run["cancel_flag"].set()
    return {"run_id": run_id, "status": "cancelling"}
