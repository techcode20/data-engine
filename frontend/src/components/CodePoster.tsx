import { Suspense, lazy, useState } from "react";
import { CODE_VERSIONS } from "../simulation/script";
import { useTransit } from "../store";
import { PlainCode, usePythonHighlight } from "../lib/shiki";

const DiffPoster = lazy(() => import("./CodeDiff").then((m) => ({ default: m.CodeDiff })));

function Poster({ code, title }: { code: string; title: string }) {
  const html = usePythonHighlight(code);
  return (
    <div className="overflow-hidden rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] shadow-[5px_5px_0_#141210]">
      <p className="border-b-[3px] border-[#141210] bg-[#f59e0b] px-3 py-1.5 font-board text-[11px] font-bold tracking-widest">
        {title} · PRINTED TIMETABLE
      </p>
      <div className="shiki-wrap max-h-[380px] overflow-auto">
        {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <PlainCode code={code} />}
      </div>
    </div>
  );
}

/** Code Junction timetable poster: versioned Python, red/green work-order diff. */
export function CodePoster() {
  const latestVersion = useTransit((s) => s.latestVersion);
  const viewingVersion = useTransit((s) => s.viewingVersion);
  const setViewingVersion = useTransit((s) => s.setViewingVersion);
  const phase = useTransit((s) => s.phase);
  const [showDiff, setShowDiff] = useState(true);
  const code = CODE_VERSIONS[viewingVersion - 1] ?? CODE_VERSIONS[0];
  const prev = CODE_VERSIONS[viewingVersion - 2];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Timetable versions">
        {CODE_VERSIONS.map((_, i) => {
          const v = i + 1;
          const available = v <= latestVersion;
          return (
            <button
              key={v}
              role="tab"
              aria-selected={viewingVersion === v}
              disabled={!available}
              onClick={() => setViewingVersion(v)}
              className={`rounded-lg border-2 px-3.5 py-1.5 font-board text-xs font-bold transition ${
                viewingVersion === v
                  ? "border-[#141210] bg-[#141210] text-[#f6f3ea]"
                  : available
                    ? "border-[#141210] bg-[#fffdf6] hover:bg-[#f6f3ea]"
                    : "cursor-not-allowed border-[#a8a091] text-[#a8a091]"
              }`}
            >
              v{v}
              {v === latestVersion && phase !== "idle" && " ●"}
            </button>
          );
        })}
        <button
          onClick={() => setShowDiff((d) => !d)}
          disabled={viewingVersion < 2}
          aria-pressed={showDiff}
          className="rounded-lg border-2 border-[#141210] px-3 py-1.5 font-board text-xs font-bold disabled:opacity-30"
        >
          {showDiff ? "SHOW CODE" : "SHOW WORK-ORDER"}
        </button>
      </div>
      {showDiff && prev ? (
        <Suspense fallback={<p className="font-board p-4 text-xs">pinning work-order…</p>}>
          <DiffPoster oldCode={prev} newCode={code} from={viewingVersion - 1} to={viewingVersion} />
        </Suspense>
      ) : (
        <Poster code={code} title={`TIMETABLE v${viewingVersion}`} />
      )}
    </div>
  );
}
