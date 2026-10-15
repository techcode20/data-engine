import { beforeEach, expect, test, vi } from "vitest";
import { ApiBackend } from "./api";
import type { EngineEvent } from "./types";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  send(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

function mockFetchOnce(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

const okRun = (token = "") => ({
  ok: true,
  status: 202,
  json: async () => ({ run_id: "abc123", run_token: token || undefined }),
  text: async () => "",
});
const okSnapshot = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    code: "def clean(df):\n    return df",
    checks: [{ id: "schema", label: "Schema validation", status: "pass", detail: "2/2 rows" }],
    score: 100,
    columns: ["id"],
    rows: [{ values: ["1"], cleaned: ["1"], fate: "kept", reason: "survived validation" }],
    states: ["clean"],
  }),
  text: async () => "",
});

beforeEach(() => {
  MockEventSource.instances = [];
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", MockEventSource);
});

function collect(backend: ApiBackend) {
  const events: EngineEvent[] = [];
  backend.onEvent((e) => events.push(e));
  return events;
}

test("start posts the upload and streams server events", async () => {
  const calls = mockFetchOnce(() => okRun());
  const backend = new ApiBackend();
  const events = collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "id is required");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  const es = MockEventSource.instances[0];
  expect(calls[0].url).toMatch(/\/runs$/);
  expect(es.url).toMatch(/\/runs\/abc123\/events$/);
  expect(backend["runId"]).toBe("abc123");

  es.send({ type: "stage", id: "sandbox", status: "running" });
  es.send({ type: "score", value: 62 });
  expect(events).toContainEqual({ type: "stage", id: "sandbox", status: "running" });
  expect(events).toContainEqual({ type: "score", value: 62 });
  // The consist glides to the running station instead of snapping to it.
  expect(backend.trainPos).toEqual({ x: 90, y: 540 });
  for (let i = 0; i < 200; i++) backend.update(16);
  expect(backend.trainPos.x).toBeCloseTo(750, 0);
  expect(backend.trainPos.y).toBeCloseTo(540, 0);
});

test("retry boards at Intake Central, not where the last run parked", async () => {  mockFetchOnce(() => okRun());
  const backend = new ApiBackend();
  collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "id is required");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  // Previous run parked at Repair Depot; DEPART again snaps back to start.
  backend.trainPos = { x: 760, y: 450 };
  backend.start();
  expect(backend.trainPos).toEqual({ x: 90, y: 540 });
});

test("pause buffers and resume flushes in order", async () => {
  mockFetchOnce(() => okRun());
  const backend = new ApiBackend();
  const events = collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "id is required");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  const es = MockEventSource.instances[0];
  backend.pause();
  es.send({ type: "score", value: 10 });
  es.send({ type: "score", value: 20 });
  expect(events).toHaveLength(0);
  backend.resume();
  expect(events).toEqual([
    { type: "score", value: 10 },
    { type: "score", value: 20 },
  ]);
});

test("stop closes the stream and cancels the server run", async () => {
  const calls = mockFetchOnce((url) =>
    url.endsWith("/cancel") ? { ok: true, status: 200, json: async () => ({}), text: async () => "" } : okRun(),
  );
  const backend = new ApiBackend();
  collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "id is required");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  // Events after stop are dropped, never emitted.
  backend.stop();
  MockEventSource.instances[0].send({ type: "score", value: 99 });
  expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(true);
  expect(MockEventSource.instances[0].closed).toBe(true);
});

test("409 busy and unreachable backend surface as errors", async () => {
  mockFetchOnce(() => ({ ok: false, status: 409, json: async () => ({}), text: async () => "busy" }));
  const busy = new ApiBackend();
  const busyEvents = collect(busy);
  busy.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "r");
  busy.start();
  await vi.waitFor(() => expect(busyEvents.some((e) => e.type === "done")).toBe(true));
  expect(busyEvents.some((e) => e.type === "error")).toBe(true);

  mockFetchOnce(() => {
    throw new Error("down");
  });
  const dead = new ApiBackend();
  const deadEvents = collect(dead);
  dead.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "r");
  dead.start();
  await vi.waitFor(() => expect(deadEvents.some((e) => e.type === "done")).toBe(true));
  expect(deadEvents.find((e) => e.type === "error")).toMatchObject({ type: "error" });
});

test("replayAttempt rebuilds the attempt from a server snapshot", async () => {
  mockFetchOnce((url) => (url.includes("/attempts/") ? okSnapshot() : okRun()));
  const backend = new ApiBackend();
  const events = collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "r");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  await backend.replayAttempt(2);
  const kinds = events.map((e) => e.type);
  expect(kinds).toEqual([
    "stages-reset",
    "score-reset",
    "attempt",
    "code",
    "checks",
    "score",
    "carriages",
    "rows",
  ]);
  expect(events).toContainEqual({ type: "attempt", n: 2 });
  expect(events).toContainEqual({
    type: "code",
    version: 2,
    source: "def clean(df):\n    return df",
  });
});

