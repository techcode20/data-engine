# PipelineForge Transit — frontend

A living-subway-map visualization of the autonomous data engine. **Simulation only** — no backend yet. A scripted ~30s demo plays the real system's behavior (attempt 1 fails validation, attempt 2 partially fixes, attempt 3 passes), including failure modes taken from the actual `fix_log.jsonl` (negative ages, `$1,200` currency strings, pandas-3 `format="mixed"` trap).

## Setup

```bash
cd frontend
npm install
npm run dev      # → http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run simcheck # headless verification: runs the REAL engine event stream
                 # in Node at 200x and asserts the narrative invariants
```

Zero extra config. Node 20+ recommended.

## Stack

React 19 + Vite + TypeScript · Tailwind CSS v4 · SVG map (no canvas) · GSAP + MotionPathPlugin (train motion) · Framer Motion (sheets) · Shiki (Python highlighting, lazy) · Zustand · lucide-react.

## How the simulation works

- `src/transit/mapConfig.ts` — **the map as data**: stations, lines, 45° segments, desktop + mobile layouts. Tracks reroute programmatically from here.
- `src/simulation/dataset.ts` — messy 8×7 ridership table, per-batch fates, target schema.
- `src/simulation/script.ts` — 3 scripted attempts (code v1/v2/v3, turnstile checks, score 36 → 74 → 97, logs, alerts, memory additions) + `validateScript()` + replay snapshots.
- `src/simulation/engine.ts` — GSAP timelines (one clock for motion + state events), pause/resume/1x-2x-4x, attempt replay, reduced-motion jumps.
- `src/store.ts` — Zustand store; the engine emits `EngineEvent`s, the store applies them.

## Verification (beyond `tsc`)

`npm run simcheck` bundles the real engine headlessly and asserts 30+ invariants: attempt order, fail→fail→pass validation, code versions, score path, carriage fates, single reroute, snapshot contents, route geometry. It caught a real bug once already (GSAP `.call()` defaulting to timeline-end, which bunched the whole narrative into one burst).

```bash
npm run test:unit  # vitest: replay integrity, upload cap, persistence, contrast, states
npm run test:e2e   # playwright (chromium): mobile sheet focus, focus-visible ring
```

Uploads over 10 MB are refused at the gate; run state persists across refresh in `sessionStorage` (mid-run restores paused for re-dispatch); a Cancel button parks the run with visited stations marked CANCELLED.

## Live backend (implemented)

`src/simulation/api.ts` (`ApiBackend`) implements the same `PipelineBackend`
contract against `POST /runs` + SSE (`backend_api.py`); the store picks it
in live mode (`?live=1`, LIVE toggle), uploads POST raw bytes, and tickets /
magnifier / poster / scrubber all read live data. API base: `VITE_API_URL`
baked at build time (`.env.production` sets `/api` for the Caddy-served
website; dev server and vitest default to `http://127.0.0.1:8000`).
`script.ts` + `simcheck` stay as the offline demo and regression net.

No map component needed to change — only the event source.
