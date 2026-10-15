import { useEffect } from "react";
import { groupCars } from "../lib/consist";
import { LINE_STATE_STYLE, segmentState } from "../lib/lines";
import { mapDragSuppressed } from "../lib/mapGesture";
import { engineRef, useTransit } from "../store";
import { COLORS, CORNER_R, LINE_WIDTH, STATION_R } from "../tokens";import {
  LINE_COLOR,
  SEGMENTS,
  STATIONS,
  type StationId,
} from "../transit/mapConfig";
import { pointAlong, roundedPath } from "../transit/geometry";
import type { CarriageState } from "../simulation/types";
import { MapViewport } from "./MapViewport";
import { Turnstiles } from "./Turnstiles";

const CAR_FILL: Record<CarriageState, string> = {
  dirty: "#fb923c",
  clean: "#ffffff",
  partial: "#ffffff",
  rejected: "#78716c",
};

function Carriage({ x, state, index }: { x: number; state: CarriageState; index: number }) {
  const selectCarriage = useTransit((s) => s.selectCarriage);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Carriage ${index + 1}, ${state}. Open batch magnifier.`}
      onClick={(e) => {
        e.stopPropagation();
        if (mapDragSuppressed()) return; // that was a pan, not a tap
        selectCarriage(index);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectCarriage(index);
        }
      }}
      transform={`translate(${x} 0)`}
      style={{ cursor: "pointer" }}
    >
      <title>{`Batch ${index + 1} — ${state}`}</title>
      {state === "partial" ? (
        <>
          <rect x={-23} y={-12} width={23} height={24} rx={4} fill="#ffffff" stroke={COLORS.ink} strokeWidth={2.5} />
          <rect x={0} y={-12} width={23} height={24} rx={4} fill={COLORS.dirty} stroke={COLORS.ink} strokeWidth={2.5} />
        </>
      ) : (
        <rect
          x={-23}
          y={-12}
          width={46}
          height={24}
          rx={4}
          fill={CAR_FILL[state]}
          stroke={COLORS.ink}
          strokeWidth={2.5}
          strokeDasharray={state === "rejected" ? "5 3" : undefined}
        />
      )}
      {["int", "date", "str"].map((w, i) => (
        <g key={w} transform={`translate(${-15 + i * 14} -4)`}>
          <rect x={-6} y={-4} width={12} height={8} rx={1.5} fill={state === "clean" || state === "partial" ? "#e8f4ff" : "#fff7ed"} stroke={COLORS.ink} strokeWidth={1} />
          <text y={3.2} textAnchor="middle" fontSize={5.4} fontFamily="IBM Plex Mono, monospace" fill={COLORS.ink}>
            {w}
          </text>
        </g>
      ))}
    </g>
  );
}

function Train() {
  const carriages = useTransit((s) => s.carriages);
  const liveRows = useTransit((s) => s.liveRows);
  const attempt = useTransit((s) => s.attempt);
  const cars = groupCars(carriages, liveRows);
  return (
    <g id="pf-train" transform="translate(-500 -500)" aria-label={`Dataset train, attempt ${attempt}`}>
      {/* engine */}
      <rect x={-14} y={-13} width={30} height={26} rx={6} fill={COLORS.ink} />
      <circle cx={1} cy={0} r={8} fill="none" stroke="#f6f3ea" strokeWidth={2.5} />
      <rect x={-4} y={-2.5} width={10} height={5} fill="#f6f3ea" />
      <text x={1} y={22} textAnchor="middle" fontSize={9} fontWeight={700} fill={COLORS.ink} fontFamily="IBM Plex Mono, monospace">
        PF·{attempt}
      </text>
      {cars.map((car, i) => (
        <Carriage key={i} x={-46 - i * 52} state={car.state} index={i} />
      ))}
    </g>
  );
}

function Crew() {
  const visible = useTransit((s) => s.crewVisible);
  return (
    <g id="pf-crew" opacity={visible ? 1 : 0} aria-hidden={!visible}>
      <rect x={-16} y={-10} width={32} height={20} rx={6} fill={COLORS.repair} stroke={COLORS.ink} strokeWidth={2.5} />
      <text y={4.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={COLORS.ink}>
        CREW
      </text>
    </g>
  );
}

function ShuntCars() {
  const disruption = useTransit((s) => s.disruption);
  return (
    <g id="pf-shunt" opacity={disruption ? 1 : 0} aria-hidden={!disruption}>
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${-26 * i} 0)`}>
          <rect x={-23} y={-12} width={46} height={24} rx={4} fill={COLORS.rejected} stroke={COLORS.ink} strokeWidth={2.5} strokeDasharray="5 3" />
          <text y={4} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff" fontFamily="IBM Plex Mono, monospace">
            REJ
          </text>
        </g>
      ))}
    </g>
  );
}

