/** Map-as-data: every line, station and segment lives here so tracks can be
 *  rerouted programmatically. Desktop uses `pts`, mobile (<=640px) uses `mpts`. */

export type LineId = "main" | "validation" | "memory" | "repair" | "siding";

export type StationId =
  | "intake"
  | "schema"
  | "code"
  | "sandbox"
  | "validation"
  | "repair"
  | "archive";

export type Pt = [number, number];

export interface StationCfg {
  id: StationId;
  name: string;
  code: string;
  platform: string;
  pos: Pt;
  mpos: Pt;
  kind: "terminal" | "regular" | "interchange";
  lines: LineId[];
  picto: string;
  microcopy: string;
}

export interface SegmentCfg {
  id: string;
  line: LineId;
  pts: Pt[];
  mpts: Pt[];
  style: "solid" | "dashed" | "faint";
  /** The track laid after the model patch — hidden until reroute. */
  reroute?: boolean;
  label?: string;
  labelDx?: number;
  labelDy?: number;
  /** Mobile overrides — the vertical spine crowds differently. */
  mLabelDx?: number;
  mLabelDy?: number;
}

export const DESKTOP_VB = { w: 1200, h: 680 };
export const MOBILE_VB = { w: 400, h: 980 };

export const LINE_COLOR: Record<LineId, string> = {
  main: "#e3342f",
  validation: "#2563eb",
  memory: "#16a34a",
  repair: "#f59e0b",
  siding: "#78716c",
};

export const STATIONS: StationCfg[] = [
  { id: "intake", name: "Intake Central", code: "INT", platform: "Platform 1", pos: [90, 540], mpos: [170, 110], kind: "terminal", lines: ["main"], picto: "◉", microcopy: "Mind the gap — files become trains here." },
  { id: "schema", name: "Schema Square", code: "SCH", platform: "Platform 2", pos: [310, 540], mpos: [170, 260], kind: "regular", lines: ["main"], picto: "▦", microcopy: "Type labels stamped per carriage window." },
  { id: "code", name: "Code Junction", code: "CDJ", platform: "Platforms 3–4", pos: [530, 540], mpos: [170, 410], kind: "interchange", lines: ["main", "repair"], picto: "⬡", microcopy: "Change here for the Repair Line." },
  { id: "sandbox", name: "Sandbox Terminal", code: "SBX", platform: "Platform 5 · glass roof", pos: [750, 540], mpos: [170, 560], kind: "regular", lines: ["main"], picto: "⬢", microcopy: "Live terminal glows inside the depot." },
  { id: "validation", name: "Validation Gate", code: "VAL", platform: "Turnstiles A–E", pos: [970, 540], mpos: [170, 710], kind: "interchange", lines: ["main", "validation"], picto: "✓", microcopy: "Have your dtypes ready for inspection." },
  { id: "repair", name: "Repair Depot", code: "REP", platform: "Works siding", pos: [760, 450], mpos: [300, 480], kind: "regular", lines: ["repair"], picto: "⚒", microcopy: "Model patches fitted while you wait." },
  { id: "archive", name: "Archive Terminus", code: "ARC", platform: "Brass gates", pos: [970, 160], mpos: [170, 900], kind: "terminal", lines: ["memory"], picto: "❏", microcopy: "All fixes filed. Thank you for riding." },
];

export const SEGMENTS: SegmentCfg[] = [
  // Main Line name rides the empty stretch between Intake and Schema —
  // the main-b midpoint sits exactly on Sandbox Terminal's glyph.
  { id: "main-a", line: "main", pts: [[90, 540], [530, 540]], mpts: [[170, 110], [170, 410]], style: "solid", label: "Main Line", labelDx: -110, mLabelDx: 34, mLabelDy: 0 },
  { id: "main-b", line: "main", pts: [[530, 540], [970, 540]], mpts: [[170, 410], [170, 710]], style: "solid" },
  {
    id: "validation-branch", line: "validation", pts: [[970, 650], [970, 540]], mpts: [[90, 710], [170, 710]],
    style: "solid", label: "Validation Line", labelDx: 40, labelDy: 40,
    // Mobile: captions the panel zone from clear space below it.
    mLabelDx: 10, mLabelDy: 185,
  },
  {
    id: "repair-out", line: "repair", pts: [[530, 540], [620, 450], [700, 450]], mpts: [[170, 410], [240, 480], [300, 480]],
    style: "solid", label: "Repair Line", labelDy: -28, mLabelDx: -136, mLabelDy: -18,
  },
  {
    id: "repair-reroute", line: "repair", pts: [[760, 450], [850, 540], [920, 540]], mpts: [[300, 480], [230, 550], [170, 550], [170, 560]],
    style: "faint", reroute: true, label: "new track", labelDx: -15, labelDy: 42,
    mLabelDx: 45, mLabelDy: 18,
  },
  {
    id: "rejected-siding", line: "siding", pts: [[970, 540], [1095, 540]], mpts: [[170, 710], [300, 710]],
    style: "dashed", label: "REJECTED", labelDx: 30, labelDy: 26, mLabelDx: 30, mLabelDy: 26,
  },
  {
    id: "memory-line", line: "memory", pts: [[970, 540], [970, 160]], mpts: [[170, 710], [170, 900]],
    style: "solid", label: "Memory Line", labelDx: 32, labelDy: -120,
    // Mobile: right margin clear of the panel, REJECTED caption and archive name.
    mLabelDx: 170, mLabelDy: 90,
  },
];

/** Train routes as station sequences per attempt (desktop geometry shared). */
export const ROUTES: Record<string, StationId[]> = {
  attempt1: ["intake", "schema", "code", "sandbox", "validation"],
  attempt2: ["intake", "schema", "code", "sandbox", "validation"],
  attempt3: ["intake", "schema", "code", "sandbox", "validation", "archive"],
};

/** Waypoints for a station sequence on the chosen layout. */
export function routePoints(route: StationId[], mobile: boolean): Pt[] {
  const byId = new Map(STATIONS.map((s) => [s.id, s]));
  return route.map((id) => (mobile ? byId.get(id)!.mpos : byId.get(id)!.pos));
}

/** Points from validation gate to archive terminus (attempt-3 home stretch). */
export function archivePoints(mobile: boolean): Pt[] {
  const seg = SEGMENTS.find((s) => s.id === "memory-line")!;
  return mobile ? seg.mpts : seg.pts;
}

/** Points of the repair loop (code → depot → rejoin) for the crew vehicle. */
export function repairLoopPoints(mobile: boolean): Pt[] {
  const out = SEGMENTS.find((s) => s.id === "repair-out")!;
  const back = SEGMENTS.find((s) => s.id === "repair-reroute")!;
  const a = mobile ? out.mpts : out.pts;
  const b = mobile ? back.mpts : back.pts;
  return [...a, ...b.slice(1)];
}
