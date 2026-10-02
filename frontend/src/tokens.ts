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
  // Contrast-safe variants for SMALL text / chips (AA ≥ 4.5:1, verified).
  inkSoft: "#57534e",
  terminalDim: "#b5aea1",
  passDeep: "#15803d",
  failDeep: "#b91c1c",
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
  timeout: "TIMED OUT",
  cancelled: "CANCELLED",
};