function StationGlyph({ id }: { id: StationId }) {
  const cfg = STATIONS.find((s) => s.id === id)!;
  const mobile = useTransit((s) => s.mobile);
  const status = useTransit((s) => s.stages[id].status);
  const selectStation = useTransit((s) => s.selectStation);
  const [x, y] = mobile ? cfg.mpos : cfg.pos;
  const dot = status === "passed" ? COLORS.memory : status === "failed" ? COLORS.main : status === "running" ? COLORS.validation : status === "retrying" || status === "timeout" ? COLORS.repair : status === "cancelled" ? "#78716c" : "transparent";

  return (
    <g>
      <g
        role="button"
        tabIndex={0}
        aria-label={`${cfg.name} station, ${status}. Open platform sheet.`}
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (mapDragSuppressed()) return; // that was a pan, not a tap
          selectStation(id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectStation(id);
          }
        }}
      >
        <title>{`${cfg.name} (${cfg.code}) — ${status}`}</title>
        {cfg.kind === "interchange" || cfg.kind === "terminal" ? (
          <>
            <circle cx={x} cy={y} r={STATION_R + 5} fill="#fff" stroke={COLORS.ink} strokeWidth={4} />
            <circle cx={x} cy={y} r={STATION_R - 3} fill={LINE_COLOR[cfg.lines[0]]} stroke={COLORS.ink} strokeWidth={3} />
          </>
        ) : (
          <>
            <circle cx={x} cy={y} r={STATION_R} fill="#fff" stroke={COLORS.ink} strokeWidth={4.5} />
            <circle cx={x} cy={y} r={4.5} fill={LINE_COLOR[cfg.lines[0]]} />
          </>
        )}
      </g>
        <text x={x} y={y - STATION_R - 12} textAnchor="middle" fontSize={15} fontWeight={700} fill={COLORS.ink} fontFamily="'Space Grotesk',sans-serif" data-map-label={`${id}-name`}>
          {cfg.name}
        </text>
        {id !== "validation" && (
        <text x={x} y={y - STATION_R - 28} textAnchor="middle" fontSize={11} fontWeight={600} fill="#6b6455" fontFamily="'IBM Plex Mono',monospace" letterSpacing={2} data-map-label={`${id}-platform`}>
          {mobile ? cfg.code : `${cfg.code} · ${cfg.platform}`}
        </text>
        )}
        {status !== "idle" && (
          <g transform={`translate(${x} ${y + STATION_R + 12})`} data-map-label={`${id}-status`}>
          <rect x={-34} y={-9} width={68} height={18} rx={9} fill={COLORS.ink} />
          <circle cx={-24} cy={0} r={4} fill={dot === "transparent" ? "#a8a091" : dot} />
          <text x={6} y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#f6f3ea" fontFamily="'IBM Plex Mono',monospace">
            {status.toUpperCase()}
          </text>
        </g>
      )}
    </g>
  );
}

