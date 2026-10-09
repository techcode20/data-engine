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
});
