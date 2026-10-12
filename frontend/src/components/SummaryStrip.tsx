import { useEffect, useState } from "react";
import { DATASET_META } from "../simulation/dataset";
import { useTransit } from "../store";

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Run summary strip: rows in → arrived → rejected, attempts, duration.
 *  Demo numbers come from the scripted dataset; live numbers from the
 *  sampled consist (tagged SAMPLED) since full totals ride the backend. */
export function SummaryStrip() {
  const phase = useTransit((s) => s.phase);
  const maxAttempt = useTransit((s) => s.maxAttempt);
  const score = useTransit((s) => s.score);
  const liveMode = useTransit((s) => s.liveMode);
  const carriages = useTransit((s) => s.carriages);
  const liveRows = useTransit((s) => s.liveRows);
  const runStartedAt = useTransit((s) => s.runStartedAt);
  const runEndedAt = useTransit((s) => s.runEndedAt);
  const [, tick] = useState(0);

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => tick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const live = liveMode && liveRows.length > 0;
  const rowsIn = live ? liveRows.length : DATASET_META.rowsIn;
  const arrived = live
    ? carriages.filter((c) => c === "clean" || c === "partial").length
    : DATASET_META.rowsOut;
  const rejected = rowsIn - arrived;
  const end = runEndedAt ?? (phase === "running" ? Date.now() : null);
  const duration = runStartedAt && end ? formatDuration(end - runStartedAt) : "—";

  const cells: Array<[string, string]> = [
    ["ROWS IN", String(rowsIn)],
    ["ARRIVED", String(arrived)],
    ["REJECTED", String(rejected)],
    ["ATTEMPTS", String(Math.max(1, maxAttempt))],
    ["SCORE", `${score}`],
    ["DURATION", duration],
  ];
  return (
    <div
      className="flex flex-wrap items-stretch gap-x-5 gap-y-1 rounded-xl border-[3px] border-[#141210] bg-[#141210] px-4 py-2 text-[#f6f3ea] shadow-[4px_4px_0_rgba(20,18,16,0.25)]"
      aria-label="Run summary"
    >
      {cells.map(([k, v]) => (
        <span key={k} className="inline-flex items-baseline gap-2">
          <span className="font-board text-[10px] tracking-[0.2em] text-[#a8a091]">{k}</span>
          <span className="font-board text-base font-bold">{v}</span>
        </span>
      ))}
    </div>
  );
}
