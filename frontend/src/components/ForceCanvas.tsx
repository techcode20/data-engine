import ForceGraph2D from "react-force-graph-2d";
import type { MemoryLink, MemoryNode } from "../simulation/types";

const DOT: Record<string, string> = {
  error: "#f43f5e",
  fix: "#34d399",
  dataset: "#8b5cf6",
};

interface Props {
  nodes: MemoryNode[];
  links: MemoryLink[];
  particles: boolean;
}

/** Lazy-loaded (code-split) force-directed fix graph. */
export function ForceCanvas({ nodes, links, particles }: Props) {
  return (
    <ForceGraph2D
      graphData={{ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) }}
      height={340}
      backgroundColor="rgba(0,0,0,0)"
      nodeRelSize={6}
      linkColor={() => "rgba(255,255,255,0.22)"}
      linkDirectionalParticles={particles ? 2 : 0}
      linkDirectionalParticleSpeed={0.006}
      nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, scale: number) => {
        const n = node as { x?: number; y?: number; label?: string; kind?: string };
        const color = DOT[n.kind ?? "dataset"] ?? "#8b5cf6";
        if (n.x == null || n.y == null) return;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const label = (n.label ?? "").slice(0, 26);
        const fontSize = 11 / Math.max(1, scale * 0.6);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.fillStyle = "rgba(230,233,242,0.85)";
        ctx.fillText(label, n.x + 9, n.y + 4);
      }}
      nodePointerAreaPaint={(node: unknown, color: string, ctx: CanvasRenderingContext2D) => {
        const n = node as { x?: number; y?: number };
        if (n.x == null || n.y == null) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 9, 0, 2 * Math.PI);
        ctx.fill();
      }}
    />
  );
}
