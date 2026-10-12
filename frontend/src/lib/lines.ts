import type { StageStatus } from "../simulation/types";
import type { StationId } from "../transit/mapConfig";

export type LineState = "idle" | "repair" | "done" | "failing";

/** Which stages power each drawn segment. */
const SEGMENT_STAGES: Record<string, StationId[]> = {
  "main-a": ["intake", "schema", "code"],
  "main-b": ["sandbox", "validation"],
  "validation-branch": ["validation"],
  "repair-out": ["repair"],
  "repair-reroute": ["repair"],
  "memory-line": ["archive"],
  "rejected-siding": ["validation"],
};

export const LINE_STATE_STYLE: Record<LineState, { color: string; dash?: string }> = {
  idle: { color: "#141210" },
  repair: { color: "#f59e0b", dash: "2 7" },
  done: { color: "#16a34a" },
  failing: { color: "#e3342f", dash: "10 6" },
};

/** State-driven track colour with non-colour cues (dash patterns).
 *  Priority: failing (any mapped stage failed) > repair active (repair
 *  running/retrying, or the reroute track showing) > done (all passed) >
 *  idle. Unknown segments stay neutral ink. */
export function segmentState(
  segmentId: string,
  stages: Record<StationId, { status: StageStatus }>,
  rerouteOn: boolean,
): LineState {
  const ids = SEGMENT_STAGES[segmentId];
  if (!ids) return "idle";
  const statuses = ids.map((id) => stages[id]?.status ?? "idle");
  if (statuses.some((s) => s === "failed")) return "failing";
  if (
    statuses.some((s) => s === "running" || s === "retrying" || s === "timeout") &&
    (ids.includes("repair") || rerouteOn)
  ) {
    return "repair";
  }
  if (statuses.every((s) => s === "passed")) return "done";
  return "idle";
}
