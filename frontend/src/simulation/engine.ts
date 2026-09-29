import { ATTEMPTS, STAGE_ORDER } from "./script";
import type { AttemptScript, CheckItem, LogEntry, LogLevel, MemoryLink, MemoryNode, StageId, StageMeta, StageStatus } from "./types";

export const STAGES: StageMeta[] = [
  { id: "ingest", label: "Ingest", blurb: "Load CSV / JSON / paginated API into a DataFrame.", detail: "ingest.py · dtype=str for CSV, native types for JSON · Link / page-param / auto pagination · Bearer auth via DATA_API_KEY", module: "ingest.py" },
  { id: "infer", label: "Infer Schema", blurb: "LLM proposes types, nullability, allowed values.", detail: "schema_inference.py · head + seeded random sample (default 15 rows) · cached per content hash", module: "schema_inference.py" },
  { id: "generate", label: "Generate Code", blurb: "Model writes clean(df) for the target schema.", detail: "code_gen.py · exact-dtype casting rules · past fixes injected · known-good code cached by schema hash", module: "code_gen.py" },
  { id: "sandbox", label: "Sandbox Execute", blurb: "Run clean() on a copy; capture tracebacks.", detail: "sandbox.py · exec() in restricted namespace · original DataFrame never mutated", module: "sandbox.py" },
  { id: "validate", label: "Validate", blurb: "Pandera schema + sanity guards.", detail: "validate.py · dtype / nullable / range / unique / regex + drop-fraction + null-column guards", module: "validate.py" },
  { id: "self-correct", label: "Self-Correct", blurb: "Feed failures back; patch the function.", detail: "engine retry loop · cap 5 · strict mode fails fast · budget guard stops spend", module: "engine.py" },
  { id: "log-fix", label: "Log Fix", blurb: "Store the lesson in fix memory.", detail: "fix_memory.py · deduped by error signature · 90-day expiry · reused as prompt experience", module: "fix_memory.py" },
];

export type EngineEvent =
  | { type: "stage"; id: StageId; status: StageStatus; durationMs?: number | null }
  | { type: "stages-reset" }
  | { type: "attempt"; n: number }
  | { type: "code"; version: number }
  | { type: "checks"; items: CheckItem[] }
  | { type: "score"; value: number }
  | { type: "log"; level: LogLevel; text: string }
  | { type: "error"; text: string | null }
  | { type: "memory-add"; nodes: MemoryNode[]; links: MemoryLink[] }
  | { type: "done" };

interface Timed {
  at: number;
  event: EngineEvent;
}

const STAGE_MS: Record<StageId, number> = {
  ingest: 1200,
  infer: 1500,
  generate: 1900,
  sandbox: 1100,
  validate: 1400,
  "self-correct": 1300,
  "log-fix": 800,
};

/** Build the full scripted timeline (milliseconds at 1x). ~26s total. */
export function buildTimeline(): Timed[] {
  const tl: Timed[] = [];
  let t = 400;

  const stageBlock = (ids: StageId[], attempt: AttemptScript, opts?: { validateFails?: boolean; skipCorrect?: boolean }) => {
    for (const id of ids) {
      const dur = STAGE_MS[id];
      tl.push({ at: t, event: { type: "stage", id, status: "running" } });
      if (id === "generate") {
        tl.push({ at: t + 200, event: { type: "code", version: attempt.codeVersion } });
      }
      t += dur;
      if (id === "validate") {
        tl.push({ at: t - 500, event: { type: "checks", items: attempt.checks } });
        tl.push({ at: t - 500, event: { type: "score", value: attempt.score } });
        if (opts?.validateFails) {
          tl.push({ at: t - 400, event: { type: "error", text: attempt.errorFedBack } });
          tl.push({ at: t, event: { type: "stage", id, status: "failed", durationMs: dur } });
        } else {
          tl.push({ at: t - 400, event: { type: "error", text: null } });
          tl.push({ at: t, event: { type: "stage", id, status: "passed", durationMs: dur } });
        }
      } else if (id === "self-correct" && opts?.skipCorrect) {
        tl.push({ at: t, event: { type: "stage", id, status: "passed", durationMs: 300 } });
      } else {
        tl.push({ at: t, event: { type: "stage", id, status: "passed", durationMs: dur } });
      }
      t += 350;
    }
  };

  /** Spread an attempt's logs evenly across its stage block so each line
   *  lands while the stage it describes is on screen. */
  const spanFor = (ids: StageId[]) =>
    ids.reduce((a, id) => a + STAGE_MS[id], 0) + 350 * ids.length;
  const pushLogs = (attempt: AttemptScript, startT: number, span: number) => {
    const n = attempt.logs.length;
    attempt.logs.forEach((l, i) => {
      tl.push({ at: startT + Math.round(((i + 1) / (n + 1)) * span), event: { type: "log", level: l.level, text: l.text } });
    });
  };

  const runAttempt = (n: number, ids: StageId[], attempt: AttemptScript, opts?: { validateFails?: boolean; skipCorrect?: boolean }) => {
    tl.push({ at: t, event: { type: "attempt", n } });
    pushLogs(attempt, t, spanFor(ids));
    stageBlock(ids, attempt, opts);
    tl.push({ at: t, event: { type: "memory-add", nodes: attempt.newMemory.nodes, links: attempt.newMemory.links } });
    t += 600;
    if (n < 3) {
      tl.push({ at: t, event: { type: "stages-reset" } });
      t += 500;
    } else {
      t += 800;
      tl.push({ at: t, event: { type: "done" } });
    }
  };

  // Attempt 1: full 7-stage sweep, validate fails
  runAttempt(1, [...STAGE_ORDER], ATTEMPTS[0], { validateFails: true });
  // Attempt 2: regenerate from v2, validate fails again
  runAttempt(2, ["generate", "sandbox", "validate", "self-correct", "log-fix"], ATTEMPTS[1], { validateFails: true });
  // Attempt 3: passes; self-correct is a no-op pass
  runAttempt(3, ["generate", "sandbox", "validate", "self-correct", "log-fix"], ATTEMPTS[2], { skipCorrect: true });

  return tl;
}

export const TOTAL_MS = 27000;

export type Speed = 1 | 2;

/** Tick-based player: pause-safe, speed-scalable, resettable. */
export class Player {
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock = 0;
  private idx = 0;
  private events: Timed[] = [];
  speed: Speed = 1;
  playing = false;
  private emit: (e: EngineEvent) => void;

  constructor(emit: (e: EngineEvent) => void) {
    this.emit = emit;
  }

  get duration() {
    return this.events.length ? this.events[this.events.length - 1].at + 500 : 0;
  }

  start() {
    this.stop();
    this.events = buildTimeline();
    this.clock = 0;
    this.idx = 0;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), 60);
  }

  pause() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resume() {
    if (this.playing || this.idx >= this.events.length) return;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), 60);
  }

  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setSpeed(s: Speed) {
    this.speed = s;
  }

  private tick() {
    this.clock += 60 * this.speed;
    while (this.idx < this.events.length && this.events[this.idx].at <= this.clock) {
      this.emit(this.events[this.idx].event);
      this.idx += 1;
    }
    if (this.idx >= this.events.length) this.stop();
  }
}

export type { LogEntry };
