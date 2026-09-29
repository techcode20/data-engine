import { motion } from "framer-motion";
import { Database, FileUp, Play, RotateCcw, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { usePipeline } from "../store";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function HeroUpload() {
  const { file, fileError, loadSample, loadFile, run, reset, phase } = usePipeline();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <header className="relative overflow-hidden pt-10 sm:pt-16">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #8b5cf6, transparent)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 80, damping: 16 }}
          className="text-center"
        >
          <p className="font-code inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[11px] uppercase tracking-[0.25em] text-[#22d3ee]">
            <Sparkles size={13} aria-hidden /> Autonomous data pipelines
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-tight sm:text-6xl">
            Raw CSV in.
            <br />
            <span className="bg-gradient-to-r from-[#8b5cf6] via-[#22d3ee] to-[#8b5cf6] bg-clip-text text-transparent">
              Production pipeline out.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-[#9aa3b5] sm:text-base">
            PipelineForge infers your schema, generates cleaning code, executes it in a sandbox,
            validates with pandera — and self-corrects on failure. Watch all 7 stages run live below.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 80, damping: 16, delay: 0.12 }}
          className="mx-auto mt-8 max-w-2xl"
        >
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload a CSV or JSON file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void loadFile(f);
            }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
              dragging ? "border-[#22d3ee] bg-[#22d3ee]/10" : "border-white/15 bg-white/[0.02] hover:border-[#8b5cf6]/60"
            }`}
          >
            <FileUp className="mx-auto text-[#8b5cf6]" size={28} aria-hidden />
            <p className="mt-2 text-sm font-semibold">Drag &amp; drop a .csv / .json file</p>
            <p className="mt-1 text-xs text-[#9aa3b5]">or click to browse — parsed locally, nothing leaves your machine</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = "";
              }}
            />
          </div>

          {fileError && (
            <p role="alert" className="mt-3 rounded-xl border border-[#f43f5e]/40 bg-[#f43f5e]/10 px-4 py-2.5 text-sm text-[#fda4af]">
              {fileError}
            </p>
          )}

          {file ? (
            <div className="glass mt-4 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <Database size={15} className="text-[#22d3ee]" aria-hidden /> {file.name}
                </span>
                <span className="text-[#9aa3b5]">{formatBytes(file.size)}</span>
                <span className="text-[#9aa3b5]">
                  {file.rows} rows × {file.cols} cols
                </span>
                <span className="font-code rounded-full bg-[#8b5cf6]/15 px-2.5 py-0.5 text-[11px] text-[#c4b5fd]">
                  {file.kind.toUpperCase()}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={run}
                  disabled={phase === "running"}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#6d28d9] px-5 py-2.5 text-sm font-bold shadow-lg shadow-[#8b5cf6]/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={15} aria-hidden /> {phase === "running" ? "Pipeline running…" : "Run Pipeline"}
                </button>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-[#9aa3b5] transition hover:border-white/30 hover:text-white"
                >
                  <RotateCcw size={15} aria-hidden /> Reset
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 text-center">
              <button
                onClick={loadSample}
                className="inline-flex items-center gap-2 rounded-xl border border-[#8b5cf6]/50 bg-[#8b5cf6]/10 px-5 py-2.5 text-sm font-semibold text-[#c4b5fd] transition hover:bg-[#8b5cf6]/20"
              >
                <Database size={15} aria-hidden /> Load messy sample dataset
              </button>
              <p className="mt-2 text-xs text-[#5b6478]">northwind_customers_messy.csv · 10 rows × 8 cols · 9 planted anomalies</p>
            </div>
          )}
        </motion.div>
      </div>
    </header>
  );
}
