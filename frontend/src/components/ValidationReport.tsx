import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Suspense, lazy } from "react";
import { usePipeline } from "../store";
import { CountUp } from "./CountUp";
import { Section } from "./Section";

const GaugeChart = lazy(() => import("./GaugeChart").then((m) => ({ default: m.GaugeChart })));

const ICON = {
  pass: <CheckCircle2 size={16} className="shrink-0 text-[#34d399]" aria-hidden />,
  fail: <XCircle size={16} className="shrink-0 text-[#f43f5e]" aria-hidden />,
  pending: <CircleDashed size={16} className="shrink-0 text-[#5b6478]" aria-hidden />,
};

function Gauge({ score }: { score: number }) {
  const color = score >= 90 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f43f5e";
  return (
    <div className="relative h-44 w-44" role="img" aria-label={`Data quality score ${score} of 100`}>
      <Suspense fallback={<div className="absolute inset-0 rounded-full border border-white/10" />}>
        <GaugeChart score={score} color={color} />
      </Suspense>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold">
          <CountUp value={score} />
        </span>
        <span className="text-[11px] uppercase tracking-widest text-[#5b6478]">quality</span>
      </div>
    </div>
  );
}

export function ValidationReport() {
  const { checks, score, scoreHistory, errorText, phase, attempt } = usePipeline();
  const hasRun = checks.length > 0;

  return (
    <Section
      kicker="Validation report"
      title="Pandera checks + quality score"
      blurb="The same checklist the backend enforces: dtype, nullability, ranges, uniqueness, regex. The gauge climbs as self-correction lands."
      action={
        <span className="font-code rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-[#9aa3b5]">
          attempt {Math.min(attempt, 3)} · score path {scoreHistory.join(" → ") || "—"}
        </span>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex items-center justify-center lg:w-60 lg:shrink-0">
          <Gauge score={score} />
        </div>
        <div className="flex-1">
          {!hasRun ? (
            <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-[#5b6478]">
              No validation results yet — checks appear here on the first Validate stage.
            </div>
          ) : (
            <ul className="space-y-2">
              {checks.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${
                    c.status === "fail" ? "border-[#f43f5e]/40 bg-[#f43f5e]/5" : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  {ICON[c.status]}
                  <span className="flex-1">
                    <span className="font-code text-[13px]">{c.label}</span>
                    <span className="block text-xs text-[#9aa3b5]">{c.detail}</span>
                  </span>
                  <span
                    className={`font-code rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      c.status === "fail" ? "bg-[#f43f5e]/20 text-[#fda4af]" : "bg-[#34d399]/15 text-[#6ee7b7]"
                    }`}
                  >
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3.5">
            <p className="font-code mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-widest text-[#fbbf24]">
              <AlertTriangle size={12} aria-hidden /> Error fed back to the model
            </p>
            {errorText ? (
              <p className="font-code text-xs leading-relaxed text-[#fcd34d]">{errorText}</p>
            ) : phase === "done" ? (
              <p className="text-xs text-[#34d399]">Clean run — nothing fed back. The loop exits here.</p>
            ) : (
              <p className="text-xs text-[#5b6478]">Waiting for the first validation failure…</p>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
