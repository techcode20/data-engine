// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STAGE_STATUS_LABEL } from "./tokens";

function lum(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = c.map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

function ratio(fg: string, bg: string): number {
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("contrast (V4/V6)", () => {
  it("faint secondary text meets AA on paper (4.5:1 for small text)", () => {
    // Used for: disabled tabs, placeholders, empty states, timestamps, legend.
    expect(ratio("a8a091", "f6f3ea")).toBeGreaterThanOrEqual(4.5);
  });

  it("white-on-green status chips meet AA for small text", () => {
    // Used for: RIDES ON / SHUNTED chips, pass pills (10-11px).
    expect(ratio("ffffff", "16a34a")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("station states (V5)", () => {
  it("covers timeout and cancelled, not just happy-path statuses", () => {
    for (const s of ["idle", "running", "passed", "failed", "retrying", "timeout", "cancelled"]) {
      expect(STAGE_STATUS_LABEL[s], `missing status: ${s}`).toBeDefined();
    }
  });
});
