/** Single source of truth for PipelineForge design tokens. */

export const COLORS = {
  void: "#07080d",
  panel: "#0c0e16",
  ink: "#e6e9f2",
  muted: "#9aa3b5",
  faint: "#5b6478",
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  mint: "#34d399",
  rose: "#f43f5e",
  amber: "#fbbf24",
  edge: "rgba(255,255,255,0.09)",
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONTS = {
  ui: '"Inter", system-ui, sans-serif',
  code: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const STATUS_COLOR: Record<string, string> = {
  idle: COLORS.faint,
  running: COLORS.cyan,
  passed: COLORS.mint,
  failed: COLORS.rose,
  retrying: COLORS.amber,
};
