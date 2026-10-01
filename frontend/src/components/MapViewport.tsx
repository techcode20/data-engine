import { Minus, Plus, Scan, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, type ReactNode, type WheelEvent } from "react";
import { engineRef, useTransit } from "../store";
import { DESKTOP_VB, MOBILE_VB } from "../transit/mapConfig";

interface Props {
  children: ReactNode;
}

/** Pan / pinch-zoom / follow camera around the SVG map. Transform is applied
 *  imperatively (no per-frame React state) so Follow Train stays at 60fps. */
export function MapViewport({ children }: Props) {
  const follow = useTransit((s) => s.follow);
  const setFollow = useTransit((s) => s.setFollow);
  const mobile = useTransit((s) => s.mobile);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchD0 = useRef(0);
  const raf = useRef(0);

  const vb = mobile ? MOBILE_VB : DESKTOP_VB;

  const apply = () => {
    const g = gRef.current;
    if (!g) return;
    const { x, y, k } = view.current;
    g.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  };

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const v = view.current;
    const k2 = Math.min(4, Math.max(0.6, v.k * factor));
    const s = k2 / v.k;
    v.x = cx - (cx - v.x) * s;
    v.y = cy - (cy - v.y) * s;
    v.k = k2;
    apply();
  };

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, w: r.width, h: r.height };
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const p = svgPoint(e.clientX, e.clientY);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchD0.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const v = view.current;
      v.x += e.clientX - prev.x;
      v.y += e.clientY - prev.y;
      apply();
      if (follow) setFollow(false);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD0.current > 0) {
        const p = svgPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(p.x, p.y, d / pinchD0.current);
      }
      pinchD0.current = d;
    }
  };
  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchD0.current = 0;
  };

  // Follow-train camera: centers the engine's live train position.
  useEffect(() => {
    if (!follow) {
      cancelAnimationFrame(raf.current);
      return;
    }
    const loop = () => {
      const eng = engineRef();
      const svg = svgRef.current;
      if (eng && svg) {
        const r = svg.getBoundingClientRect();
        const sx = r.width / vb.w;
        const sy = r.height / vb.h;
        const v = view.current;
        // Keep current zoom, translate so the train sits centered.
        v.x += (r.width / 2 - (eng.trainPos.x * sx * v.k + v.x)) * 0.12;
        v.y += (r.height / 2 - (eng.trainPos.y * sy * v.k + v.y)) * 0.12;
        apply();
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [follow, vb.w, vb.h]);

  // Reset view when layout flips.
  useEffect(() => {
    view.current = { x: 0, y: 0, k: 1 };
    apply();
  }, [mobile]);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vb.w} ${vb.h}`}
        className="block h-[420px] w-full touch-none select-none sm:h-[520px]"
        role="application"
        aria-label="PipelineForge transit map. Drag to pan, scroll to zoom."
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={(e) => {
          const step = 24;
          const v = view.current;
          if (e.key === "ArrowLeft") v.x += step;
          else if (e.key === "ArrowRight") v.x -= step;
          else if (e.key === "ArrowUp") v.y += step;
          else if (e.key === "ArrowDown") v.y -= step;
          else if (e.key === "+" || e.key === "=") zoomAt(200, 200, 1.15);
          else if (e.key === "-") zoomAt(200, 200, 1 / 1.15);
          else return;
          e.preventDefault();
          apply();
        }}
      >
        <g ref={gRef}>{children}</g>
      </svg>
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <button
          onClick={() => {
            const r = svgRef.current?.getBoundingClientRect();
            zoomAt((r?.width ?? 400) / 2, (r?.height ?? 300) / 2, 1.25);
          }}
          aria-label="Zoom in"
          className="rounded-lg border-2 border-[#141210] bg-[#fffdf6] p-1.5 shadow hover:bg-[#f6f3ea]"
        >
          <Plus size={15} />
        </button>
        <button
          onClick={() => {
            const r = svgRef.current?.getBoundingClientRect();
            zoomAt((r?.width ?? 400) / 2, (r?.height ?? 300) / 2, 1 / 1.25);
          }}
          aria-label="Zoom out"
          className="rounded-lg border-2 border-[#141210] bg-[#fffdf6] p-1.5 shadow hover:bg-[#f6f3ea]"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={() => {
            view.current = { x: 0, y: 0, k: 1 };
            apply();
          }}
          aria-label="Reset view"
          className="rounded-lg border-2 border-[#141210] bg-[#fffdf6] p-1.5 shadow hover:bg-[#f6f3ea]"
        >
          <Scan size={15} />
        </button>
        <button
          onClick={() => setFollow(!follow)}
          aria-pressed={follow}
          aria-label={follow ? "Stop following train" : "Follow train"}
          className={`rounded-lg border-2 border-[#141210] p-1.5 shadow ${
            follow ? "bg-[#141210] text-[#f6f3ea]" : "bg-[#fffdf6] hover:bg-[#f6f3ea]"
          }`}
        >
          {follow ? <VideoOff size={15} /> : <Video size={15} />}
        </button>
      </div>
    </div>
  );
}
