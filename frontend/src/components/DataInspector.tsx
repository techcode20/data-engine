import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { CLEAN_ROWS, COLUMNS, DATASET_META, RAW_FLAGS, RAW_ROWS, type Row } from "../simulation/dataset";
import { usePipeline } from "../store";
import { Section } from "./Section";

const FLAG_STYLE: Record<string, string> = {
  null: "bg-[#f43f5e]/15 text-[#fda4af] ring-[#f43f5e]/40",
  type: "bg-[#fbbf24]/15 text-[#fcd34d] ring-[#fbbf24]/40",
  dup: "bg-[#8b5cf6]/15 text-[#c4b5fd] ring-[#8b5cf6]/40",
  outlier: "bg-[#22d3ee]/15 text-[#67e8f9] ring-[#22d3ee]/40",
  format: "bg-white/10 text-[#e6e9f2] ring-white/20",
};

function DataTable({ rows, flags, caption }: { rows: Row[]; flags?: typeof RAW_FLAGS; caption: string }) {
  return (
    <div className="slim-scroll overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-white/5">
            <th className="px-3 py-2 text-left font-code font-medium text-[#5b6478]">#</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-3 py-2 text-left font-code font-medium text-[#9aa3b5]">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-[#5b6478]">
                No rows yet — run the pipeline to materialize this table.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 transition-colors hover:bg-white/[0.03]">
              <td className="px-3 py-1.5 font-code text-[#5b6478]">{i + 1}</td>
              {COLUMNS.map((c) => {
                const flag = flags?.[i]?.[c.key];
                const val = r[c.key] ?? "";
                return (
                  <td key={c.key} className="px-3 py-1.5">
                    <span
                      title={flag?.note}
                      className={`inline-block max-w-[160px] truncate rounded px-1.5 py-0.5 font-code ring-1 ring-inset ${
                        flag ? FLAG_STYLE[flag.kind] : ""
                      }`}
                    >
                      {val === "" ? <em className="text-[#5b6478]">∅</em> : val}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataInspector() {
  const { phase, attempt } = usePipeline();
  const [mode, setMode] = useState<"raw" | "clean">("raw");
  const showClean = phase === "done" || (phase === "running" && attempt >= 2);
  const cleaned = phase === "done" ? CLEAN_ROWS : CLEAN_ROWS.slice(0, 3);

  return (
    <Section
      kicker="Data inspector"
      title="Raw mess vs cleaned output"
      blurb="Hover any highlighted cell for the diagnosis. The cleaned table fills in as validation passes."
      action={
        <div className="flex rounded-xl border border-white/10 bg-black/30 p-1 text-xs font-semibold" role="tablist" aria-label="Data view">
          {(["raw", "clean"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-4 py-1.5 capitalize transition ${
                mode === m ? "bg-[#8b5cf6]/30 text-white" : "text-[#9aa3b5] hover:text-white"
              }`}
            >
              {m === "raw" ? `Raw (${DATASET_META.rowsIn})` : `Clean (${DATASET_META.rowsOut})`}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
        {Object.entries({ null: "missing / N/A", type: "type violation", dup: "duplicate", outlier: "outlier", format: "format drift" }).map(
          ([k, label]) => (
            <span key={k} className={`rounded-full px-2.5 py-1 font-code ring-1 ring-inset ${FLAG_STYLE[k]}`}>
              {label}
            </span>
          ),
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, x: mode === "clean" ? 24 : -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: mode === "clean" ? -24 : 24 }}
          transition={{ duration: 0.25 }}
        >
          {mode === "raw" ? (
            <DataTable rows={RAW_ROWS} flags={RAW_FLAGS} caption="Raw messy input rows" />
          ) : showClean ? (
            <DataTable rows={cleaned} caption="Cleaned output rows" />
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-[#5b6478]">
              Cleaned output appears after attempt 2 — run the pipeline.
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COLUMNS.map((c) => (
          <div key={c.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="truncate font-code text-[11px] text-[#9aa3b5]" title={c.key}>
              {c.key}
            </p>
            <p className="font-code mt-0.5 inline-block rounded bg-[#22d3ee]/10 px-1.5 text-[10px] text-[#67e8f9]">
              {c.dtype}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10" role="img" aria-label={`${c.key} health ${c.health} of 100`}>
              <motion.div
                className="h-full rounded"
                style={{ background: c.health === 100 ? "#34d399" : c.health >= 80 ? "#22d3ee" : "#fbbf24" }}
                initial={{ width: 0 }}
                whileInView={{ width: `${c.health}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.1 }}
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
