import { motion } from "framer-motion";
import { Brain, Search } from "lucide-react";
import { Suspense, lazy, useMemo } from "react";
import { usePipeline } from "../store";
import { Section } from "./Section";

const ForceCanvas = lazy(() => import("./ForceCanvas").then((m) => ({ default: m.ForceCanvas })));

export function FixMemory() {
  const { memNodes, memLinks, memoryQuery, setMemoryQuery, phase } = usePipeline();

  const filtered = useMemo(() => {
    const q = memoryQuery.trim().toLowerCase();
    if (!q) return { nodes: memNodes, links: memLinks };
    const keep = new Set(
      memNodes.filter((n) => `${n.label} ${n.detail} ${n.dataset}`.toLowerCase().includes(q)).map((n) => n.id),
    );
    // Keep neighbours of matches so the subgraph stays connected.
    for (const l of memLinks) {
      if (keep.has(l.source as unknown as string) || keep.has(l.target as unknown as string)) {
        keep.add(l.source as unknown as string);
        keep.add(l.target as unknown as string);
      }
    }
    return {
      nodes: memNodes.filter((n) => keep.has(n.id)),
      links: memLinks.filter(
        (l) => keep.has(l.source as unknown as string) && keep.has(l.target as unknown as string),
      ),
    };
  }, [memNodes, memLinks, memoryQuery]);

  return (
    <Section
      kicker="Fix memory · second brain"
      title="Every failure teaches the next run"
      blurb="Past fixes are deduplicated by error signature and injected into future prompts. New lessons animate into the graph live during the run."
      action={
        <label className="relative block">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6478]" aria-hidden />
          <input
            value={memoryQuery}
            onChange={(e) => setMemoryQuery(e.target.value)}
            placeholder="Search fixes… e.g. bool, datetime"
            aria-label="Search fix memory"
            className="w-56 rounded-xl border border-white/15 bg-black/30 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[#3d4458] focus:border-[#8b5cf6]/60"
          />
        </label>
      }
    >
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-2.5 lg:col-span-2">
          {filtered.nodes.filter((n) => n.kind === "fix").length === 0 && (
            <p className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-[#5b6478]">
              No fixes match — try a different query.
            </p>
          )}
          {filtered.nodes
            .filter((n) => n.kind === "fix")
            .map((n, i) => (
              <motion.article
                key={n.id}
                initial={{ opacity: 0, x: -18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.4) }}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5"
              >
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Brain size={14} className="text-[#34d399]" aria-hidden /> {n.label}
                </p>
                <p className="mt-1 font-code text-xs leading-relaxed text-[#9aa3b5]">{n.detail}</p>
                <p className="font-code mt-2 text-[10px] text-[#5b6478]">from {n.dataset}</p>
              </motion.article>
            ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 lg:col-span-3">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs text-[#5b6478]">
            <span className="font-code">
              {filtered.nodes.length} nodes · {filtered.links.length} edges
            </span>
            <span className="flex gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#f43f5e]" /> error
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#34d399]" /> fix
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" /> dataset
              </span>
            </span>
          </div>
          {filtered.nodes.length === 0 ? (
            <p className="p-8 text-center text-sm text-[#5b6478]">Graph is empty for this query.</p>
          ) : (
            <Suspense
              fallback={<p className="p-8 text-center font-code text-xs text-[#5b6478]">loading graph engine…</p>}
            >
              <ForceCanvas nodes={filtered.nodes} links={filtered.links} particles={phase === "running"} />
            </Suspense>
          )}
        </div>
      </div>
    </Section>
  );
}
