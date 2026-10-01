import { AnimatePresence, motion } from "framer-motion";
import { Download, Ticket } from "lucide-react";
import { DATASET_META, TARGET_SCHEMA } from "../simulation/dataset";
import { CODE_VERSIONS } from "../simulation/script";
import { useTransit } from "../store";

function download(name: string, content: string) {
  const blob = new Blob([content], { type: "text/x-python" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const PIPELINE_PY = `"""Production pipeline exported from PipelineForge Transit.
Source dataset: ridership_customers_messy.csv — validated v3.
"""
import pandas as pd


${CODE_VERSIONS[2]}


if __name__ == "__main__":
    df = pd.read_csv("ridership_customers_messy.csv", dtype=str)
    cleaned = clean(df)
    cleaned.to_csv("cleaned_output.csv", index=False)
    print(f"cleaned {len(cleaned)} rows -> cleaned_output.csv")
`;

const SCHEMA_PY = `"""Pandera schema exported from PipelineForge Transit."""
import pandera.pandas as pa
from pandera import Check, Column

TARGET_SCHEMA_JSON = '''${TARGET_SCHEMA}'''

schema = pa.DataFrameSchema({
    "customer_id": Column(int, nullable=False, unique=True),
    "name": Column(str, nullable=False),
    "signup_date": Column("datetime64[ns]", nullable=False),
    "age": Column(int, nullable=False, checks=Check.greater_than_or_equal_to(0)),
    "email": Column(str, nullable=False, checks=Check.str_contains("@")),
    "plan": Column(str, nullable=False, checks=Check.isin(["FREE", "BASIC", "PRO"])),
    "revenue": Column(float, nullable=False, checks=Check.greater_than_or_equal_to(0)),
})
`;

const TESTS_PY = `"""Regression tests exported from PipelineForge Transit."""
import pandas as pd

from pipeline import clean
from schema import schema


def test_pipeline_passes_schema():
    df = pd.read_csv("ridership_customers_messy.csv", dtype=str)
    schema.validate(clean(df))  # raises SchemaErrors on failure


def test_no_silent_mass_deletion():
    df = pd.read_csv("ridership_customers_messy.csv", dtype=str)
    cleaned = clean(df)
    assert len(cleaned) / len(df) >= 0.25, "dropped more than 75% of rows"


def test_expected_survivors():
    df = pd.read_csv("ridership_customers_messy.csv", dtype=str)
    cleaned = clean(df)
    assert set(cleaned["customer_id"].astype(int)) == {201, 202, 206}
`;

const TICKETS = [
  { name: "pipeline.py", content: PIPELINE_PY, color: "#e3342f" },
  { name: "schema.py", content: SCHEMA_PY, color: "#2563eb" },
  { name: "tests.py", content: TESTS_PY, color: "#16a34a" },
];

/** Ticket machine: three printed tickets slide out when the run completes. */
export function TicketMachine() {
  const ticketsOut = useTransit((s) => s.ticketsOut);
  const phase = useTransit((s) => s.phase);
  return (
    <div className="rounded-2xl border-[3px] border-[#141210] bg-[#141210] p-4 text-[#f6f3ea] shadow-[6px_6px_0_rgba(20,18,16,0.25)]">
      <p className="font-board flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-[#f59e0b]">
        <Ticket size={14} aria-hidden /> TICKET MACHINE
      </p>
      {!ticketsOut ? (
        <p className="mt-2 text-sm text-[#a8a091]">
          {phase === "idle" ? "Tickets print when a run completes all turnstiles." : "Printing… hold your ticket until validation clears."}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <AnimatePresence>
            {TICKETS.map((t, i) => (
              <motion.button
                key={t.name}
                initial={{ y: -70, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.22, type: "spring", stiffness: 160, damping: 17 }}
                onClick={() => download(t.name, t.content)}
                className="group rounded-xl border-2 border-dashed border-[#f6f3ea]/40 bg-[#fffdf6] p-3 text-left text-[#141210] transition hover:border-solid"
              >
                <span className="font-board inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white" style={{ background: t.color }}>
                  {t.name}
                </span>
                <span className="font-board mt-2 block text-[11px] text-[#6b6455]">
                  {t.content.split("\n").length} lines · click to download
                </span>
                <span className="mt-1.5 flex items-center gap-1 text-xs font-bold group-hover:underline">
                  <Download size={12} aria-hidden /> Collect ticket
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
      <p className="mt-3 font-board text-[11px] text-[#a8a091]">
        {DATASET_META.rowsIn} boarded · {DATASET_META.rowsOut} arrived · {DATASET_META.rowsIn - DATASET_META.rowsOut} shunted to REJECTED
      </p>
    </div>
  );
}
