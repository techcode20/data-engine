// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineRef, useTransit } from "./store";

vi.setConfig({ testTimeout: 90000 });

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function waitFor(cond: () => boolean, ms = 60000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error("timed out waiting for condition"));
      setTimeout(poll, 40);
    };
    poll();
  });
}

beforeEach(() => {
  useTransit.getState().reset();
  useTransit.getState().loadSample();
});

describe("scrub replay (V1)", () => {
  it("replaying attempt 1 yields exactly one score path, not a duplicated one", async () => {
    useTransit.getState().depart();
    engineRef()?.setTestTimeScale(500);
    await waitFor(() => useTransit.getState().phase === "done");
    expect(useTransit.getState().scoreHistory).toEqual([36, 74, 97]);
    expect(useTransit.getState().ticketsOut).toBe(true);

    useTransit.getState().scrubToAttempt(1);
    // Rewind reverts earned state: tickets hide until re-earned.
    expect(useTransit.getState().ticketsOut).toBe(false);
    await waitFor(() => useTransit.getState().phase === "done");
    // The replayed run must produce ONE clean path, not [36,74,97,0,36,74,97].
    expect(useTransit.getState().scoreHistory).toEqual([36, 74, 97]);
    expect(useTransit.getState().ticketsOut).toBe(true);
  });

  it("replaying does not duplicate memory links", async () => {
    useTransit.getState().depart();
    engineRef()?.setTestTimeScale(500);
    await waitFor(() => useTransit.getState().phase === "done");
    const linksAfterRun = useTransit.getState().memLinks.length;

    useTransit.getState().scrubToAttempt(2);
    await waitFor(() => useTransit.getState().phase === "done");
    const keys = useTransit
      .getState()
      .memLinks.map((l) => `${l.source}|${l.target}|${l.label}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(useTransit.getState().memLinks.length).toBe(linksAfterRun);
  });
});
