import { create } from "zustand";
import { Player, type EngineEvent, type Speed } from "./simulation/engine";
import { ATTEMPTS, baseMemory } from "./simulation/script";
import type { CheckItem, MemoryLink, MemoryNode, StageId, StageState } from "./simulation/types";
import { STAGES } from "./simulation/engine";

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

interface PipelineState {
  file: UploadedFile | null;
  fileError: string | null;
  phase: Phase;
  attempt: number;
  maxRetries: number;
  stages: Record<StageId, StageState>;
  latestVersion: number;
  viewingVersion: number;
  checks: CheckItem[];
  score: number;
  scoreHistory: number[];
  errorText: string | null;
  logs: StoredLog[];
  memNodes: MemoryNode[];
  memLinks: MemoryLink[];
  speed: Speed;
  paused: boolean;
  drawer: StageId | null;
  logFilter: string;
  logPaused: boolean;
  memoryQuery: string;

  loadSample: () => void;
  loadFile: (f: File) => Promise<void>;
  run: () => void;
  togglePause: () => void;
  reset: () => void;
  setSpeed: (s: Speed) => void;
  setDrawer: (id: StageId | null) => void;
  setViewingVersion: (v: number) => void;
  setLogFilter: (f: string) => void;
  setLogPaused: (b: boolean) => void;
  setMemoryQuery: (q: string) => void;
  applyEvent: (e: EngineEvent) => void;
}

const idleStages = (): Record<StageId, StageState> =>
  Object.fromEntries(STAGES.map((s) => [s.id, { status: "idle", durationMs: null }])) as Record<StageId, StageState>;

let logSeq = 0;
let player: Player | null = null;

function getPlayer(apply: (e: EngineEvent) => void): Player {
  if (!player) player = new Player(apply);
  return player;
}

export const usePipeline = create<PipelineState>()((set, get) => ({
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
  logs: [],
  memNodes: baseMemory().nodes,
  memLinks: baseMemory().links,
  speed: 1,
  paused: false,
  drawer: null,
  logFilter: "ALL",
  logPaused: false,
  memoryQuery: "",

  loadSample: () =>
    set({
      file: { name: "northwind_customers_messy.csv", size: 1843, rows: 10, cols: 8, kind: "sample" },
      fileError: null,
    }),

  loadFile: async (f: File) => {
    const lower = f.name.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isJson = lower.endsWith(".json");
    if (!isCsv && !isJson) {
      set({ fileError: `Unsupported type "${f.name}". Drop a .csv or .json file.` });
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
      set({ fileError: `Could not parse "${f.name}". Is it valid ${isCsv ? "CSV" : "JSON"}?` });
    }
  },

  run: () => {
    const p = getPlayer((e) => get().applyEvent(e));
    p.stop();
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
      logs: [],
      memNodes: mem.nodes,
      memLinks: mem.links,
      paused: false,
      drawer: null,
    });
    p.setSpeed(get().speed);
    p.start();
  },

  togglePause: () => {
    if (get().phase !== "running") return;
    const p = getPlayer((e) => get().applyEvent(e));
    if (get().paused) {
      p.resume();
      set({ paused: false });
    } else {
      p.pause();
      set({ paused: true });
    }
  },

  reset: () => {
    if (player) player.stop();
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
      logs: [],
      memNodes: mem.nodes,
      memLinks: mem.links,
      paused: false,
      drawer: null,
    });
  },

  setSpeed: (s) => {
    set({ speed: s });
    if (player) player.setSpeed(s);
  },
  setDrawer: (id) => set({ drawer: id }),
  setViewingVersion: (v) => set({ viewingVersion: v }),
  setLogFilter: (f) => set({ logFilter: f }),
  setLogPaused: (b) => set({ logPaused: b }),
  setMemoryQuery: (q) => set({ memoryQuery: q }),

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
      case "log": {
        const id = ++logSeq;
        const stamp = `t+${(id * 0.9).toFixed(1)}s`;
        set((s) => ({ logs: [...s.logs, { id, t: stamp, level: e.level, text: e.text }] }));
        break;
      }
      case "memory-add":
        set((s) => ({
          memNodes: [...s.memNodes, ...e.nodes.filter((n) => !s.memNodes.some((m) => m.id === n.id))],
          memLinks: [...s.memLinks, ...e.links],
        }));
        break;
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
