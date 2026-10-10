import { motion } from "framer-motion";
import { Database, FileUp, Ticket } from "lucide-react";
import { useRef, useState } from "react";
import { useTransit } from "../store";
import { DepartControls } from "./DepartControls";
import { RetrySigns } from "./RetrySigns";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** INTAKE CENTRAL ticket gate: hero + upload + punched ticket + controls. */
export function GateHero() {
  const file = useTransit((s) => s.file);
  const fileError = useTransit((s) => s.fileError);
  const loadSample = useTransit((s) => s.loadSample);
  const loadFile = useTransit((s) => s.loadFile);
  const liveMode = useTransit((s) => s.liveMode);
  const rules = useTransit((s) => s.rules);
  const setRules = useTransit((s) => s.setRules);
  const apiToken = useTransit((s) => s.apiToken);
  const setApiToken = useTransit((s) => s.setApiToken);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <header className="street-grid relative overflow-hidden pb-2 pt-10 sm:pt-14">
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 90, damping: 17 }} className="text-center">
          <p className="font-board inline-flex items-center gap-2 rounded-full border-[3px] border-[#141210] bg-[#fffdf6] px-4 py-1.5 text-[11px] font-bold tracking-[0.25em] shadow-[3px_3px_0_#141210]">
            <Ticket size={13} aria-hidden /> PIPELINEFORGE TRANSIT AUTHORITY
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-[1.05] sm:text-6xl">
            All aboard the
            <br />
            <span className="text-[#e3342f]">data express.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-[#3f3a30] sm:text-base">
            Punch a ticket with a messy CSV or JSON. Your rows ride as carriages through seven stations —
            generated code, sandbox execution, pandera turnstiles, repair reroutes — and arrive validated,
            or your retries back.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 90, damping: 17, delay: 0.1 }}
          className="mx-auto mt-8 max-w-2xl"
        >
          <div
            role="button"
            tabIndex={0}
            aria-label="Ticket gate: upload a CSV or JSON file"
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
            className={`cursor-pointer rounded-2xl border-[3px] border-dashed p-6 text-center transition sm:p-8 ${
              dragging ? "border-[#2563eb] bg-[#2563eb]/5" : "border-[#141210] bg-[#fffdf6] hover:bg-white"
            }`}
          >
            <FileUp className="mx-auto" size={28} aria-hidden />
            <p className="mt-2 text-sm font-bold">Drop your file at the gate — .csv / .json</p>
            <p className="font-board mt-1 text-[11px] text-[#6b6455]">
              {liveMode
                ? "or click to present ticket · rides to the live backend on this machine"
                : "or click to present ticket · parsed on-device, never leaves the station"}
            </p>
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
            <p role="alert" className="mt-3 rounded-xl border-[3px] border-[#e3342f] bg-[#e3342f]/5 px-4 py-2.5 text-sm font-semibold">
              {fileError}
            </p>
          )}

          {file ? (
            <div className="mt-4 rounded-2xl border-[3px] border-[#141210] bg-[#fffdf6] p-4 shadow-[6px_6px_0_#141210]">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-board text-[13px]">
                <span className="font-bold">🎫 {file.name}</span>
                <span className="text-[#6b6455]">{formatBytes(file.size)}</span>
                <span>
                  <b>{file.rows}</b> rows × <b>{file.cols}</b> cols
                </span>
                <span className="rounded bg-[#141210] px-2 py-0.5 text-[10px] font-bold tracking-widest text-[#f6f3ea]">
                  {file.kind.toUpperCase()}
                </span>
              </div>
              <p className="font-board mt-1.5 text-[11px] text-[#6b6455]">
                printed on carriage side · orange cars ride dirty, white cars ride clean
              </p>
            </div>
          ) : (
            <div className="mt-4 text-center">
              <button
                onClick={loadSample}
                className="inline-flex items-center gap-2 rounded-xl border-[3px] border-[#141210] bg-[#f59e0b] px-5 py-2.5 text-sm font-bold shadow-[4px_4px_0_#141210] transition hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                <Database size={15} aria-hidden /> Load messy sample dataset
              </button>
              <p className="font-board mt-2 text-[11px] text-[#6b6455]">
                ridership_customers_messy.csv · 8 rows × 7 cols · dupes, N/A, $1,200, mixed dates
              </p>
            </div>
          )}

          <DepartControls />

          {liveMode && (
            <div className="mt-3">
              <label htmlFor="live-rules" className="font-board text-[10px] font-bold tracking-widest text-[#6b6455]">
                BUSINESS RULES — THE LIVE BACKEND CLEANS BY THESE
              </label>
              <textarea
                id="live-rules"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={2}
                placeholder="e.g. id is required and unique. amount must be numeric and non-negative."
                className="mt-1 w-full rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] p-2.5 text-sm shadow-[3px_3px_0_#141210] focus:outline-none"
              />
              <label htmlFor="live-token" className="font-board mt-3 block text-[10px] font-bold tracking-widest text-[#6b6455]">
                API TOKEN — ONLY IF THE BACKEND ASKS FOR ONE (MEMORY-ONLY, NEVER STORED)
              </label>
              <input
                id="live-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="paste PF_API_TOKEN · leave empty on localhost"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] p-2.5 text-sm shadow-[3px_3px_0_#141210] focus:outline-none"
              />
            </div>
          )}

          <div className="mt-3 flex justify-center">
            <RetrySigns />
          </div>
        </motion.div>
      </div>
    </header>
  );
}
