/** Deterministic incident-graph helpers: seeded PRNG, text similarity for
 *  edge labels, and a fixed-iteration force layout that always converges to
 *  the same positions for the same input (no Date.now, no Math.random). */

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1));
}

/** Jaccard similarity of token sets, 0..1 — the honest, computable meaning
 *  of "similar fixes" for edge labels. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface GraphPos {
  id: string;
  x: number;
  y: number;
}

/** Deterministic force layout filling [0,w]x[0,h] with a margin.
 *  Seeded spiral start + fixed iteration count + fixed constants: same
 *  ids/links/seed always yields the same positions. */
export function layoutGraph(
  ids: string[],
  links: Array<readonly [string, string]>,
  w: number,
  h: number,
  seed = 7,
): GraphPos[] {
  const margin = 18;
  const n = ids.length;
  if (n === 0) return [];
  const rand = seededRandom(seed);
  const pts = new Map<string, { x: number; y: number }>();
  ids.forEach((id, i) => {
    const a = i * 2.399963; // golden angle: even spread, no randomness needed
    const r = 0.15 + 0.75 * Math.sqrt((i + rand() * 0.2) / Math.max(1, n));
    pts.set(id, { x: 0.5 + Math.cos(a) * r * 0.5, y: 0.5 + Math.sin(a) * r * 0.5 });
  });
  const idx = new Map(ids.map((id, i) => [id, i]));
  const edges = links.filter(([a, b]) => idx.has(a) && idx.has(b) && a !== b);
  const rest = 0.34;
  for (let iter = 0; iter < 160; iter++) {
    const disp = new Map<string, { x: number; y: number }>();
    for (const id of ids) disp.set(id, { x: 0, y: 0 });
    const arr = [...ids];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = pts.get(arr[i])!;
        const b = pts.get(arr[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) {
          dx = (rand() - 0.5) * 0.02;
          dy = (rand() - 0.5) * 0.02;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = Math.min(0.02, 0.00045 / d2);
        disp.get(arr[i])!.x += (dx / d) * f;
        disp.get(arr[i])!.y += (dy / d) * f;
        disp.get(arr[j])!.x -= (dx / d) * f;
        disp.get(arr[j])!.y -= (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const pa = pts.get(a)!;
      const pb = pts.get(b)!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const f = (d - rest) * 0.02;
      disp.get(a)!.x += (dx / d) * f;
      disp.get(a)!.y += (dy / d) * f;
      disp.get(b)!.x -= (dx / d) * f;
      disp.get(b)!.y -= (dy / d) * f;
    }
    for (const id of ids) {
      const p = pts.get(id)!;
      const d = disp.get(id)!;
      p.x += d.x + (0.5 - p.x) * 0.02;
      p.y += d.y + (0.5 - p.y) * 0.02;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  return ids.map((id) => {
    const p = pts.get(id)!;
    return {
      id,
      x: margin + ((p.x - minX) / spanX) * (w - margin * 2),
      y: margin + ((p.y - minY) / spanY) * (h - margin * 2),
    };
  });
}
