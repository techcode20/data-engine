import { Gauge, Pause, Play, RotateCcw } from "lucide-react";
import { AgentTerminal } from "./components/AgentTerminal";
import { CodeWorkspace } from "./components/CodeWorkspace";
import { DataInspector } from "./components/DataInspector";
import { FixMemory } from "./components/FixMemory";
import { HeroUpload } from "./components/HeroUpload";
import { PipelineCanvas } from "./components/PipelineCanvas";
import { ResultsDashboard } from "./components/ResultsDashboard";
import { ValidationReport } from "./components/ValidationReport";
import { usePipeline } from "./store";

function TransportBar() {
  const { phase, paused, togglePause, reset, speed, setSpeed, attempt } = usePipeline();
  if (phase === "idle") return null;
  return (
    <div className="sticky top-3 z-30 mx-auto mt-6 flex max-w-6xl flex-wrap items-center gap-2 px-4 sm:px-6" role="toolbar" aria-label="Simulation transport">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
        <button
          onClick={togglePause}
          disabled={phase !== "running"}
          aria-label={paused ? "Resume simulation" : "Pause simulation"}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-bold transition hover:bg-white/15 disabled:opacity-40"
        >
          {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={reset}
          aria-label="Reset simulation"
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-bold transition hover:bg-white/15"
        >
          <RotateCcw size={13} aria-hidden /> Reset
        </button>
        <div className="flex rounded-xl bg-black/30 p-0.5 text-xs font-bold" role="group" aria-label="Playback speed">
          {([1, 2] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              className={`rounded-lg px-3 py-1.5 transition ${speed === s ? "bg-[#8b5cf6]/40 text-white" : "text-[#5b6478] hover:text-white"}`}
            >
              {s}x
            </button>
          ))}
        </div>
        <span className="font-code px-2 text-[11px] text-[#9aa3b5]">
          attempt {Math.min(attempt, 3)}/3 · cap 5
        </span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-[#07080d] text-[#e6e9f2]">
      <a href="#pipeline" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-black">
        Skip to pipeline
      </a>
      <HeroUpload />
      <TransportBar />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
        <PipelineCanvas />
        <DataInspector />
        <CodeWorkspace />
        <ValidationReport />
        <AgentTerminal />
        <FixMemory />
        <ResultsDashboard />
      </main>
      <footer className="border-t border-white/5 px-4 py-8 text-center text-xs text-[#5b6478] sm:px-6">
        <p className="font-code inline-flex items-center gap-2">
          <Gauge size={12} aria-hidden />
          PipelineForge · simulated frontend — plug <span className="text-[#22d3ee]">/simulation</span> into the real engine API when ready
        </p>
      </footer>
    </div>
  );
}
