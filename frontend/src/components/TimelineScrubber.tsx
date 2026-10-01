import { useTransit } from "../store";

/** Timeline scrubber styled as a transit strip: jump back to any attempt. */
export function TimelineScrubber() {
  const phase = useTransit((s) => s.phase);
  const attempt = useTransit((s) => s.attempt);
  const scrubToAttempt = useTransit((s) => s.scrubToAttempt);
  const disabled = phase === "idle";

  return (
    <div className="flex items-center gap-3" role="group" aria-label="Rewind to attempt">
      <span className="font-board text-[10px] tracking-widest text-[#6b6455]">REWIND</span>
      <div className="relative h-2 flex-1 rounded-full bg-[#141210]/15" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#e3342f]" style={{ width: `${(Math.min(attempt, 3) / 3) * 100}%` }} />
        <div className="absolute inset-0 flex justify-between">
          {[1, 2, 3].map((n) => (
            <span key={n} className="h-2 w-2 -translate-y-0 rounded-full border-2 border-[#141210] bg-[#f6f3ea]" style={{ marginTop: -1 }} />
          ))}
        </div>
      </div>
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          disabled={disabled}
          onClick={() => scrubToAttempt(n)}
          aria-label={`Rewind to attempt ${n}`}
          className={`h-8 w-8 rounded-md border-2 font-board text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${
            attempt === n && phase !== "idle"
              ? "border-[#141210] bg-[#141210] text-[#f6f3ea]"
              : "border-[#141210] bg-[#fffdf6] hover:bg-[#f6f3ea]"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
