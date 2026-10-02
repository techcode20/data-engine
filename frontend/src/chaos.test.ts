// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TransitEngine } from "./simulation/engine";
import type { EngineEvent } from "./simulation/types";

function waitFor(cond: () => boolean, ms = 60000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error("timed out waiting"));
      setTimeout(poll, 40);
    };
    poll();
  });
}

describe("chaos stall", () => {
  it("emits a real sandbox timeout on attempt 1, then recovers to done", async () => {
    const eng = new TransitEngine();
    const stages: string[] = [];
    let done = false;
    eng.onEvent((e: EngineEvent) => {
      if (e.type === "stage") stages.push(`${(e as { id: string }).id}:${(e as { status: string }).status}`);
      if (e.type === "done") done = true;
    });
    eng.setChaosStall(true);
    eng.setTestTimeScale(300);
    eng.start();
    await waitFor(() => done);
    // The timeout state is genuinely produced by the engine…
    expect(stages).toContain("sandbox:timeout");
    // …validation is skipped for the stalled attempt (nothing to validate)…
    const sandboxIdx = stages.indexOf("sandbox:timeout");
    const validationIdx = stages.findIndex((s) => s.startsWith("validation:"));
    expect(validationIdx).toBeGreaterThan(sandboxIdx);
    // …and the run still completes.
    expect(done).toBe(true);
  });
});
