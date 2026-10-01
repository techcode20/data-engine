/** Transit-simulation types. Stages ARE stations; datasets ride as trains. */
import type { StationId } from "../transit/mapConfig";

export type StageStatus = "idle" | "running" | "passed" | "failed" | "retrying";

export interface StageMeta {
  id: StationId;
  label: string;
  blurb: string;
  detail: string;
  module: string;
  inputs: string[];
  outputs: string[];
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

export type CarriageState = "dirty" | "clean" | "partial" | "rejected";

export interface BatchRow {
  values: string[];
  fate: "kept" | "dropped";
  reason: string;
}

export interface CarriageInfo {
  id: number;
  label: string;
  rows: BatchRow[];
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
  disruption: string | null;
  alert: string;
  logs: Array<{ level: LogLevel; text: string }>;
  newMemory: { nodes: MemoryNode[]; links: MemoryLink[] };
  carriages: CarriageState[];
}

export type Speed = 1 | 2 | 4;

/** Backend contract — the simulated engine implements this; a future
 *  ApiBackend will stream the same events from the real pipeline. */
export interface PipelineBackend {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setSpeed(s: Speed): void;
  replayAttempt(n: number): void;
  onEvent(cb: (e: EngineEvent) => void): void;
}

export type EngineEvent =
  | { type: "stage"; id: StationId; status: StageStatus; durationMs?: number | null }
  | { type: "stages-reset" }
  | { type: "attempt"; n: number }
  | { type: "code"; version: number }
  | { type: "checks"; items: CheckItem[] }
  | { type: "score"; value: number }
  | { type: "log"; level: LogLevel; text: string }
  | { type: "error"; text: string | null }
  | { type: "alert"; text: string }
  | { type: "memory-add"; nodes: MemoryNode[]; links: MemoryLink[] }
  | { type: "carriages"; states: CarriageState[] }
  | { type: "disruption"; on: boolean; label?: string }
  | { type: "reroute"; on: boolean }
  | { type: "crew"; visible: boolean }
  | { type: "board"; next: string; status: string }
  | { type: "tickets" }
  | { type: "done" };
