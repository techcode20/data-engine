// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { useTransit } from "./store";

describe("upload gate (V2)", () => {
  it("rejects absurdly large files instead of reading them whole into memory", async () => {
    const big = "id,name\n" + "1,Alice\n".repeat(3_500_000); // ~25MB
    const file = new File([big], "huge.csv", { type: "text/csv" });
    await useTransit.getState().loadFile(file);
    const s = useTransit.getState();
    // Today: accepted without complaint (file set, no error).
    expect(s.file).toBeNull();
    expect(s.fileError ?? "").toMatch(/too large/i);
  }, 60000);
});

describe("session persistence (V3)", () => {
  it("persists run state so a refresh can rehydrate it", () => {
    useTransit.getState().loadSample();
    useTransit.getState().depart();
    // Nothing is ever written to storage today.
    expect(sessionStorage.getItem("pf-transit-state")).not.toBeNull();
    useTransit.getState().reset();
  });
});
