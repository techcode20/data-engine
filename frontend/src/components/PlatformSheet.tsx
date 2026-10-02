import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { STAGE_META } from "../simulation/stageMeta";
import type { StationId } from "../transit/mapConfig";
import { useTransit } from "../store";
import { COLORS } from "../tokens";

/** Platform sheet: per-station status, duration, inputs/outputs, module note. */
export function PlatformSheet() {
  const selectedStation = useTransit((s) => s.selectedStation);
  const selectStation = useTransit((s) => s.selectStation);
  const stages = useTransit((s) => s.stages);
  const mobile = useTransit((s) => s.mobile);

  return (
    <AnimatePresence>
      {selectedStation && (
        <SheetShell onClose={() => selectStation(null)} mobile={mobile} label={`${STAGE_META[selectedStation].label} platform sheet`}>
          <SheetBody id={selectedStation} status={stages[selectedStation].status} durationMs={stages[selectedStation].durationMs} onClose={() => selectStation(null)} />
        </SheetShell>
      )}
    </AnimatePresence>
  );
}

function SheetShell({ children, onClose, mobile, label }: { children: React.ReactNode; onClose: () => void; mobile: boolean; label: string }) {
  const common = "z-40 border-[#141210] bg-[#fffdf6] shadow-[8px_8px_0_#141210]";
  if (mobile) {
    return (
      <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/40" aria-hidden />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          initial={{ y: 320 }}
          animate={{ y: 0 }}
          exit={{ y: 320 }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          className={`fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-2xl border-[3px] ${common}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          {children}
        </motion.div>
      </>
    );
  }
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/30" aria-hidden />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ x: 380 }}
        animate={{ x: 0 }}
        exit={{ x: 380 }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        className={`fixed right-4 top-4 z-40 max-h-[calc(100vh-2rem)] w-[380px] overflow-y-auto rounded-2xl border-[3px] ${common}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        {children}
      </motion.aside>
    </>
  );
}

const DOT: Record<string, string> = {
  idle: "#a8a091",
  running: "#2563eb",
  passed: "#16a34a",
  failed: "#e3342f",
  retrying: "#f59e0b",
  timeout: "#f59e0b",
  cancelled: "#78716c",
};

function SheetBody({ id, status, durationMs, onClose }: { id: StationId; status: string; durationMs: number | null; onClose: () => void }) {
  const meta = STAGE_META[id];
  const errorText = useTransit((s) => s.errorText);
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-board text-[10px] tracking-[0.25em] text-[#6b6455]">{meta.module.toUpperCase()}</p>
          <h3 className="mt-0.5 text-xl font-bold">{meta.label}</h3>
        </div>
        <button onClick={onClose} aria-label="Close platform sheet" className="rounded-lg border-2 border-[#141210] p-1.5 hover:bg-[#141210] hover:text-[#f6f3ea]">
          <X size={15} />
        </button>
      </div>
      <p className="mt-2 text-sm text-[#3f3a30]">{meta.blurb}</p>
      <p className="font-board mt-2 rounded-lg bg-[#f6f3ea] p-2.5 text-[11px] leading-relaxed">{meta.detail}</p>
      <div className="mt-3 flex items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold capitalize">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: DOT[status] }} aria-hidden /> {status}
        </span>
        <span className="font-board text-xs text-[#6b6455]">{durationMs != null ? `${(durationMs / 1000).toFixed(1)}s dwell` : "no dwell recorded"}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border-2 border-dashed border-[#141210]/30 p-2.5">
          <p className="font-board mb-1 text-[10px] tracking-widest text-[#6b6455]">ARRIVING</p>
          <ul className="font-board space-y-1">
            {meta.inputs.map((i) => (
              <li key={i}>→ {i}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border-2 border-[#141210] bg-[#141210] p-2.5 text-[#f6f3ea]">
          <p className="font-board mb-1 text-[10px] tracking-widest text-[#a8a091]">DEPARTING</p>
          <ul className="font-board space-y-1">
            {meta.outputs.map((o) => (
              <li key={o}>→ {o}</li>
            ))}
          </ul>
        </div>
      </div>
      {(id === "validation" || id === "repair") && errorText && (
        <div className="mt-3 rounded-lg border-2 border-[#e3342f] bg-[#e3342f]/5 p-2.5">
          <p className="font-board mb-1 text-[10px] tracking-widest text-[#b91c1c]">FEEDBACK TO MODEL</p>
          <p className="font-board text-[11px] leading-relaxed text-[#141210]">{errorText}</p>
        </div>
      )}
      <p className="mt-3 text-[11px] italic text-[#6b6455]" style={{ color: COLORS.muted }}>
        {id === "intake" ? "Mind the gap — files become trains here." : id === "archive" ? "All fixes filed. Thank you for riding." : "Stand clear of the closing doors."}
      </p>
    </div>
  );
}
