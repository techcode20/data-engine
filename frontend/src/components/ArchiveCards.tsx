import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useTransit } from "../store";

/** Archive Terminus: brass-edged fix cards + dotted incident mini-map. */
export function ArchiveCards() {
  const memNodes = useTransit((s) => s.memNodes);
  const memLinks = useTransit((s) => s.memLinks);
  const [q, setQ] = useState("");
  const fixes = useMemo(() => {
    const list = memNodes.filter((n) => n.kind === "fix");
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter((n) => `${n.label} ${n.detail} ${n.dataset}`.toLowerCase().includes(query));
  }, [memNodes, q]);

  const dots = useMemo(() => {
    const shown = memNodes.slice(0, 10);
    return shown.map((n, i) => {
      const a = (i / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2;
      return { n, x: 150 + Math.cos(a) * 105, y: 90 + Math.sin(a) * 62 };
    });
  }, [memNodes]);
  const byId = useMemo(() => new Map(dots.map((d) => [d.n.id, d])), [dots]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <label className="font-board mb-2 block text-[11px] tracking-widest text-[#6b6455]" htmlFor="archive-search">
          SEARCH THE ARCHIVE
        </label>
        <input
          id="archive-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. bool, datetime, currency…"
          className="w-full rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] px-3 py-2 text-sm outline-none placeholder:text-[#a8a091]"
        />
        <div className="mt-3 max-h-[300px] space-y-2.5 overflow-y-auto pr-1 slim-scroll">
          {fixes.length === 0 && (
            <p className="rounded-xl border-2 border-dashed border-[#141210]/30 p-5 text-center text-sm text-[#6b6455]">
              No cards match — the archive keeps everything, try another term.
            </p>
          )}
          {fixes.map((n, i) => (
            <motion.article
              key={n.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
              className="rounded-xl border-2 border-[#b08d2e] bg-gradient-to-br from-[#fffdf6] to-[#f7ecd0] p-3 shadow-[3px_3px_0_#b08d2e]"
            >
              <p className="text-sm font-bold">🎫 {n.label}</p>
              <p className="font-board mt-1 text-[11px] leading-relaxed text-[#3f3a30]">{n.detail}</p>
              <p className="font-board mt-1.5 text-[10px] text-[#6b6455]">filed from {n.dataset}</p>
            </motion.article>
          ))}
        </div>
      </div>
      <div className="rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] p-3">
        <p className="font-board mb-1 px-1 text-[11px] font-bold tracking-[0.2em]">INCIDENT MINI-MAP · dotted = similar fixes</p>
        <svg viewBox="0 0 300 180" className="block w-full" role="img" aria-label="Incident history mini-map">
          {memLinks.slice(0, 14).map((l, i) => {
            const a = byId.get(l.source as string);
            const b = byId.get(l.target as string);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#16a34a" strokeWidth={1.5} strokeDasharray="3 4" opacity={0.8} />;
          })}
          {dots.map((d) => (
            <g key={d.n.id}>
              <circle
                cx={d.x}
                cy={d.y}
                r={d.n.kind === "dataset" ? 9 : 7}
                fill={d.n.kind === "error" ? "#e3342f" : d.n.kind === "fix" ? "#16a34a" : "#f59e0b"}
                stroke="#141210"
                strokeWidth={2.5}
              >
                <title>{`${d.n.label} — ${d.n.detail}`}</title>
              </circle>
            </g>
          ))}
        </svg>
        <p className="flex gap-4 px-1 pt-1 text-[11px] font-semibold">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#e3342f]" />error</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" />fix</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />dataset</span>
        </p>
      </div>
    </div>
  );
}
