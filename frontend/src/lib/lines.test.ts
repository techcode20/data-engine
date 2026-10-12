import { expect, test } from "vitest";
import { segmentState } from "./lines";
import type { StationId } from "../transit/mapConfig";
import type { StageStatus } from "../simulation/types";

const idle = (): Record<StationId, { status: StageStatus }> =>
  ({
    intake: { status: "idle" },
    schema: { status: "idle" },
    code: { status: "idle" },
    sandbox: { status: "idle" },
    validation: { status: "idle" },
    repair: { status: "idle" },
    archive: { status: "idle" },
  }) as Record<StationId, { status: StageStatus }>;

test("idle map is neutral ink everywhere", () => {
  for (const id of ["main-a", "main-b", "repair-out", "memory-line", "rejected-siding"]) {
    expect(segmentState(id, idle(), false)).toBe("idle");
  }
});

test("failing beats everything, including repair activity", () => {
  const s = idle();
  s.sandbox = { status: "failed" };
  s.repair = { status: "running" };
  expect(segmentState("main-b", s, true)).toBe("failing");
});

test("repair activity ambers the repair line only", () => {
  const s = idle();
  s.repair = { status: "running" };
  expect(segmentState("repair-out", s, false)).toBe("repair");
  expect(segmentState("main-b", s, false)).toBe("idle");
});

test("completed stages turn their line green", () => {
  const s = idle();
  s.intake = { status: "passed" };
  s.schema = { status: "passed" };
  s.code = { status: "passed" };
  expect(segmentState("main-a", s, false)).toBe("done");
  expect(segmentState("main-b", s, false)).toBe("idle");
});

test("unknown segments stay neutral", () => {
  expect(segmentState("ghost-line", idle(), true)).toBe("idle");
});