export function TransitMap() {
  const mobile = useTransit((s) => s.mobile);
  const rerouteOn = useTransit((s) => s.rerouteOn);
  const disruption = useTransit((s) => s.disruption);
  const memNodes = useTransit((s) => s.memNodes);
  const liveMode = useTransit((s) => s.liveMode);
  const phase = useTransit((s) => s.phase);
  const stages = useTransit((s) => s.stages);

  // Live runs have no GSAP timeline: the scripted engine tweens #pf-train
  // along motion paths (with autoRotate), but ApiBackend only publishes
  // trainPos. Without this loop the train sits parked offscreen forever.
  // The loop advances the backend's eased glide clock and pins the node
  // upright every frame: the consist is a labelled schematic assembly and
  // must never rotate (rotating it turns every westbound leg upside down).
  useEffect(() => {
    if (!liveMode || phase === "idle") return;
    if (typeof requestAnimationFrame !== "function" || typeof document !== "object") return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      const eng = engineRef();
      const el = document.getElementById("pf-train");
      if (eng && el && "update" in eng) {
        (eng as unknown as { update: (dt: number) => void }).update(last ? Math.min(t - last, 100) : 16);
        last = t;
        const pos = eng.trainPos;
        el.setAttribute("transform", `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [liveMode, phase]);

  const pts = (mpts: [number, number][], dpts: [number, number][]) => (mobile ? mpts : dpts);

  const mainRoute = (() => {
    const a = SEGMENTS.find((s) => s.id === "main-a")!;
    const b = SEGMENTS.find((s) => s.id === "main-b")!;
    return [...pts(a.mpts, a.pts), ...pts(b.mpts, b.pts).slice(1)];
  })();
  const repairLoop = (() => {
    const a = SEGMENTS.find((s) => s.id === "repair-out")!;
    const b = SEGMENTS.find((s) => s.id === "repair-reroute")!;
    return [...pts(a.mpts, a.pts), ...pts(b.mpts, b.pts).slice(1)];
  })();
  const siding = pts(
    SEGMENTS.find((s) => s.id === "rejected-siding")!.mpts,
    SEGMENTS.find((s) => s.id === "rejected-siding")!.pts,
  );
  const archive = pts(
    SEGMENTS.find((s) => s.id === "memory-line")!.mpts,
    SEGMENTS.find((s) => s.id === "memory-line")!.pts,
  );

  const arc = STATIONS.find((s) => s.id === "archive")!;
  const [ax, ay] = mobile ? arc.mpos : arc.pos;
  const constellation = memNodes.slice(-9).map((n, i) => {
    const a = (i / 9) * Math.PI * 2 - Math.PI / 2;
    return { n, x: ax + 120 + Math.cos(a) * 62, y: ay - 60 + Math.sin(a) * 44 };
  });

  return (
    <MapViewport>
      <defs>
        <pattern id="hazard" width={18} height={18} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width={18} height={18} fill={COLORS.hazardBlack} />
          <rect width={9} height={18} fill={COLORS.hazardYellow} />
        </pattern>
      </defs>

      {/* hidden motion routes (engine drives trains along these) */}
      <g aria-hidden opacity={0} pointerEvents="none">
        <path id="pf-route-main" d={roundedPath(mainRoute, CORNER_R)} fill="none" />
        <path id="pf-route-archive" d={roundedPath(archive, CORNER_R)} fill="none" />
        <path id="pf-route-repair" d={roundedPath(repairLoop, CORNER_R)} fill="none" />
        <path id="pf-route-shunt" d={roundedPath(siding, 8)} fill="none" />
      </g>

      {/* visible tracks */}
      {SEGMENTS.map((s) => {
        const p = pts(s.mpts, s.pts);
        const isReroute = !!s.reroute;
        const visible = !isReroute || rerouteOn;
        // State-driven track colour (idle ink / repair amber / done green /
        // failing red) with dash cues so state never rides on colour alone.
        const state = segmentState(s.id, stages, rerouteOn);
        const style = LINE_STATE_STYLE[state];
        const color = style.color;
        const dash =
          state === "failing" ? "10 6" : state === "repair" ? "2 7" : s.style === "dashed" ? "14 10" : undefined;
        const d = roundedPath(p, CORNER_R);
        const labelPos = pointAlong(p, 0.5);
        return (
          <g key={s.id} opacity={visible ? 1 : 0.28}>
            {isReroute && !rerouteOn ? (
              <path d={d} fill="none" stroke={color} strokeWidth={LINE_WIDTH} strokeLinecap="round" strokeDasharray="2 14" opacity={0.7} />
            ) : (
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={LINE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={dash}
              />
            )}
            {disruption && s.id === "main-b" && (
              <path d={d} fill="none" stroke="url(#hazard)" strokeWidth={LINE_WIDTH + 6} strokeLinecap="round" opacity={0.9} className="hazard-flash" />
            )}
            {s.label && (
              <text
                data-map-label={`line-${s.id}`}
                x={labelPos[0] + (mobile ? (s.mLabelDx ?? s.labelDx ?? 0) : (s.labelDx ?? 0))}
                y={labelPos[1] + (mobile ? (s.mLabelDy ?? s.labelDy ?? -16) : (s.labelDy ?? -16))}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                fill={COLORS.ink}
                fontFamily="'Space Grotesk',sans-serif"
                stroke="#f6f3ea"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {s.label}
              </text>
            )}
          </g>
        );
      })}

      {/* incident constellation near Archive */}
      <g aria-hidden>
        {constellation.map((c, i) =>
          i > 0 ? (
            <line
              key={`cl-${i}`}
              x1={constellation[0].x}
              y1={constellation[0].y}
              x2={c.x}
              y2={c.y}
              stroke={COLORS.memory}
              strokeWidth={1.4}
              strokeDasharray="3 4"
              opacity={0.7}
            />
          ) : null,
        )}
        {constellation.map((c) => (
          <circle key={`cd-${c.n.id}`} cx={c.x} cy={c.y} r={4} fill="#fff" stroke={COLORS.memory} strokeWidth={2} />
        ))}
      </g>

      {/* termini roundels */}
      {[
        { id: "intake", color: COLORS.main },
        { id: "archive", color: COLORS.memory },
      ].map(({ id, color }) => {
        const st = STATIONS.find((s) => s.id === id)!;
        const [x, y] = mobile ? st.mpos : st.pos;
        const off = id === "intake" ? (mobile ? 0 : -64) : 0;
        return (
          <g key={id} transform={`translate(${x + (mobile ? 0 : off)} ${y + (mobile ? (id === "intake" ? -56 : 56) : 0)})`} aria-hidden>
            <circle r={17} fill={color} stroke={COLORS.ink} strokeWidth={3.5} />
            <circle r={10.5} fill="#f6f3ea" />
            <rect x={-10.5} y={-3} width={21} height={6} fill={color} />
          </g>
        );
      })}

      <ShuntCars />
      <Crew />
      <Train />
      <Turnstiles />

      {STATIONS.map((s) => (
        <StationGlyph key={s.id} id={s.id} />
      ))}
    </MapViewport>
  );
}
