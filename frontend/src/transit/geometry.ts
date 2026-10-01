import type { Pt } from "./mapConfig";

/** Vignelli-style rounded polyline: straight segments joined by quadratic corners. */
export function roundedPath(pts: Pt[], r: number): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const v1 = Math.hypot(x - px, y - py);
    const v2 = Math.hypot(nx - x, ny - y);
    const rr = clamp(r, 0, Math.min(v1, v2) / 2);
    const ax = x - ((x - px) / v1) * rr;
    const ay = y - ((y - py) / v1) * rr;
    const bx = x + ((nx - x) / v2) * rr;
    const by = y + ((ny - y) / v2) * rr;
    d += ` L ${round(ax)} ${round(ay)} Q ${x} ${y} ${round(bx)} ${round(by)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Mid-point of a segment (for labels), by fractional distance. */
export function pointAlong(pts: Pt[], frac: number): Pt {
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let target = total * frac;
  for (let i = 1; i < pts.length; i++) {
    if (target <= lens[i - 1]) {
      const f = lens[i - 1] === 0 ? 0 : target / lens[i - 1];
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    target -= lens[i - 1];
  }
  return pts[pts.length - 1];
}
