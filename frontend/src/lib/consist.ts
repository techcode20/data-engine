import type { BatchRow, CarriageState } from "../simulation/types";

export interface DisplayCar {
  state: CarriageState;
  rows: BatchRow[];
  /** 1-based raw-row range, for labels ("rows 3–4"). */
  range: [number, number];
}

/** Group per-row live states into a scripted-size consist (≤4 cars).
 *
 *  The backend streams one state per sampled row (up to 8); drawing all
 *  eight stretches the train across two stations. Chunked into ≤4 cars the
 *  silhouette matches the scripted consist: all-clean → clean, all-dropped
 *  → rejected, mixed → partial. Empty rows → 1:1 passthrough (scripted).
 */
export function groupCars(states: CarriageState[], rows: BatchRow[]): DisplayCar[] {
  if (!rows.length) return states.map((state) => ({ state, rows: [], range: [0, 0] as [number, number] }));
  const per = Math.max(1, Math.ceil(rows.length / 4));
  const out: DisplayCar[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunkStates = states.slice(i, i + per);
    const chunkRows = rows.slice(i, i + per);
    const uniq = [...new Set(chunkStates)];
    out.push({
      state: uniq.length === 1 ? uniq[0] : "partial",
      rows: chunkRows,
      range: [i + 1, i + chunkRows.length],
    });
  }
  return out;
}
