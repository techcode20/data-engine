import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePipeline } from "../store";
import { Section } from "./Section";

const LEVEL_COLOR: Record<string, string> = {
  INFO: "text-[#67e8f9]",
  WARN: "text-[#fcd34d]",
  ERROR: "text-[#fda4af]",
  FIX: "text-[#c4b5fd]",
  OK: "text-[#6ee7b7]",
};

const FILTERS = ["ALL", "INFO", "WARN", "ERROR", "FIX", "OK"] as const;

export function AgentTerminal() {
  const { logs, logFilter, setLogFilter, logPaused, setLogPaused, togglePause, paused, phase } = usePipeline();
  const boxRef = useRef<HTMLDivElement>(null);

  const visible = logs.filter((l) => logFilter === "ALL" || l.level === logFilter);

  useEffect(() => {
    if (!logPaused && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [logs, logPaused]);

  return (
    <Section
      kicker="Terminal · agent log"
      title="What the agent is thinking"
      blurb="Every stage narrates itself with timestamps. Pause the stream, filter by level, or freeze autoscroll while you read."
      action={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogPaused(!logPaused)}
            aria-pressed={logPaused}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#9aa3b5] transition hover:text-white"
          >
            {logPaused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
            {logPaused ? "Resume scroll" : "Freeze"}
          </button>
          {phase === "running" && (
            <button
              onClick={togglePause}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/10 px-3 py-1.5 text-xs font-semibold text-[#fcd34d]"
            >
              {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
              {paused ? "Resume sim" : "Pause sim"}
            </button>
          )}
        </div>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Log level filter">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setLogFilter(f)}
            aria-pressed={logFilter === f}
            className={`font-code rounded-lg px-2.5 py-1 text-[11px] transition ${
              logFilter === f ? "bg-[#8b5cf6]/30 text-white" : "bg-white/5 text-[#5b6478] hover:text-white"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div
        ref={boxRef}
        tabIndex={0}
        aria-label="Agent log output"
        aria-live="off"
        className="slim-scroll h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-3 font-code text-xs leading-relaxed"
      >
        {visible.length === 0 && <p className="text-[#5b6478]">// awaiting first log line — press Run Pipeline.</p>}
        {visible.map((l) => (
          <p key={l.id} className="whitespace-pre-wrap break-words">
            <span className="text-[#3d4458]">[{l.t}]</span>{" "}
            <span className={`font-bold ${LEVEL_COLOR[l.level] ?? "text-white"}`}>{l.level.padEnd(5)}</span>{" "}
            <span className="text-[#c9d1e0]">{l.text}</span>
          </p>
        ))}
      </div>
    </Section>
  );
}
