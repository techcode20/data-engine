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

## Plugging in the real backend

1. Implement `PipelineBackend` in `src/simulation/engine.ts` as `ApiBackend`: drive stage events from `POST /ingest → /infer → /generate → /sandbox → /validate` (SSE or websocket), keep GSAP motion driven by arrival events.
2. Replace the `TransitEngine` wiring in `src/store.ts` (`depart`/`togglePause`/`scrubToAttempt`) with the live stream.
3. Upload (`GateHero.loadFile`) already parses CSV/JSON locally — POST the payload to `/ingest` instead of running the script.
4. Keep `script.ts` + `simcheck` as the offline demo and regression net.

No map component needs to change — only the event source.