test("shared token rides POST; run token rides stream, replay, and cancel", async () => {
  const calls = mockFetchOnce((url) => {
    if (url.endsWith("/cancel")) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    }
    if (url.includes("/attempts/")) return okSnapshot();
    return okRun("run-secret");
  });
  const backend = new ApiBackend();
  const seen: Array<{ id: string; token: string }> = [];
  backend.onRunId = (id, token) => seen.push({ id, token });
  backend.onEvent(() => {});
  backend.setApiToken("shared-secret");
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "r");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  expect(seen).toEqual([{ id: "abc123", token: "run-secret" }]);
  const post = calls.find((c) => c.url.endsWith("/runs"));
  expect((post?.init?.headers as Record<string, string>)["Authorization"]).toBe(
    "Bearer shared-secret",
  );
  // EventSource cannot set headers: ownership rides the query string.
  expect(MockEventSource.instances[0].url).toContain("?token=run-secret");
  await backend.replayAttempt(1);
  const replay = calls.find((c) => c.url.includes("/attempts/"));
  expect((replay?.init?.headers as Record<string, string>)["Authorization"]).toBe(
    "Bearer run-secret",
  );
  backend.stop();
  const cancel = calls.find((c) => c.url.endsWith("/cancel"));
  expect((cancel?.init?.headers as Record<string, string>)["Authorization"]).toBe(
    "Bearer run-secret",
  );
});

test("401 from a token-guarded backend surfaces a token hint", async () => {
  mockFetchOnce(() => ({ ok: false, status: 401, json: async () => ({}), text: async () => "no" }));
  const backend = new ApiBackend();
  const events = collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "r");
  backend.start();
  await vi.waitFor(() => expect(events.some((e) => e.type === "done")).toBe(true));
  expect(events.find((e) => e.type === "error")?.text).toMatch(/token/);
});

async function startedBackend() {
  mockFetchOnce(() => okRun());
  const backend = new ApiBackend();
  collect(backend);
  backend.setPayload(new File(["id\n1\n"], "t.csv", { type: "text/csv" }), "r");
  backend.start();
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  return { backend, es: MockEventSource.instances[0] };
}

test("glide eases station to station with a dwell beat", async () => {
  const { backend, es } = await startedBackend();
  // Burst arrival (intake/schema/code fire together): no snapping, the
  // consist rides intake → schema → code with visible travel time.
  es.send({ type: "stage", id: "intake", status: "running" });
  es.send({ type: "stage", id: "schema", status: "running" });
  // Mid-leg the consist is between stations, upright on the main line.
  for (let i = 0; i < 30; i++) backend.update(16);
  expect(backend.trainPos.x).toBeGreaterThan(90);
  expect(backend.trainPos.x).toBeLessThan(310);
  expect(backend.trainPos.y).toBeCloseTo(540, 0);
  // Settles at Schema Square, then holds the dwell beat.
  for (let i = 0; i < 200; i++) backend.update(16);
  expect(backend.trainPos.x).toBeCloseTo(310, 0);
  const held = { ...backend.trainPos };
  for (let i = 0; i < 10; i++) backend.update(16);
  expect(backend.trainPos).toEqual(held);
});

test("bursts queue station visits in order, none skipped", async () => {
  const { backend, es } = await startedBackend();
  es.send({ type: "stage", id: "schema", status: "running" });
  for (let i = 0; i < 20; i++) backend.update(16);
  const mid = { ...backend.trainPos };
  expect(mid.x).toBeGreaterThan(90);
  // Code fires mid-leg: the glide finishes schema first, then rides code —
  // continuity, no jump to the latest.
  es.send({ type: "stage", id: "code", status: "running" });
  backend.update(16);
  expect(Math.abs(backend.trainPos.x - mid.x)).toBeLessThan(20);
  const trail: number[] = [];
  for (let i = 0; i < 300; i++) {
    backend.update(16);
    trail.push(backend.trainPos.x);
  }
  expect(backend.trainPos.x).toBeCloseTo(530, 0);
  const schemaIdx = trail.findIndex((x) => Math.abs(x - 310) < 5);
  const codeIdx = trail.findIndex((x) => Math.abs(x - 530) < 5);
  expect(schemaIdx).toBeGreaterThanOrEqual(0);
  expect(codeIdx).toBeGreaterThan(schemaIdx);
});

test("depart-scale jumps teleport instead of riding across the map", async () => {
  const { backend, es } = await startedBackend();
  backend.trainPos = { x: 970, y: 160 }; // stranded far away (scrub case)
  es.send({ type: "stage", id: "intake", status: "running" });
  expect(backend.trainPos).toEqual({ x: 90, y: 540 });
});

test("reduced motion snaps between stations", async () => {
  const { backend, es } = await startedBackend();
  backend.setReducedMotion(true);
  es.send({ type: "stage", id: "sandbox", status: "running" });
  expect(backend.trainPos).toEqual({ x: 750, y: 540 });
});
