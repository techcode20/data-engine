import { useTransit } from "../store";

/** Retry budget as 5 numbered platform signs; each failed attempt darkens one. */
export function RetrySigns() {
  const attempt = useTransit((s) => s.attempt);
  const phase = useTransit((s) => s.phase);
  const spent = phase === "idle" ? 0 : Math.max(0, Math.min(attempt - 1, 5));
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`Retries used: ${spent} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const dark = n <= spent;
        return (
          <span
            key={n}
            className={`flex h-8 w-8 items-center justify-center rounded-md border-2 border-[#141210] font-board text-sm font-bold ${
              dark ? "bg-[#141210] text-[#f6f3ea]" : "bg-[#fffdf6]"
            }`}
          >
            {n}
          </span>
        );
      })}
      <span className="ml-1 font-board text-[10px] tracking-widest text-[#6b6455]">RETRIES</span>
    </div>
  );
}
