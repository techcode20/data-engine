import { STATIONS } from "../transit/mapConfig";
import { useTransit } from "../store";

const GATES = [
  { short: "dtype", full: "dtype" },
  { short: "null", full: "nulls" },
  { short: "range", full: "range" },
  { short: "uniq", full: "unique" },
  { short: "re", full: "regex" },
] as const;

/** Five turnstile arches for Validation Gate, wired to live checks.
 *  Desktop: panel sits clear of the Memory Line with a leader to the gate;
 *  mobile: the gate area is empty enough to mount it directly above. */
export function Turnstiles() {
  const mobile = useTransit((s) => s.mobile);
  const checks = useTransit((s) => s.checks);
  const gate = STATIONS.find((s) => s.id === "validation")!;
  const [gx, gy] = mobile ? gate.mpos : gate.pos;
  const bx = mobile ? gx : gx - 140;
  // Mobile: no room between the sandbox badge and the gate name, so the
  // panel docks below the gate badge instead of above the station.
  const by = mobile ? gy + 79 : gy + 77;
  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const pending = checks.filter((c) => c.status === "pending").length;

  return (
    <g aria-label="Validation turnstiles">
      {!mobile && (
        <line x1={bx + 118} y1={by - 30} x2={gx - 10} y2={gy + 18} stroke="#141210" strokeWidth={2} strokeDasharray="5 4" />
      )}
      <rect x={bx - 118} y={by - 34} width={236} height={94} rx={8} fill="#fffdf6" stroke="#141210" strokeWidth={3} />
      <text x={bx} y={by - 18} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing={2} fill="#141210" fontFamily="'IBM Plex Mono',monospace" data-map-label="turnstile-header">
        VALIDATION GATE · TURNSTILES A–E
      </text>
      {GATES.map((g, i) => {
        const c = checks[i];
        const color = !c || c.status === "pending" ? "#6b6455" : c.status === "pass" ? "#15803d" : "#b91c1c";
        const x = bx - 80 + i * 40;
        const tip = c ? `${g.full} — ${c.status}${c.detail ? `: ${c.detail}` : ""}` : `${g.full} — awaiting checks`;
        return (
          <g key={g.short} data-map-label={`turnstile-${g.short}`}>
            <title>{tip}</title>
            <path d={`M ${x - 9} ${by + 30} L ${x - 9} ${by + 14} A 9 9 0 0 1 ${x + 9} ${by + 14} L ${x + 9} ${by + 30}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
            <text x={x} y={by + 40 - 2} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={color} fontFamily="'IBM Plex Mono',monospace">
              {g.full}
            </text>
          </g>
        );
      })}
      <text x={bx} y={by + 52} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#57534e" fontFamily="'IBM Plex Mono',monospace" data-map-label="turnstile-counts">
        {`${pass} PASS · ${fail} FAIL · ${pending} PENDING`}
      </text>
    </g>
  );
}
