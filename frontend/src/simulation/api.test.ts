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
  // Follow-camera rides to the running station.
  expect(backend.trainPos).toEqual({ x: 750, y: 540 });
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
