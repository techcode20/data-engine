import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTransit } from "../store";

const LEVEL_COLOR: Record<string, string> = {
  INFO: "text-[#93c5fd]",
  WARN: "text-[#fcd34d]",
  ERROR: "text-[#fca5a5]",
  FIX: "text-[#fdba74]",
  OK: "text-[#86efac]",
};

const FILTERS = ["ALL", "INFO", "WARN", "ERROR", "FIX", "OK"] as const;

/** Sandbox Terminal: the glowing depot console. Streams agent + execution lines. */
export function DepotTerminal() {
  const logs = useTransit((s) => s.logs);
  const logFilter = useTransit((s) => s.logFilter);
  const setLogFilter = useTransit((s) => s.setLogFilter);
  const logPaused = useTransit((s) => s.logPaused);
  const setLogPaused = useTransit((s) => s.setLogPaused);
  const boxRef = useRef<HTMLDivElement>(null);

  const visible = logs.filter((l) => logFilter === "ALL" || l.level === logFilter);

  useEffect(() => {
    if (!logPaused && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [logs, logPaused]);

  return (
    <div className="overflow-hidden rounded-xl border-[3px] border-[#141210] bg-[#141210] text-[#f6f3ea] shadow-[5px_5px_0_rgba(20,18,16,0.25)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 px-3 py-2">
        <p className="font-board text-[11px] font-bold tracking-[0.2em] text-[#fdba74]">
          ● SANDBOX TERMINAL · LIVE
        </p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Log level filter">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                aria-pressed={logFilter === f}
                className={`font-board rounded px-1.5 py-0.5 text-[10px] ${
                  logFilter === f ? "bg-[#f59e0b] font-bold text-black" : "text-[#a8a091] hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLogPaused(!logPaused)}
            aria-pressed={logPaused}
            aria-label={logPaused ? "Resume log scroll" : "Freeze log scroll"}
            className="rounded border border-white/25 p-1 hover:bg-white/10"
          >
            {logPaused ? <Play size={12} /> : <Pause size={12} />}
          </button>
        </div>
      </div>
      <div
        ref={boxRef}
        tabIndex={0}
        aria-label="Depot terminal output"
        className="slim-scroll h-60 overflow-y-auto p-3 font-board text-xs leading-relaxed"
      >
        {visible.length === 0 && <p className="text-[#78716c]">$ awaiting departure — press DEPART.</p>}
        {visible.map((l) => (
          <p key={l.id} className="whitespace-pre-wrap break-words">
            <span className="text-[#78716c]">[{l.t}]</span>{" "}
            <span className={`font-bold ${LEVEL_COLOR[l.level] ?? "text-white"}`}>{l.level.padEnd(5)}</span>{" "}
            <span>{l.text}</span>
          </p>
        ))}
        <span className="font-bold text-[#f59e0b]">$ ▌</span>
      </div>
    </div>
  );
}
