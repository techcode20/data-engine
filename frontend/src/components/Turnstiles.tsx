import { STATIONS } from "../transit/mapConfig";
import { useTransit } from "../store";

const SHORT = ["dtype", "null", "range", "uniq", "re"];

/** Five turnstile arches mounted above Validation Gate, wired to live checks. */
export function Turnstiles() {
  const mobile = useTransit((s) => s.mobile);
  const checks = useTransit((s) => s.checks);
  const gate = STATIONS.find((s) => s.id === "validation")!;
  const [gx, gy] = mobile ? gate.mpos : gate.pos;
  const oy = gy - 108;

  return (
    <g aria-label="Validation turnstiles">
      <rect x={gx - 118} y={oy - 34} width={236} height={76} rx={8} fill="#fffdf6" stroke="#141210" strokeWidth={3} />
      <text x={gx} y={oy - 18} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing={2} fill="#141210" fontFamily="'IBM Plex Mono',monospace">
        VALIDATION GATE
      </text>
      {SHORT.map((s, i) => {
        const c = checks[i];
        const color = !c || c.status === "pending" ? "#a8a091" : c.status === "pass" ? "#16a34a" : "#e3342f";
        const x = gx - 80 + i * 40;
        return (
          <g key={s}>
            <path d={`M ${x - 9} ${oy + 30} L ${x - 9} ${oy + 14} A 9 9 0 0 1 ${x + 9} ${oy + 14} L ${x + 9} ${oy + 30}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
            <text x={x} y={oy + 40 - 2} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={color} fontFamily="'IBM Plex Mono',monospace">
              {s}
            </text>
          </g>
        );
      })}
    </g>
  );
}
