import { motion } from "framer-motion";
import { Check, Clock, Code, Copy, MapPin, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { layoutGraph, textSimilarity } from "../lib/graph";
import type { MemoryLink, MemoryNode } from "../simulation/types";
import { useTransit } from "../store";

const TAG_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: "bool", re: /bool/i },
  { tag: "datetime", re: /datetime|date(?!set)/i },
  { tag: "currency", re: /currency|\$|revenue/i },
  { tag: "astype", re: /astype/i },
];

const KIND_FILL: Record<MemoryNode["kind"], string> = {
  error: "#e3342f",
  fix: "#16a34a",
  dataset: "#f59e0b",
};

/** Render detail text with `backtick` spans as <code>, straightening the
 *  curly quotes models sometimes emit so pasted code stays valid. */
function RichText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded bg-[#141210]/5 px-1 font-board text-[11px] text-[#141210]"
          >
            {p.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function shortLabel(label: string, n = 20): string {
  return label.length > n ? `${label.slice(0, n - 1)}…` : label;
}

function clockTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Archive Terminus: brass-edged fix cards + deterministic incident mini-map. */
export function ArchiveCards() {
  const memNodes = useTransit((s) => s.memNodes);
  const memLinks = useTransit((s) => s.memLinks);
  const memMeta = useTransit((s) => s.memMeta);
  const [q, setQ] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef(0);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const fixes = useMemo(() => {
    const list = memNodes.filter((n) => n.kind === "fix");
    const query = q.trim().toLowerCase();
    return list.filter((n) => {
      const hay = `${n.label} ${n.detail} ${n.dataset}`;
      if (query && !hay.toLowerCase().includes(query)) return false;
      if (activeTag) {
        const rule = TAG_RULES.find((t) => t.tag === activeTag);
        if (rule && !rule.re.test(hay)) return false;
      }
      return true;
    });
  }, [memNodes, q, activeTag]);

  const errorFor = useMemo(() => {
    const byId = new Map(memNodes.map((n) => [n.id, n]));
    const map = new Map<string, string>();
    for (const l of memLinks) {
      if (l.label === "resolved-by" && byId.get(l.target)?.kind === "fix") {
        const err = byId.get(l.source);
        if (err && !map.has(l.target)) map.set(l.target, err.label);
      }
    }
    return map;
  }, [memNodes, memLinks]);

  const dots = useMemo(() => {
    const ids = [...memNodes.map((n) => n.id)].sort();
    const pairs = memLinks
      .map((l) => [l.source, l.target] as const)
      .filter(([a, b]) => a !== b);
    const pos = new Map(layoutGraph(ids, pairs, 300, 180).map((p) => [p.id, p]));
    const byId = new Map(memNodes.map((n) => [n.id, n]));
    return { pos, byId };
  }, [memNodes, memLinks]);

  const neighbourIds = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    for (const l of memLinks) {
      if (l.source === selected) set.add(l.target);
      if (l.target === selected) set.add(l.source);
    }
    return set;
  }, [selected, memLinks]);

  const nodeText = (n: MemoryNode) => `${n.label} ${n.detail} ${n.dataset}`;
  const edgePct = (l: MemoryLink) => {
    const a = dots.byId.get(l.source as string);
    const b = dots.byId.get(l.target as string);
    if (!a || !b) return null;
    return Math.round(textSimilarity(nodeText(a), nodeText(b)) * 100);
  };

  const counts = useMemo(() => {
    const kinds = memNodes.map((n) => n.kind);
    return {
      error: kinds.filter((k) => k === "error").length,
      fix: kinds.filter((k) => k === "fix").length,
      dataset: kinds.filter((k) => k === "dataset").length,
    };
  }, [memNodes]);

  const copyFix = async (n: MemoryNode) => {
    try {
      await navigator.clipboard.writeText(n.detail);
      setCopied(n.id);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied((c) => (c === n.id ? null : c)), 1600);
    } catch {
      /* clipboard denied (permissions) — no fake success state */
    }
  };

  const locate = (id: string) => setSelected((s) => (s === id ? null : id));

  const selectFromMap = (id: string) => {
    setSelected((s) => (s === id ? null : id));
    requestAnimationFrame(() => {
      cardRefs.current.get(id)?.scrollIntoView({ behavior: "auto", block: "nearest" });
    });
  };

  const clearSearch = () => {
    setQ("");
    setActiveTag(null);
  };

  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-2">
      <div className="flex h-full flex-col">
        <div className="max-h-[380px] overflow-y-auto pr-1 slim-scroll">
          <div className="sticky top-0 z-10 bg-[#fffdf6] pb-2 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-board text-[11px] tracking-widest text-[#6b6455]" htmlFor="archive-search">
                SEARCH THE ARCHIVE
              </label>
              <p aria-live="polite" className="font-board text-[11px] font-bold text-[#57534e]">
                {fixes.length} {fixes.length === 1 ? "FIX" : "FIXES"}
              </p>
            </div>
            <div className="relative mt-1.5">
              <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6455]" />
              <input
                id="archive-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. bool, datetime, currency…"
                className="w-full rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] py-2 pl-9 pr-9 text-sm outline-none placeholder:text-[#6b6455]"
              />
              {(q || activeTag) && (
                <button
                  onClick={clearSearch}
                  aria-label="Clear search and tags"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border-2 border-[#141210] bg-[#fffdf6] p-1 hover:bg-[#f6f3ea]"
                >
                  <X size={13} aria-hidden />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
              {TAG_RULES.map((t) => (
                <button
                  key={t.tag}
                  onClick={() => setActiveTag((a) => (a === t.tag ? null : t.tag))}
                  aria-pressed={activeTag === t.tag}
                  className={`rounded-full border-2 px-2.5 py-0.5 font-board text-[11px] font-bold transition ${
                    activeTag === t.tag
                      ? "border-[#141210] bg-[#141210] text-[#f6f3ea]"
                      : "border-[#141210] bg-[#fffdf6] hover:bg-[#f6f3ea]"
                  }`}
                >
                  {t.tag}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2.5 pt-1">
            {fixes.length === 0 && (
              <p className="rounded-xl border-2 border-dashed border-[#141210]/30 p-5 text-center text-sm text-[#6b6455]">
                No cards match — the archive keeps everything.{" "}
                <button onClick={clearSearch} className="font-bold underline">
                  Clear the search
                </button>
              </p>
            )}
            {fixes.map((n, i) => {
              const meta = memMeta[n.id];
              const sig = errorFor.get(n.id) ?? "general";
              const isSel = selected === n.id;
              return (
                <motion.article
                  key={n.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(n.id, el);
                    else cardRefs.current.delete(n.id);
                  }}
                  data-fix-card={n.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  className={`rounded-xl border-2 bg-gradient-to-br from-[#fffdf6] to-[#f7ecd0] p-3 shadow-[3px_3px_0_#b08d2e] ${
                    isSel ? "border-[#b91c1c] outline outline-2 outline-[#b91c1c]" : "border-[#b08d2e]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border-2 border-[#b91c1c] px-2 py-px font-board text-[10px] font-bold text-[#b91c1c]">
                      {sig}
                    </span>
                    <span className="inline-flex items-center gap-1 font-board text-[10px] text-[#6b6455]">
                      <Clock size={11} aria-hidden />
                      {meta ? `ATTEMPT ${meta.attempt} · ${clockTime(meta.at)}` : "BASE ARCHIVE"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-bold">🎫 {n.label}</p>
                  <p className="font-board mt-1 text-[11px] leading-relaxed text-[#3f3a30]">
                    <RichText text={n.detail} />
                  </p>
                  <p className="font-board mt-1.5 text-[10px] text-[#6b6455]">filed from {n.dataset}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => void copyFix(n)}
                      className="inline-flex items-center gap-1 rounded-lg border-2 border-[#141210] bg-[#fffdf6] px-2 py-1 font-board text-[11px] font-bold hover:bg-[#f6f3ea]"
                    >
                      {copied === n.id ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                      {copied === n.id ? "Copied" : "Copy fix"}
                    </button>
                    <button
                      onClick={() => document.getElementById("timetable")?.scrollIntoView({ behavior: "auto" })}
                      className="inline-flex items-center gap-1 rounded-lg border-2 border-[#141210] bg-[#fffdf6] px-2 py-1 font-board text-[11px] font-bold hover:bg-[#f6f3ea]"
                    >
                      <Code size={12} aria-hidden /> View diff
                    </button>
                    <button
                      onClick={() => locate(n.id)}
                      aria-pressed={isSel}
                      className={`inline-flex items-center gap-1 rounded-lg border-2 px-2 py-1 font-board text-[11px] font-bold ${
                        isSel ? "border-[#141210] bg-[#141210] text-[#f6f3ea]" : "border-[#141210] bg-[#fffdf6] hover:bg-[#f6f3ea]"
                      }`}
                    >
                      <MapPin size={12} aria-hidden /> Locate on map
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex h-full flex-col rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] p-3">
        <p className="font-board mb-1 px-1 text-[11px] font-bold tracking-[0.2em]">
          INCIDENT MINI-MAP · dotted = similar fixes
        </p>
        {memNodes.length < 3 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#141210]/30 p-6 text-center">
            <p className="text-sm font-bold">The constellation is still forming</p>
            <p className="font-board mt-1 max-w-[26ch] text-[11px] text-[#6b6455]">
              Run the line a few times — every filed incident becomes a star, dotted to its kin.
            </p>
          </div>
        ) : (
          <>
            <svg
              viewBox="0 0 300 180"
              className="block w-full flex-1"
              role="group"
              aria-label="Incident history mini-map. Tab to a node and press Enter to find its card."
              onClick={() => setSelected(null)}
            >
              {memLinks.slice(0, 14).map((l, i) => {
                const a = dots.pos.get(l.source as string);
                const b = dots.pos.get(l.target as string);
                if (!a || !b) return null;
                const incident =
                  selected != null && (l.source === selected || l.target === selected);
                const dimmed = selected != null && !incident;
                const pct = edgePct(l);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                return (
                  <g key={i} opacity={dimmed ? 0.18 : 0.9}>
                    <title>{`${l.label} · ${pct ?? "?"}% text similarity`}</title>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#16a34a" strokeWidth={incident ? 2.5 : 1.5} strokeDasharray="3 4" />
                    {incident && pct != null && (
                      <text
                        x={mx}
                        y={my - 4}
                        textAnchor="middle"
                        fontSize={8}
                        fontWeight={700}
                        fill="#15803d"
                        stroke="#fffdf6"
                        strokeWidth={2.5}
                        paintOrder="stroke"
                        fontFamily="'IBM Plex Mono',monospace"
                      >
                        {pct}%
                      </text>
                    )}
                  </g>
                );
              })}
              {[...dots.pos.entries()].map(([id, d]) => {
                const n = dots.byId.get(id)!;
                const isSel = selected === id;
                const dimmed = neighbourIds != null && !neighbourIds.has(id);
                return (
                  <g
                    key={id}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.kind} ${n.label}. Press Enter to find its card.`}
                    data-minimap-node={id}
                    data-selected={isSel}
                    opacity={dimmed ? 0.25 : 1}
                    className="minimap-node"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectFromMap(id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectFromMap(id);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{`${n.label} — ${n.detail}`}</title>
                    <circle
                      cx={d.x}
                      cy={d.y}
                      r={n.kind === "dataset" ? 9 : 7}
                      fill={KIND_FILL[n.kind]}
                      stroke={isSel ? "#b91c1c" : "#141210"}
                      strokeWidth={isSel ? 3.5 : 2.5}
                    />
                    <text
                      x={d.x}
                      y={d.y - 12}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={700}
                      fill="#141210"
                      stroke="#f6f3ea"
                      strokeWidth={2.5}
                      paintOrder="stroke"
                      fontFamily="'IBM Plex Mono',monospace"
                      className={isSel ? undefined : "minimap-label"}
                    >
                      {isSel ? shortLabel(n.label, 24) : shortLabel(n.label)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-1 text-[11px] font-semibold">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#e3342f]" aria-hidden />error ({counts.error})</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" aria-hidden />fix ({counts.fix})</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" aria-hidden />dataset ({counts.dataset})</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
