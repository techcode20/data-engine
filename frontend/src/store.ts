import { create } from "zustand";
import { TransitEngine, type Speed } from "./simulation/engine";
import { ATTEMPTS, baseMemory } from "./simulation/script";
import type { StationId } from "./transit/mapConfig";
import type {
  CarriageState,
  CheckItem,
  EngineEvent,
  MemoryLink,
  MemoryNode,
  StageStatus,
} from "./simulation/types";
import { STAGE_META } from "./simulation/stageMeta";

export interface UploadedFile {
  name: string;
  size: number;
  rows: number;
  cols: number;
  kind: "csv" | "json" | "sample";
}

export type Phase = "idle" | "running" | "done";

export interface StoredLog {
  id: number;
  t: string;
  level: string;
  text: string;
}

type StageState = { status: StageStatus; durationMs: number | null };

interface TransitState {
  file: UploadedFile | null;
  fileError: string | null;
  phase: Phase;
  attempt: number;
  maxRetries: number;
  stages: Record<StationId, StageState>;
  latestVersion: number;
  viewingVersion: number;
  checks: CheckItem[];
  score: number;
  scoreHistory: number[];
  errorText: string | null;
  disruption: string | null;
  rerouteOn: boolean;
  crewVisible: boolean;
  carriages: CarriageState[];
  logs: StoredLog[];
  alerts: string[];
  memNodes: MemoryNode[];
  memLinks: MemoryLink[];
  board: { next: string; status: string };
  ticketsOut: boolean;
  speed: Speed;
  paused: boolean;
  sound: boolean;
  follow: boolean;
  mobile: boolean;
  selectedStation: StationId | null;
  selectedCarriage: number | null;
  logFilter: string;
  logPaused: boolean;
  memoryQuery: string;

  loadSample: () => void;
  loadFile: (f: File) => Promise<void>;
  depart: () => void;
  togglePause: () => void;
  reset: () => void;
  setSpeed: (s: Speed) => void;
  setSound: (b: boolean) => void;
  setFollow: (b: boolean) => void;
  setMobile: (m: boolean) => void;
  selectStation: (id: StationId | null) => void;
  selectCarriage: (n: number | null) => void;
  setViewingVersion: (v: number) => void;
  setLogFilter: (f: string) => void;
  setLogPaused: (b: boolean) => void;
  setMemoryQuery: (q: string) => void;
  scrubToAttempt: (n: number) => void;
  applyEvent: (e: EngineEvent) => void;
}

const idleStages = (): Record<StationId, StageState> =>
  Object.fromEntries(
    (Object.keys(STAGE_META) as StationId[]).map((id) => [id, { status: "idle", durationMs: null }]),
  ) as Record<StationId, StageState>;

let logSeq = 0;
let engine: TransitEngine | null = null;

function getEngine(apply: (e: EngineEvent) => void): TransitEngine {
  if (!engine) engine = new TransitEngine();
  engine.onEvent(apply);
  return engine;
}

export function engineRef(): TransitEngine | null {
  return engine;
}

