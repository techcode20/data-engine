import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { CARRIAGES, COLUMNS } from "../simulation/dataset";
import { useTransit } from "../store";

/** Carriage magnifier: raw vs cleaned values for one batch. */
export function CarriageMagnifier() {
  const selectedCarriage = useTransit((s) => s.selectedCarriage);
  const selectCarriage = useTransit((s) => s.selectCarriage);
  const carriages = useTransit((s) => s.carriages);
  const liveRows = useTransit((s) => s.liveRows);
  const liveColumns = useTransit((s) => s.liveColumns);
  const scriptCar = selectedCarriage != null ? CARRIAGES[selectedCarriage] : null;
  // Live runs: each sampled row rides as its own single-row carriage.
  const liveRow = selectedCarriage != null ? liveRows[selectedCarriage] : null;
  const car = liveRow
    ? { label: `Live carriage ${selectedCarriage! + 1}`, rows: [liveRow] }
    : scriptCar;
  const columns = liveRows.length && liveColumns.length ? liveColumns : [...COLUMNS];
  const state = selectedCarriage != null ? carriages[selectedCarriage] : null;

  return (
    <AnimatePresence>
      {car && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => selectCarriage(null)} className="fixed inset-0 z-40 bg-black/40" aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${car.label} magnifier`}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="fixed left-1/2 top-1/2 z-40 max-h-[80vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border-[3px] border-[#141210] bg-[#fffdf6] p-5 shadow-[8px_8px_0_#141210]"
            onKeyDown={(e) => {
              if (e.key === "Escape") selectCarriage(null);
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{car.label}</h3>
                <p className="font-board text-[11px] uppercase tracking-widest text-[#6b6455]">
                  status: {state}
                </p>
              </div>
              <button onClick={() => selectCarriage(null)} aria-label="Close magnifier" className="rounded-lg border-2 border-[#141210] p-1.5 hover:bg-[#141210] hover:text-[#f6f3ea]">
                <X size={15} />
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {car.rows.map((r, i) => (
                <div key={i} className={`rounded-xl border-2 p-3 ${r.fate === "kept" ? "border-[#16a34a] bg-[#16a34a]/5" : "border-[#e3342f] bg-[#e3342f]/5"}`}>
                  <p className="font-board mb-2 text-[10px] tracking-widest">
                    <span className={`rounded px-1.5 py-0.5 font-bold ${r.fate === "kept" ? "bg-[#15803d] text-white" : "bg-[#b91c1c] text-white"}`}>
                      {r.fate === "kept" ? "RIDES ON" : "SHUNTED"}
                    </span>{" "}
                    <span className="text-[#6b6455]">{r.reason}</span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="font-board mb-1 text-[10px] font-bold tracking-widest text-[#6b6455]">RAW</p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-board text-[11px]">
                        {columns.map((c, j) => (
                          <div key={c} className="contents">
                            <dt className="text-[#6b6455]">{c}</dt>
                            <dd className="break-all">{r.values[j] === "" ? <em className="text-[#6b6455]">∅ empty</em> : r.values[j]}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <div>
                      <p className="font-board mb-1 text-[10px] font-bold tracking-widest text-[#6b6455]">CLEANED</p>
                      {r.fate === "kept" && r.cleaned ? (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-board text-[11px]">
                          {columns.map((c, j) => {
                            const changed = r.cleaned[j] !== r.values[j];
                            return (
                              <div key={c} className="contents">
                                <dt className="text-[#6b6455]">{c}</dt>
                                <dd className={`break-all ${changed ? "font-bold text-[#15803d]" : ""}`}>
                                  {r.cleaned[j]}
                                  {changed && <span className="ml-1 text-[9px] text-[#6b6455]">← {r.values[j] === "" ? "∅" : r.values[j]}</span>}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      ) : (
                        <p className="font-board text-[11px] italic text-[#6b6455]">no cleaned values — row shunted to REJECTED siding</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
