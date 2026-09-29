/** Core simulation types. The engine behind these is swappable:
 *  implement `PipelineBackend` against the real API and the UI keeps working. */

export type StageStatus = "idle" | "running" | "passed" | "failed" | "retrying";

export type StageId =
  | "ingest"
  | "infer"
  | "generate"
  | "sandbox"
  | "validate"
  | "self-correct"
  | "log-fix";

export interface StageMeta {
  id: StageId;
  label: string;
  blurb: string;
  detail: string;
  /** Real backend module this stage mirrors. */
  module: string;
}

export interface StageState {
  status: StageStatus;
  durationMs: number | null;
}

export type LogLevel = "INFO" | "WARN" | "ERROR" | "FIX" | "OK";

export interface LogEntry {
  id: number;
  t: string;
  level: LogLevel;
  text: string;
}

export interface CheckItem {
  id: string;
  label: string;
  status: "pass" | "fail" | "pending";
  detail: string;
}

export interface CellFlag {
  kind: "null" | "type" | "dup" | "outlier" | "format";
  note: string;
}

export interface MemoryNode {
  id: string;
  kind: "error" | "fix" | "dataset";
  label: string;
  detail: string;
  dataset: string;
}

export interface MemoryLink {
  source: string;
  target: string;
  label: string;
}

export interface AttemptScript {
  attempt: number;
  codeVersion: number;
  score: number;
  summary: string;
  checks: CheckItem[];
  errorFedBack: string | null;
  logs: Array<{ level: LogLevel; text: string }>;
  newMemory: { nodes: MemoryNode[]; links: MemoryLink[] };
}

/** Backend contract — SimulatedBackend implements this today,
 *  a future ApiBackend will POST to the real engine. */
export interface PipelineBackend {
  readonly stages: StageMeta[];
  runDataset(): void;
}
