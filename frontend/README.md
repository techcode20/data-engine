# PipelineForge — frontend

Premium interactive single-page app for the autonomous data engine. **Simulation only** — no backend yet. A scripted ~31s demo plays the real system's behavior (attempt 1 fails validation, attempt 2 partially fixes, attempt 3 passes), including failure modes taken from the actual `fix_log.jsonl` (pandas-3 `format="mixed"` trap, bool-vs-boolean dtype strictness).

## Setup

```bash
cd frontend
npm install
npm run dev      # → http://localhost:5173
npm run build    # typecheck + production build into dist/
```

Zero extra config. Node 20+ recommended.

## Stack

React 19 + Vite + TypeScript · Tailwind CSS v4 · Framer Motion · Recharts (lazy) · react-force-graph-2d (lazy) · Prism (Python highlighting) · Zustand · lucide-react.

## How the simulation works

- `src/simulation/dataset.ts` — the messy 10×8 customers table, anomaly flags, cleaned output, target schema.
- `src/simulation/script.ts` — 3 scripted attempts: code versions (v1/v2/v3), validation checklists, score path 34 → 71 → 98, log lines, memory-graph additions.
- `src/simulation/engine.ts` — tick-based `Player` (play/pause/reset/1x/2x) + `PipelineBackend` interface.
- `src/store.ts` — Zustand store; the player emits events, the store applies them.

## Plugging in the real backend

1. Implement `PipelineBackend` in `src/simulation/engine.ts` as `ApiBackend`:
   `POST /ingest → /infer → /generate → /sandbox → /validate`, streaming stage
   events (SSE or websocket) into the same `EngineEvent` shapes the store already handles.
2. Replace the `Player` wiring in `src/store.ts` (`run`/`togglePause`/`reset`) with the live event stream.
3. Upload (`HeroUpload.loadFile`) already parses CSV/JSON locally — send the parsed payload (or file) to `POST /ingest` instead of running the script.
4. Keep `script.ts` as the offline demo/fallback and as fixtures for component tests.

No UI component needs to change — only the event source.
