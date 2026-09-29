import { Check, Copy, Download, FileCode2, GitCompare } from "lucide-react";
import { useMemo, useState } from "react";
import { diffLines } from "../lib/diff";
import { highlightLine, highlightPython } from "../lib/highlight";
import { CODE_VERSIONS } from "../simulation/script";
import { usePipeline } from "../store";
import { Section } from "./Section";

function CodeBlock({ code }: { code: string }) {
  const lines = code.split("\n");
  const html = highlightPython(code).split("\n");
  return (
    <pre className="language-python slim-scroll overflow-x-auto p-4" aria-label="Generated Python code">
      <code className="language-python">
        {lines.map((_, i) => (
          <span key={i} className="block">
            <span className="mr-4 inline-block w-7 select-none text-right text-[#3d4458]">{i + 1}</span>
            <span dangerouslySetInnerHTML={{ __html: html[i] ?? "&nbsp;" }} />
          </span>
        ))}
      </code>
    </pre>
  );
}

function DiffView({ oldCode, newCode }: { oldCode: string; newCode: string }) {
  const hunks = useMemo(() => diffLines(oldCode, newCode), [oldCode, newCode]);
  const adds = hunks.filter((h) => h.kind === "add").length;
  const dels = hunks.filter((h) => h.kind === "del").length;
  return (
    <div>
      <p className="px-4 py-2 font-code text-[11px] text-[#9aa3b5]">
        <span className="text-[#34d399]">+{adds}</span> <span className="text-[#5b6478]">/</span>{" "}
        <span className="text-[#f43f5e]">−{dels}</span> lines changed by the model patch
      </p>
      <pre className="slim-scroll max-h-[420px] overflow-auto p-4" aria-label="Code diff">
        <code>
          {hunks.map((h, i) => (
            <span
              key={i}
              className={`block rounded px-1 ${
                h.kind === "add" ? "bg-[#34d399]/10" : h.kind === "del" ? "bg-[#f43f5e]/10" : ""
              }`}
            >
              <span className="mr-3 inline-block w-14 select-none text-right text-[#3d4458]">
                {h.oldNo ?? ""} {h.newNo ?? ""}
              </span>
              <span className={`mr-2 select-none font-bold ${h.kind === "add" ? "text-[#34d399]" : h.kind === "del" ? "text-[#f43f5e]" : "text-[#3d4458]"}`}>
                {h.kind === "add" ? "+" : h.kind === "del" ? "−" : " "}
              </span>
              <span dangerouslySetInnerHTML={{ __html: highlightLine(h.text) }} />
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function CodeWorkspace() {
  const { latestVersion, viewingVersion, setViewingVersion, phase } = usePipeline();
  const [showDiff, setShowDiff] = useState(true);
  const [copied, setCopied] = useState(false);
  const code = CODE_VERSIONS[viewingVersion - 1] ?? CODE_VERSIONS[0];
  const prev = CODE_VERSIONS[viewingVersion - 2];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([code], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline_v${viewingVersion}.py`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section
      kicker="Code workspace"
      title="Generated clean(df)"
      blurb="Every self-correction lands as a new version tab. Toggle the diff to see exactly what the model patched."
      action={
        <div className="flex gap-2">
          <button
            onClick={() => setShowDiff((d) => !d)}
            disabled={viewingVersion < 2}
            aria-pressed={showDiff}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#9aa3b5] transition hover:text-white disabled:opacity-30"
          >
            <GitCompare size={13} aria-hidden /> {showDiff ? "Show code" : "Show diff"}
          </button>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#9aa3b5] transition hover:text-white"
          >
            {copied ? <Check size={13} className="text-[#34d399]" aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#9aa3b5] transition hover:text-white"
          >
            <Download size={13} aria-hidden /> .py
          </button>
        </div>
      }
    >
      <div className="mb-3 flex gap-2" role="tablist" aria-label="Code versions">
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
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-code text-xs transition ${
                viewingVersion === v
                  ? "bg-[#8b5cf6]/30 text-white ring-1 ring-[#8b5cf6]/60"
                  : available
                    ? "bg-white/5 text-[#9aa3b5] hover:text-white"
                    : "cursor-not-allowed bg-transparent text-[#3d4458]"
              }`}
            >
              <FileCode2 size={12} aria-hidden /> v{v}
              {v === latestVersion && phase !== "idle" && (
                <span className="rounded-full bg-[#34d399]/20 px-1.5 text-[10px] text-[#34d399]">live</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {showDiff && prev ? <DiffView oldCode={prev} newCode={code} /> : <CodeBlock code={code} />}
      </div>
    </Section>
  );
}
