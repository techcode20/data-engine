import { create } from "zustand";
import { ApiBackend, API_BASE } from "./simulation/api";
import { TransitEngine, type Speed } from "./simulation/engine";
import { baseMemory } from "./simulation/script";
import { CARRIAGES, COLUMNS } from "./simulation/dataset";
import type { StationId } from "./transit/mapConfig";
import type {
  BatchRow,
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

/** 10 MB — anything bigger would freeze the tab in f.text()/JSON.parse. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Default rules prefilled for live uploads (editable at the gate). */
export const DEFAULT_LIVE_RULES = "Every column is required; drop rows with missing values.";

const SNAP_KEY = "pf-transit-state";
const SNAP_VERSION = 2;
const LIVE_KEY = "pf-transit-live";

function saveSnapshot(s: TransitState) {
  try {
    const codeSources = Object.fromEntries(
      Object.entries(s.codeSources).slice(-6),
    );
    sessionStorage.setItem(
      SNAP_KEY,
      JSON.stringify({
        v: SNAP_VERSION,
        file: s.file,
        phase: s.phase,
        attempt: s.attempt,
        maxAttempt: s.maxAttempt,
        score: s.score,
        scoreHistory: s.scoreHistory,
        checks: s.checks,
        errorText: s.errorText,
        disruption: s.disruption,
        rerouteOn: s.rerouteOn,
        crewVisible: false,
        carriages: s.carriages,
        logs: s.logs.slice(-150),
        alerts: s.alerts.slice(-6),
        memNodes: s.memNodes,
        memLinks: s.memLinks,
        board: s.board,
        ticketsOut: s.ticketsOut,
        speed: s.speed,
        viewingVersion: s.viewingVersion,
        latestVersion: s.latestVersion,
        chaosStall: s.chaosStall,
        liveMode: s.liveMode,
        rules: s.rules,
        live: s.live,
        codeSources,
        liveColumns: s.liveColumns,
        liveRows: s.liveRows,
      }),
    );
  } catch {
    /* private mode / quota — the run continues, just not resumable */
  }
}

function loadSnapshot(): Partial<TransitState> | null {
  try {
    const raw = sessionStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (snap?.v !== SNAP_VERSION || !snap?.file) return null;
    return snap;
  } catch {
    return null;
  }
}

type StageState = { status: StageStatus; durationMs: number | null };

interface TransitState {
  file: UploadedFile | null;
  fileError: string | null;
  phase: Phase;
  attempt: number;
  maxAttempt: number;
  needsReplay: boolean;
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
  chaosStall: boolean;
  selectedStation: StationId | null;
  selectedCarriage: number | null;
  logFilter: string;
  logPaused: boolean;
  memoryQuery: string;
  liveMode: boolean;
  rules: string;
  live: { runId: string; base: string } | null;
  codeSources: Record<number, string>;
  liveColumns: string[];
  liveRows: BatchRow[];

  loadSample: () => void;
  loadFile: (f: File) => Promise<void>;
  setRules: (r: string) => void;
  setLiveMode: (b: boolean) => void;
  depart: () => void;
  togglePause: () => void;
  cancelRun: () => void;
  reset: () => void;
  setSpeed: (s: Speed) => void;
  setSound: (b: boolean) => void;
  setChaosStall: (b: boolean) => void;
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

const passedStages = (): Record<StationId, StageState> =>
  Object.fromEntries(
    (Object.keys(STAGE_META) as StationId[]).map((id) => [id, { status: "passed", durationMs: null }]),
  ) as Record<StationId, StageState>;

let logSeq = 0;
let engine: TransitEngine | null = null;
let liveEngine: ApiBackend | null = null;
/** Raw bytes for a live POST (zustand state stays serializable). */
let pendingFile: File | null = null;

function readLiveMode(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("live");
    if (param === "1") return true;
    if (param === "0") return false;
    return localStorage.getItem(LIVE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Synthesize upload bytes for the sample dataset so it can ride live. */
export function sampleAsFile(): File {
  const cell = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const header = [...COLUMNS].map(cell).join(",");
  const lines = CARRIAGES.flatMap((c) => c.rows.map((r) => r.values.map(cell).join(",")));
  return new File([[header, ...lines].join("\n")], "ridership_customers_messy.csv", {
    type: "text/csv",
  });
}

function getEngine(apply: (e: EngineEvent) => void): TransitEngine | ApiBackend {
  const live = useTransit.getState().liveMode;
  if (live) {
    if (!liveEngine) liveEngine = new ApiBackend();
    liveEngine.onEvent(apply);
    return liveEngine;
  }
  if (!engine) engine = new TransitEngine();
  engine.onEvent(apply);
  return engine;
}

export function engineRef(): TransitEngine | ApiBackend | null {
  return useTransit.getState().liveMode ? liveEngine : engine;
}

export const useTransit = create<TransitState>()((set, get) => {
  const restored = loadSnapshot();
  const restoredRunning = restored?.phase === "running";
  const restoredDone = restored?.phase === "done";
  if (restored?.logs?.length) {
    logSeq = Math.max(...restored.logs.map((l: StoredLog) => l.id), 0);
  }

  return {
  file: restored?.file ?? null,
  fileError: null,
  phase: restored?.phase ?? "idle",
  attempt: restored?.attempt ?? 1,
  maxAttempt: restored?.maxAttempt ?? 1,
  // A refresh kills GSAP timelines: a restored mid-run can never resume in
  // place — it must replay its attempt. Flag it so play means "re-dispatch".
  needsReplay: !!restoredRunning,
  maxRetries: 5,
  stages: restoredDone ? passedStages() : idleStages(),
  latestVersion: restored?.latestVersion ?? 1,
  viewingVersion: restored?.viewingVersion ?? 1,
  checks: restored?.checks ?? [],
  score: restored?.score ?? 0,
  scoreHistory: restored?.scoreHistory ?? [],
  errorText: restored?.errorText ?? null,
  disruption: restoredRunning ? null : (restored?.disruption ?? null),
  rerouteOn: restored?.rerouteOn ?? false,
  crewVisible: false,
  carriages: restored?.carriages ?? ["dirty", "dirty", "dirty", "dirty"],
  logs: restored?.logs ?? [],
  alerts: restored?.alerts ?? [],
  memNodes: restored?.memNodes ?? baseMemory().nodes,
  memLinks: restored?.memLinks ?? baseMemory().links,
  board: restoredRunning
    ? { next: "Intake Central", status: "HELD FOR RE-DISPATCH" }
    : (restored?.board ?? { next: "Intake Central", status: "STANDBY" }),
  ticketsOut: restored?.ticketsOut ?? false,
  speed: restored?.speed ?? 1,
  paused: restoredRunning ? true : false,
  sound: false,
  follow: false,
  mobile: false,
  chaosStall: restored?.chaosStall ?? false,
  selectedStation: null,
  selectedCarriage: null,
  logFilter: "ALL",
  logPaused: false,
  memoryQuery: "",
  liveMode: restored?.liveMode ?? readLiveMode(),
  rules: restored?.rules ?? DEFAULT_LIVE_RULES,
  live: restored?.live ?? null,
  codeSources: restored?.codeSources ?? {},
  liveColumns: restored?.liveColumns ?? [],
  liveRows: restored?.liveRows ?? [],

  loadSample: () => {
    pendingFile = null; // live sample rides synthesized bytes, not stale uploads
    set({
      file: { name: "ridership_customers_messy.csv", size: 2156, rows: 8, cols: 7, kind: "sample" },
      fileError: null,
    });
  },

  setRules: (r) => set({ rules: r }),
  setLiveMode: (b) => {
    try {
      localStorage.setItem(LIVE_KEY, b ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ liveMode: b });
  },

  loadFile: async (f: File) => {
    const lower = f.name.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isJson = lower.endsWith(".json");
    if (!isCsv && !isJson) {
      set({ fileError: `No service for "${f.name}" — this gate accepts .csv and .json only.` });
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      set({
        fileError: ` "${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB — the gate caps files at ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        } MB so the tab stays alive. Split it and ride in batches.`,
      });
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
      pendingFile = f;
    } catch {
      set({ fileError: `Could not read "${f.name}" at the gate — is it valid ${isCsv ? "CSV" : "JSON"}?` });
    }
  },

  depart: () => {
    const e = getEngine((ev) => get().applyEvent(ev));
    const live = get().liveMode;
    if (live) {
      const file = get().file;
      const rules = get().rules.trim();
      if (!file) {
        set({ fileError: "Punch a ticket first — a live run needs a file." });
        return;
      }
      if (!rules) {
        set({ fileError: "Live runs need business rules — write a sentence at the gate." });
        return;
      }
      const bytes = file.kind === "sample" ? sampleAsFile() : pendingFile;
      if (!bytes) {
        set({ fileError: `No bytes for "${file.name}" — re-drop the file at the gate.` });
        return;
      }
      e.stop();
      (e as ApiBackend).setPayload(bytes, rules, 3);
      (e as ApiBackend).onRunId = (id) => {
        set({ live: { runId: id, base: API_BASE } });
        saveSnapshot(get());
      };
    } else {
      e.stop();
      (e as TransitEngine).setSpeed(get().speed);
      (e as TransitEngine).setChaosStall(get().chaosStall);
    }
    e.setMobile(get().mobile);
    e.setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    logSeq = 0;
    const mem = baseMemory();
    set({
      phase: "running",
      attempt: 1,
      maxAttempt: 1,
      needsReplay: false,
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
      live: null, // replaced when the backend answers with a run id
      codeSources: {},
      liveColumns: [],
      liveRows: [],
    });
    e.start();
    saveSnapshot(get());
  },

  togglePause: () => {
    if (get().phase !== "running" || !engine) return;
    // Post-refresh timelines are dead: "play" means re-dispatch the attempt.
    if (get().needsReplay) {
      const n = get().attempt;
      set({ needsReplay: false, paused: false });
      engine.setMobile(get().mobile);
      engine.setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      engine.replayAttempt(n);
      return;
    }
    if (get().paused) {
      engine.resume();
      set({ paused: false });
    } else {
      engine.pause();
      set({ paused: true });
    }
  },

  cancelRun: () => {
    if (get().phase !== "running" || !engine) return;
    engine.stop();
    set((s) => {
      const stages = { ...s.stages };
      (Object.keys(stages) as StationId[]).forEach((id) => {
        if (stages[id].status === "running") stages[id] = { ...stages[id], status: "cancelled" };
      });
      return {
        stages,
        paused: false,
        needsReplay: false,
        phase: "idle" as Phase,
        board: { next: "Intake Central", status: "CANCELLED" },
        logs: [...s.logs, { id: ++logSeq, t: "—", level: "WARN", text: "run cancelled by the conductor — partial progress kept on the map" }],
      };
    });
    saveSnapshot(get());
  },

  reset: () => {
    engine?.stop();
    liveEngine?.stop();
    pendingFile = null;
    logSeq = 0;
    try {
      sessionStorage.removeItem(SNAP_KEY);
    } catch {
      /* ignore */
    }
    const mem = baseMemory();
    set({
      phase: "idle",
      attempt: 1,
      maxAttempt: 1,
      needsReplay: false,
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
      live: null,
      codeSources: {},
      liveColumns: [],
      liveRows: [],
    });
  },

  setSpeed: (s) => {
    set({ speed: s });
    engine?.setSpeed(s);
  },
  setSound: (b) => set({ sound: b }),
  setChaosStall: (b) => set({ chaosStall: b }),
  setFollow: (b) => set({ follow: b }),
  setMobile: (m) => {
    if (get().mobile !== m) {
      set({ mobile: m });
      engine?.setMobile(m);
      // In-flight tweens hold detached path geometry after a layout flip —
      // re-dispatch the current attempt instead of glitching mid-track.
      if (get().phase === "running" && engine) {
        engine.replayAttempt(get().attempt);
        set({ paused: false });
      }
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
        // A replay rewinds the map: hide earned tickets until re-earned.
        set({ stages: idleStages(), ticketsOut: false });
        break;
      case "attempt":
        set((s) => ({ attempt: e.n, maxAttempt: Math.max(s.maxAttempt, e.n) }));
        break;
      case "code":
        set((s) => ({
          latestVersion: e.version,
          viewingVersion: e.version,
          codeSources: e.source ? { ...s.codeSources, [e.version]: e.source } : s.codeSources,
        }));
        break;
      case "checks":
        set({ checks: e.items });
        break;
      case "score":
        set((s) => ({ score: e.value, scoreHistory: [...s.scoreHistory, e.value] }));
        break;
      case "score-reset":
        // Scrub replay: REPLACE the path, don't append a second one.
        set({ score: e.value, scoreHistory: e.value === 0 ? [] : [e.value] });
        break;
      case "error":
        set({ errorText: e.text });
        break;
      case "alert":
        set((s) => ({ alerts: [...s.alerts.slice(-5), e.text] }));
        break;
      case "memory-add": {
        const linkKey = (l: MemoryLink) => `${l.source}|${l.target}|${l.label}`;
        set((s) => {
          const known = new Set(s.memLinks.map(linkKey));
          return {
            memNodes: [...s.memNodes, ...e.nodes.filter((n) => !s.memNodes.some((m) => m.id === n.id))],
            memLinks: [...s.memLinks, ...e.links.filter((l) => !known.has(linkKey(l)))],
          };
        });
        break;
      }
      case "carriages":
        set({ carriages: e.states });
        break;
      case "rows":
        set({ liveColumns: e.columns, liveRows: e.rows });
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
          attempt: e.attempts ?? 3,
          scoreHistory: s.scoreHistory.length ? s.scoreHistory : [s.score],
        }));
        break;
    }
    try {
      saveSnapshot(get());
    } catch {
      /* persistence must never break the run */
    }
  },
};
});

