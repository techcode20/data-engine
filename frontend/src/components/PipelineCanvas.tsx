import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { STAGES } from "../simulation/engine";
import { usePipeline } from "../store";
import { STATUS_COLOR } from "../tokens";
import type { StageId } from "../simulation/types";
import { Section } from "./Section";

function Connector({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div className="relative hidden h-0.5 flex-1 overflow-hidden rounded bg-white/10 md:block" aria-hidden>
      <motion.div
        className="absolute inset-y-0 left-0"
        style={{
          background: done
            ? "linear-gradient(90deg,#34d399,#22d3ee)"
            : "linear-gradient(90deg,#8b5cf6,#22d3ee)",
        }}
        initial={false}
        animate={{ width: done ? "100%" : active ? ["0%", "100%"] : "0%" }}
        transition={active && !done ? { duration: 1.4, repeat: Infinity, ease: "linear" } : { duration: 0.4 }}
      />
    </div>
  );
}

function NodeCard({ id, index, onOpen }: { id: StageId; index: number; onOpen: () => void }) {
  const { stages, attempt } = usePipeline();
  const meta = STAGES.find((s) => s.id === id)!;
  const state = stages[id];
  const color = STATUS_COLOR[state.status];
  const isActive = state.status === "running" || state.status === "retrying";

  return (
    <motion.button
      layout
      onClick={onOpen}
      aria-label={`${meta.label} stage: ${state.status}. Open details.`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      whileHover={{ y: -3 }}
      className={`relative w-full min-w-[132px] flex-1 rounded-2xl p-3.5 text-left transition md:w-auto ${
        isActive ? "glass-active" : "glass"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-code text-[10px] text-[#5b6478]">0{index + 1}</span>
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          {(state.status === "running" || state.status === "retrying") && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
          )}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </span>
      </span>
      <span className="mt-2 block text-[13px] font-bold leading-tight">{meta.label}</span>
      <span className="mt-1 block text-[11px] capitalize" style={{ color }}>
        {state.status === "running" && id === "self-correct" && attempt > 1 ? "retrying" : state.status}
      </span>
      <span className="mt-1 block font-code text-[10px] text-[#5b6478]">
        {state.status === "running" ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" aria-hidden /> live
          </span>
        ) : state.durationMs != null ? (
          `${(state.durationMs / 1000).toFixed(1)}s`
        ) : state.status === "passed" ? (
          <span className="inline-flex items-center gap-1 text-[#34d399]">
            <Check size={10} aria-hidden /> done
          </span>
        ) : (
          "—"
        )}
      </span>
    </motion.button>
  );
}

export function PipelineCanvas() {
  const { stages, attempt, maxRetries, phase, drawer, setDrawer, file } = usePipeline();

  return (
    <Section
      id="pipeline"
      kicker="Live pipeline canvas"
      title={`Attempt ${attempt} of ${maxRetries}`}
      blurb="Seven stages, one self-correcting loop. Nodes light up as data flows through — click any node for its internals."
      action={
        <span className="font-code inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-[#9aa3b5]">
          <RotateCcw size={12} aria-hidden /> retries used: {Math.min(attempt, 3) - 1} / {maxRetries}
        </span>
      }
    >
      {!file && phase === "idle" && (
        <p className="mb-4 rounded-xl border border-[#fbbf24]/30 bg-[#fbbf24]/5 px-4 py-2.5 text-sm text-[#fcd34d]">
          Load the sample dataset (or your own file) above, then press Run Pipeline to light up the canvas.
        </p>
      )}
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-1.5" role="list" aria-label="Pipeline stages">
        {STAGES.map((s, i) => (
          <div key={s.id} role="listitem" className="flex flex-1 items-center gap-1.5">
            <NodeCard id={s.id} index={i} onOpen={() => setDrawer(s.id)} />
            {i < STAGES.length - 1 && (
              <Connector
                active={stages[s.id].status === "passed" || stages[s.id].status === "running"}
                done={stages[s.id].status === "passed"}
              />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {drawer && <StageDrawer id={drawer} onClose={() => setDrawer(null)} />}
      </AnimatePresence>
    </Section>
  );
}

function StageDrawer({ id, onClose }: { id: StageId; onClose: () => void }) {
  const { stages } = usePipeline();
  const meta = STAGES.find((s) => s.id === id)!;
  const state = stages[id];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/60"
        aria-hidden
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`${meta.label} details`}
        initial={{ x: 360 }}
        animate={{ x: 0 }}
        exit={{ x: 360 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="glass fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col p-6"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-code text-[11px] uppercase tracking-[0.25em] text-[#22d3ee]">{meta.module}</p>
            <h3 className="mt-1 text-xl font-bold">{meta.label}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="rounded-lg border border-white/10 p-1.5 text-[#9aa3b5] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-3 text-sm text-[#9aa3b5]">{meta.blurb}</p>
        <p className="font-code mt-4 rounded-xl bg-black/40 p-3 text-xs leading-relaxed text-[#c4b5fd]">{meta.detail}</p>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <span className="text-[#5b6478]">Status</span>
          <span className="font-semibold capitalize" style={{ color: STATUS_COLOR[state.status] }}>
            {state.status}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-sm">
          <span className="text-[#5b6478]">Duration</span>
          <span className="font-code">{state.durationMs != null ? `${(state.durationMs / 1000).toFixed(1)}s` : "—"}</span>
        </div>
        <div className="mt-auto pt-6 text-xs text-[#5b6478]">
          Mirrors the real backend module — swap the simulation engine for the API and this panel stays identical.
        </div>
      </motion.aside>
    </>
  );
}
