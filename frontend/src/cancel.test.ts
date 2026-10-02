// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { useTransit } from "./store";

describe("cancel run", () => {
  it("marks the running stage cancelled and parks the run idle", () => {
    const s = useTransit.getState();
    s.loadSample();
    s.depart();
    s.togglePause(); // freeze before any stage can complete
    s.applyEvent({ type: "stage", id: "sandbox", status: "running" });
    s.cancelRun();
    const st = useTransit.getState();
    expect(st.stages.sandbox.status).toBe("cancelled");
    expect(st.phase).toBe("idle");
    expect(st.board.status).toBe("CANCELLED");
    s.reset();
  });

  it("is a no-op outside a run", () => {
    useTransit.getState().reset();
    useTransit.getState().cancelRun();
    expect(useTransit.getState().phase).toBe("idle");
  });
});
