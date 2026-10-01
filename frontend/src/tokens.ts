/** PipelineForge Transit — single source of truth for design tokens. */

export const COLORS = {
  paper: "#f6f3ea",
  card: "#fffdf6",
  ink: "#141210",
  muted: "#6b6455",
  faint: "#a8a091",
  main: "#e3342f",
  validation: "#2563eb",
  memory: "#16a34a",
  repair: "#f59e0b",
  hazardYellow: "#facc15",
  hazardBlack: "#111111",
  clean: "#ffffff",
  dirty: "#fb923c",
  rejected: "#78716c",
} as const;

export const LINE_WIDTH = 10;
export const STATION_R = 13;
export const CORNER_R = 26;

export const FONTS = {
  sign: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
  board: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

export const STAGE_STATUS_LABEL: Record<string, string> = {
  idle: "NO SERVICE",
  running: "APPROACHING",
  passed: "ON TIME",
  failed: "DELAYED",
  retrying: "REROUTING",
};
