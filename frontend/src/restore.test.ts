// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

describe("snapshot restore", () => {
  it("rehydrates a finished run from sessionStorage on boot", async () => {
    const snapshot = {
      v: 2,
      file: { name: "x.csv", size: 10, rows: 2, cols: 1, kind: "csv" },
      phase: "done",
      attempt: 3,
      maxAttempt: 3,
      score: 97,
      scoreHistory: [36, 74, 97],
      checks: [],
      errorText: null,
      disruption: null,
      rerouteOn: true,
      carriages: ["clean", "rejected", "partial", "rejected"],
      logs: [],
      alerts: [],
      memNodes: [],
      memLinks: [],
      board: { next: "Archive Terminus", status: "ALL SERVICES RESTORED" },
      ticketsOut: true,
      speed: 1,
      viewingVersion: 3,
      latestVersion: 3,
    };
    sessionStorage.setItem("pf-transit-state", JSON.stringify(snapshot));
    vi.resetModules();
    const { useTransit } = await import("./store");
    const s = useTransit.getState();
    expect(s.phase).toBe("done");
    expect(s.score).toBe(97);
    expect(s.ticketsOut).toBe(true);
    expect(s.attempt).toBe(3);
    sessionStorage.clear();
  });

  it("settles an orphaned live run to idle instead of a dead running phase", async () => {
    // Refresh drops the memory-only run token, so the fresh tab can neither
    // reattach nor cancel — replayAttempt would no-op and DEPART stays
    // disabled forever. Settle to idle with file+rules kept instead.
    const snapshot = {
      v: 2,
      file: { name: "x.csv", size: 10, rows: 2, cols: 1, kind: "csv" },
      phase: "running",
      attempt: 2,
      maxAttempt: 2,
      liveMode: true,
      live: { runId: "abc123", base: "http://127.0.0.1:8000" },
      rules: "id int",
    };
    sessionStorage.setItem("pf-transit-state", JSON.stringify(snapshot));
    vi.resetModules();
    const { useTransit } = await import("./store");
    const s = useTransit.getState();
    expect(s.phase).toBe("idle");
    expect(s.needsReplay).toBe(false);
    expect(s.paused).toBe(false);
    expect(s.file?.name).toBe("x.csv");
    expect(s.rules).toBe("id int");
    expect(s.fileError).toMatch(/disconnected/);
    sessionStorage.clear();
  });
});
