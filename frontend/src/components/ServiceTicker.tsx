import { Megaphone } from "lucide-react";
import { useTransit } from "../store";

const DEFAULT_ALERTS = [
  "Welcome to PipelineForge Transit. Please stand clear of the closing doors — messy data aboard.",
  "Main Line engineering works: pandas 3 single-format inference in force. Use format='mixed' or expect NaT.",
];

/** Bottom service-alerts ticker in real transit-agency tone. */
export function ServiceTicker() {
  const alerts = useTransit((s) => s.alerts);
  const all = [...DEFAULT_ALERTS, ...alerts];
  const loop = [...all, ...all];
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-[#141210] bg-[#facc15]" role="marquee" aria-label="Service alerts">
      <div className="flex items-center gap-2 overflow-hidden px-3 py-1.5">
        <Megaphone size={14} className="shrink-0" aria-hidden />
        <div className="overflow-hidden font-board text-[11px] font-semibold sm:text-xs">
          <span className="ticker-track">
            {loop.map((a, i) => (
              <span key={i} className="mx-6">
                ● {a}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Screen-reader live region mirroring the latest alert. */
export function SrLive() {
  const alerts = useTransit((s) => s.alerts);
  const board = useTransit((s) => s.board);
  const last = alerts[alerts.length - 1];
  return (
    <p className="sr-only" aria-live="polite">
      {last ?? `Status: ${board.status}. Next: ${board.next}.`}
    </p>
  );
}
