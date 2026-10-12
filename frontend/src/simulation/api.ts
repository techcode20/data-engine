import { STATIONS } from "../transit/mapConfig";
import type { StationId } from "../transit/mapConfig";
import type { BatchRow, CarriageState, CheckItem, EngineEvent, Speed } from "./types";

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8000";

/** Station coordinates for the follow-camera (camera loop smooths jumps). */
const STATION_POS = new Map<StationId, { x: number; y: number }>(
  STATIONS.map((s) => [s.id, { x: s.pos[0], y: s.pos[1] }]),
);
const STATION_POS_MOBILE = new Map<StationId, { x: number; y: number }>(
  STATIONS.map((s) => [s.id, { x: s.mpos[0], y: s.mpos[1] }]),
);

function isStageEvent(e: EngineEvent): e is Extract<EngineEvent, { type: "stage" }> {
  return e.type === "stage";
}

/** Live backend: same PipelineBackend contract as TransitEngine, but events
 *  stream from a real pipeline run (SSE) instead of a scripted timeline.
 *  Pause buffers server events and flushes on resume; stop() kills the
 *  stream, cancels the server run, and drops everything after. */
export class ApiBackend {
  trainPos = { x: 90, y: 540 };
  onRunId: ((id: string, token: string) => void) | null = null;

  private emit: (e: EngineEvent) => void = () => {};
  private es: EventSource | null = null;
  private runId: string | null = null;
  private runToken: string | null = null;
  private apiToken: string | null = null;
  private payload: { file: File; rules: string; retries: number } | null = null;
  private paused = false;
  private dead = false;
  private buffer: EngineEvent[] = [];
  private mobile = false;

  onEvent(cb: (e: EngineEvent) => void) {
    this.emit = cb;
  }
  setPayload(file: File, rules: string, retries = 3) {
    this.payload = { file, rules, retries };
  }
  /** Shared server token (memory-only, never persisted). Sent as
   *  Authorization on POST; the per-run token rides query/header after. */
  setApiToken(t: string) {
    this.apiToken = t.trim() || null;
  }
  setMobile(m: boolean) {
    this.mobile = m;
  }
  setReducedMotion(_r: boolean) {}
  setChaosStall(_on: boolean) {}
  setTestTimeScale(_x: number | null) {}
  setSpeed(_s: Speed) {}

  private deliver(e: EngineEvent) {
    if (this.dead) return;
    if (isStageEvent(e) && e.status === "running") {
      const pos = (this.mobile ? STATION_POS_MOBILE : STATION_POS).get(e.id);
      if (pos) this.trainPos = { ...pos };
    }
    if (this.paused) {
      this.buffer.push(e);
      return;
    }
    this.emit(e);
  }

  start() {
    void this.run();
  }

  private async run() {
    this.stopStream();
    this.dead = false;
    this.buffer = [];
    this.paused = false;
    if (!this.payload) {
      this.emit({ type: "error", text: "live run needs an uploaded file" });
      this.emit({ type: "done", attempts: 0, status: "failed" });
      return;
    }
    const { file, rules, retries } = this.payload;
    let runId: string = "";
    let runToken: string | null = null;
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("rules", rules);
      form.append("retries", String(retries));
      const headers: Record<string, string> = {};
      if (this.apiToken) headers["Authorization"] = `Bearer ${this.apiToken}`;
      const resp = await fetch(`${API_BASE}/runs`, { method: "POST", headers, body: form });
      if (resp.status === 401 || resp.status === 403) {
        this.emit({ type: "error", text: "backend refused the upload (not authorized) — the edge proxy should inject the token (see deploy/README)" });
        this.emit({ type: "done", attempts: 0, status: "failed" });
        return;
      }
      if (resp.status === 409) {
        let detail = "the backend is already running a live consist — wait for it to arrive";
        try {
          const body = (await resp.json()) as { detail?: string };
          if (body.detail) detail = body.detail.slice(0, 200);
        } catch {
          /* keep default */
        }
        this.emit({ type: "error", text: detail });
        this.emit({ type: "done", attempts: 0, status: "failed" });
        return;
      }
      if (!resp.ok) {
        const detail = await resp.text().catch(() => resp.statusText);
        this.emit({ type: "error", text: `backend refused the upload: ${detail.slice(0, 200)}` });
        this.emit({ type: "done", attempts: 0, status: "failed" });
        return;
      }
      const body = (await resp.json()) as { run_id: string; run_token?: string };
      runId = body.run_id;
      runToken = body.run_token ?? null;
    } catch {
      this.emit({ type: "error", text: `live backend unreachable at ${API_BASE} — is uvicorn running? (python -m uvicorn backend_api:app)` });
      this.emit({ type: "done", attempts: 0, status: "failed" });
      return;
    }
    this.runId = runId;
    this.runToken = runToken;
    this.onRunId?.(runId, this.runToken ?? "");
    // EventSource cannot set headers: ownership rides the query string.
    // (TLS/VPN in front; access logs may record URLs — see backend docstring.)
    const streamUrl =
      `${API_BASE}/runs/${runId}/events` +
      (this.runToken ? `?token=${encodeURIComponent(this.runToken)}` : "");
    const es = new EventSource(streamUrl);
    this.es = es;
    es.onmessage = (msg) => {
      try {
        this.deliver(JSON.parse(msg.data) as EngineEvent);
      } catch {
        /* a malformed frame must never kill the stream */
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID; only report when dead.
      if (this.dead) es.close();
    };
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    const queued = this.buffer;
    this.buffer = [];
    for (const e of queued) this.emit(e);
  }

  stop() {
    this.dead = true;
    this.paused = false;
    this.buffer = [];
    this.stopStream();
    const id = this.runId;
    const token = this.runToken;
    this.runId = null;
    this.runToken = null;
    if (id) {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      void fetch(`${API_BASE}/runs/${id}/cancel`, { method: "POST", headers }).catch(() => {});
    }
  }

  private stopStream() {
    this.es?.close();
    this.es = null;
  }

  /** Rebuild attempt N from the server snapshot (scrub + re-dispatch path). */
  async replayAttempt(n: number) {
    if (!this.runId) return;
    this.stopStream();
    this.dead = false;
    this.buffer = [];
    this.paused = false;    let snap: {
      code: string; checks: CheckItem[]; score: number;
      columns: string[]; rows: BatchRow[]; states: CarriageState[];
    };
    try {
      const headers: Record<string, string> = {};
      if (this.runToken) headers["Authorization"] = `Bearer ${this.runToken}`;
      const resp = await fetch(`${API_BASE}/runs/${this.runId}/attempts/${n}`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      snap = (await resp.json()) as typeof snap;
    } catch {
      this.emit({ type: "error", text: `attempt ${n} is gone from the backend — DEPART anew` });
      this.emit({ type: "board", next: "Intake Central", status: "RUN GONE" });
      return;
    }
    this.emit({ type: "stages-reset" });
    this.emit({ type: "score-reset", value: 0 });
    this.emit({ type: "attempt", n });
    this.emit({ type: "code", version: n, source: snap.code });
    this.emit({ type: "checks", items: snap.checks });
    this.emit({ type: "score", value: snap.score });
    this.emit({ type: "carriages", states: snap.states });
    this.emit({ type: "rows", columns: snap.columns, rows: snap.rows });
  }
}
