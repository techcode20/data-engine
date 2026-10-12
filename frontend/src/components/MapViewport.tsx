import { Minus, Plus, Scan, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { markMapDragged } from "../lib/mapGesture";
import { engineRef, useTransit } from "../store";
import { DESKTOP_VB, MOBILE_VB, STATIONS } from "../transit/mapConfig";

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
  /** Set once the operator pans/zooms — auto-fit (load/resize) then leaves
   *  their framing alone until they press fit again. */
  const touched = useRef(false);

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
    touched.current = true;
    apply();
  };

  /** Fit the map to its content (stations + siding + turnstile panel) with
   *  padding, clamped to the usual zoom range. Runs on load, on layout
   *  flip, and on window resize until the operator frames it themselves. */
  const fit = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const pts = STATIONS.map((s) => (mobile ? s.mpos : s.pos));
    const extra: Array<readonly [number, number]> = mobile ? [] : [[1095, 540], [830, 677]];
    const xs = [...pts.map((p) => p[0]), ...extra.map((p) => p[0])];
    const ys = [...pts.map((p) => p[1]), ...extra.map((p) => p[1])];
    const pad = mobile ? 40 : 60;
    const x0 = Math.max(0, Math.min(...xs) - pad);
    const x1 = Math.min(vb.w, Math.max(...xs) + pad);
    const y0 = Math.max(0, Math.min(...ys) - pad);
    const y1 = Math.min(vb.h, Math.max(...ys) + pad);
    if (x1 <= x0 || y1 <= y0) return;
    const k = Math.min(4, Math.max(0.6, Math.min(vb.w / (x1 - x0), vb.h / (y1 - y0))));
    const sx = r.width / vb.w;
    const sy = r.height / vb.h;
    view.current = {
      k,
      x: r.width / 2 - ((x0 + x1) / 2) * k * sx,
      y: r.height / 2 - ((y0 + y1) / 2) * k * sy,
    };
    touched.current = false;
    apply();
  };

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, w: r.width, h: r.height };
  };

  // (Wheel zoom lives in the native non-passive listener above —
  // React's delegated wheel handlers are passive and can't preventDefault.)

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: globalThis.WheelEvent) => {
      // Plain wheel scrolls the PAGE (trap nothing); Ctrl/Cmd+wheel zooms.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const v = view.current;
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const k2 = Math.min(4, Math.max(0.6, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const s = k2 / v.k;
      v.x = cx - (cx - v.x) * s;
      v.y = cy - (cy - v.y) * s;
      v.k = k2;
      touched.current = true;
      const g = gRef.current;
      if (g) g.setAttribute("transform", `translate(${v.x} ${v.y}) scale(${v.k})`);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  const downPos = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downPos.current = { x: e.clientX, y: e.clientY };
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
      touched.current = true;
      apply();
      if (downPos.current && Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y) > 6) {
        markMapDragged();
        if (follow) setFollow(false);
      }
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
  // Skipped while idle — the parked train sits offscreen and would yank the view.
  const phase = useTransit((s) => s.phase);
  useEffect(() => {
    if (!follow || phase === "idle") {
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
  }, [follow, phase, vb.w, vb.h]);

  // Reset view when layout flips.
  useEffect(() => {
    fit();
  }, [mobile]);

  // Refit on window resize until the operator frames it themselves.
  // Follow mode owns the camera while active, so leave it alone there.
  useEffect(() => {
    const onResize = () => {
      if (!touched.current && !useTransit.getState().follow) fit();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mobile]);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vb.w} ${vb.h}`}
        className="block h-[420px] w-full touch-pan-y select-none sm:h-[520px]"
        role="region"
        aria-label="PipelineForge transit map. Drag to pan, Ctrl-scroll or pinch to zoom."
        tabIndex={0}
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
          onClick={() => fit()}
          aria-label="Fit map to content"
          title="Fit map to content"
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
