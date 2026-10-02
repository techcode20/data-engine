import { useEffect, useRef, useState } from "react";
import { useTransit } from "../store";

function FlipWord({ text, className }: { text: string; className?: string }) {
  const [key, setKey] = useState(0);
  const prev = useRef(text);
  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      setKey((k) => k + 1);
    }
  }, [text]);
  return (
    <span className={`flap inline-block px-2.5 py-1 font-board text-sm font-semibold tracking-wider sm:text-base ${className ?? ""}`}>
      <span key={key} className="flap-flip">
        {text}
      </span>
    </span>
  );
}

const STATUS_INK: Record<string, string> = {
  STANDBY: "#a8a091",
  BOARDING: "#f6f3ea",
  "ON TIME": "#16a34a",
  DELAYED: "#e3342f",
  REROUTING: "#f59e0b",
  CANCELLED: "#f59e0b",
  "ALL SERVICES RESTORED": "#16a34a",
};

export function DepartureBoard() {
  const board = useTransit((s) => s.board);
  const attempt = useTransit((s) => s.attempt);
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 w-max max-w-[94%] -translate-x-1/2" aria-label="Departure board">
      <div className="flex items-center gap-2 rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] px-3 py-2 shadow-[4px_4px_0_#141210] sm:gap-3 sm:px-4">
        <span className="hidden font-board text-[10px] tracking-[0.2em] text-[#6b6455] sm:inline">NEXT</span>
        <FlipWord text={board.next.toUpperCase()} />
        <span className="font-board hidden text-[10px] tracking-[0.2em] text-[#6b6455] sm:inline">ATT</span>
        <FlipWord text={`${Math.min(attempt, 3)}/3`} />
        <FlipWord text={board.status} className="font-bold" />
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: STATUS_INK[board.status] ?? "#a8a091" }}
          aria-hidden
        />
      </div>
    </div>
  );
}
