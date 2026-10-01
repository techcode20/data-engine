import type { StationId } from "../transit/mapConfig";

/** Per-station platform content (inputs/outputs/code-or-log source). */
export const STAGE_META: Record<
  StationId,
  { label: string; blurb: string; detail: string; module: string; inputs: string[]; outputs: string[] }
> = {
  intake: {
    label: "Intake Central",
    blurb: "The ticket gate: your file becomes a train of row-batches.",
    detail: "ingest.py · CSV as strings, JSON with native types, paginated APIs",
    module: "ingest.py",
    inputs: ["ridership_customers_messy.csv", "8 rows × 7 cols"],
    outputs: ["DataFrame (4 carriages)", "RAW INGEST REPORT"],
  },
  schema: {
    label: "Schema Square",
    blurb: "Type labels stamped on every carriage window.",
    detail: "schema_inference.py · head + seeded random sample · content-hash cached",
    module: "schema_inference.py",
    inputs: ["15-row sample", "business rules"],
    outputs: ["7-column JSON schema", "int×2 float×1 datetime×1 str×3"],
  },
  code: {
    label: "Code Junction",
    blurb: "The model posts a cleaning timetable, versioned per attempt.",
    detail: "code_gen.py · exact-dtype casting rules · past fixes injected · schema-hash cached",
    module: "code_gen.py",
    inputs: ["target schema", "fix memory (10 entries)"],
    outputs: ["clean(df) v1 → v2 → v3"],
  },
  sandbox: {
    label: "Sandbox Terminal",
    blurb: "The train enters the glass depot; code runs on a copy.",
    detail: "sandbox.py · restricted namespace · original never mutated",
    module: "sandbox.py",
    inputs: ["clean(df)", "raw DataFrame copy"],
    outputs: ["cleaned DataFrame or traceback"],
  },
  validation: {
    label: "Validation Gate",
    blurb: "Five turnstiles: dtype, null, range, unique, regex.",
    detail: "validate.py · pandera lazy checks + sanity guards (drop cap, null columns)",
    module: "validate.py",
    inputs: ["cleaned DataFrame", "pandera schema"],
    outputs: ["6/6 green or failure_cases", "quality score"],
  },
  repair: {
    label: "Repair Depot",
    blurb: "Patches fitted while you wait; new track laid to the main line.",
    detail: "engine retry loop · cap 5 · strict + budget guards",
    module: "engine.py",
    inputs: ["failure_cases", "broken clean(df)"],
    outputs: ["patched clean(df)", "reroute segment"],
  },
  archive: {
    label: "Archive Terminus",
    blurb: "Every fix stamped on a brass card and filed by signature.",
    detail: "fix_memory.py · per-signature cap · 90-day expiry",
    module: "fix_memory.py",
    inputs: ["error + fix pairs"],
    outputs: ["fix_log.jsonl", "code_cache.json"],
  },
};