export const useTransit = create<TransitState>()((set, get) => ({
  file: null,
  fileError: null,
  phase: "idle",
  attempt: 1,
  maxRetries: 5,
  stages: idleStages(),
  latestVersion: 1,
  viewingVersion: 1,
  checks: [],
  score: 0,
  scoreHistory: [],
  errorText: null,
  disruption: null,
  rerouteOn: false,
  crewVisible: false,
  carriages: ["dirty", "dirty", "dirty", "dirty"],
  logs: [],
  alerts: [],
  memNodes: baseMemory().nodes,
  memLinks: baseMemory().links,
  board: { next: "Intake Central", status: "STANDBY" },
  ticketsOut: false,
  speed: 1,
  paused: false,
  sound: false,
  follow: false,
  mobile: false,
  selectedStation: null,
  selectedCarriage: null,
  logFilter: "ALL",
  logPaused: false,
  memoryQuery: "",

  loadSample: () =>
    set({
      file: { name: "ridership_customers_messy.csv", size: 2156, rows: 8, cols: 7, kind: "sample" },
      fileError: null,
    }),

  loadFile: async (f: File) => {
    const lower = f.name.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isJson = lower.endsWith(".json");
    if (!isCsv && !isJson) {
      set({ fileError: `No service for "${f.name}" — this gate accepts .csv and .json only.` });
      return;
    }
    try {
      const text = await f.text();
      let rows = 0;
      let cols = 0;
      if (isCsv) {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        rows = Math.max(0, lines.length - 1);
        cols = lines.length ? lines[0].split(",").length : 0;
      } else {
        const parsed: unknown = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        rows = arr.length;
        cols = arr.length ? Object.keys(arr[0] as object).length : 0;
      }
      set({
        file: { name: f.name, size: f.size, rows, cols, kind: isCsv ? "csv" : "json" },
        fileError: null,
      });
    } catch {
      set({ fileError: `Could not read "${f.name}" at the gate — is it valid ${isCsv ? "CSV" : "JSON"}?` });
    }
  },

  depart: () => {
    const e = getEngine((ev) => get().applyEvent(ev));
    e.stop();
    e.setSpeed(get().speed);
    e.setMobile(get().mobile);
    e.setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    logSeq = 0;
    const mem = baseMemory();
    set({
      phase: "running",
      attempt: 1,
      stages: idleStages(),
      latestVersion: 1,
      viewingVersion: 1,
      checks: [],
      score: 0,
      scoreHistory: [],
      errorText: null,
      disruption: null,
      rerouteOn: false,
      crewVisible: false,
      carriages: ["dirty", "dirty", "dirty", "dirty"],
      logs: [],
      alerts: [],
      memNodes: mem.nodes,
      memLinks: mem.links,
      board: { next: "Intake Central", status: "BOARDING" },
      ticketsOut: false,
      paused: false,
      selectedStation: null,
      selectedCarriage: null,
    });
    e.start();
  },

  togglePause: () => {
    if (get().phase !== "running" || !engine) return;
    if (get().paused) {
      engine.resume();
      set({ paused: false });
    } else {
      engine.pause();
      set({ paused: true });
    }
  },

  reset: () => {
    engine?.stop();
    logSeq = 0;
    const mem = baseMemory();
    set({
      phase: "idle",
      attempt: 1,
      stages: idleStages(),
      latestVersion: 1,
      viewingVersion: 1,
      checks: [],
      score: 0,
      scoreHistory: [],
      errorText: null,
      disruption: null,
      rerouteOn: false,
      crewVisible: false,
      carriages: ["dirty", "dirty", "dirty", "dirty"],
      logs: [],
      alerts: [],
      memNodes: mem.nodes,
      memLinks: mem.links,
      board: { next: "Intake Central", status: "STANDBY" },
      ticketsOut: false,
      paused: false,
      selectedStation: null,
      selectedCarriage: null,
    });
  },

  setSpeed: (s) => {
    set({ speed: s });
    engine?.setSpeed(s);
  },
  setSound: (b) => set({ sound: b }),
  setFollow: (b) => set({ follow: b }),
  setMobile: (m) => {
    if (get().mobile !== m) {
      set({ mobile: m });
      engine?.setMobile(m);
    }
  },
  selectStation: (id) => set({ selectedStation: id }),
  selectCarriage: (n) => set({ selectedCarriage: n }),
  setViewingVersion: (v) => set({ viewingVersion: v }),
  setLogFilter: (f) => set({ logFilter: f }),
  setLogPaused: (b) => set({ logPaused: b }),
  setMemoryQuery: (q) => set({ memoryQuery: q }),

  scrubToAttempt: (n: number) => {
    if (get().phase === "idle" || !engine) return;
    engine.setMobile(get().mobile);
    engine.setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    engine.replayAttempt(n);
    set({ paused: false, phase: "running" });
  },

  applyEvent: (e) => {
    switch (e.type) {
      case "stage":
        set((s) => ({
          stages: {
            ...s.stages,
            [e.id]: { status: e.status, durationMs: e.durationMs ?? s.stages[e.id].durationMs },
          },
        }));
        break;
      case "stages-reset":
        set({ stages: idleStages() });
        break;
      case "attempt":
        set({ attempt: e.n });
        break;
      case "code":
        set({ latestVersion: e.version, viewingVersion: e.version });
        break;
      case "checks":
        set({ checks: e.items });
        break;
      case "score":
        set((s) => ({ score: e.value, scoreHistory: [...s.scoreHistory, e.value] }));
        break;
      case "error":
        set({ errorText: e.text });
        break;
      case "alert":
        set((s) => ({ alerts: [...s.alerts.slice(-5), e.text] }));
        break;
      case "memory-add":
        set((s) => ({
          memNodes: [...s.memNodes, ...e.nodes.filter((n) => !s.memNodes.some((m) => m.id === n.id))],
          memLinks: [...s.memLinks, ...e.links],
        }));
        break;
      case "carriages":
        set({ carriages: e.states });
        break;
      case "disruption":
        set({ disruption: e.on ? (e.label ?? "Signal fault") : null });
        break;
      case "reroute":
        set({ rerouteOn: e.on });
        break;
      case "crew":
        set({ crewVisible: e.visible });
        break;
      case "board":
        set({ board: { next: e.next, status: e.status } });
        break;
      case "tickets":
        set({ ticketsOut: true });
        break;
      case "log": {
        const id = ++logSeq;
        const stamp = `t+${(id * 0.9).toFixed(1)}s`;
        set((s) => ({ logs: [...s.logs, { id, t: stamp, level: e.level, text: e.text }] }));
        break;
      }
      case "done":
        set((s) => ({
          phase: "done",
          paused: false,
          attempt: 3,
          scoreHistory: s.scoreHistory.length ? s.scoreHistory : [ATTEMPTS[2].score],
        }));
        break;
    }
  },
}));
