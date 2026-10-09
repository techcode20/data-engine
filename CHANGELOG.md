## 0.4.0 - code-to-pipeline: exportable clean() + warehouse sink
`--emit-pipeline [PATH]` exports the validated `clean()` as a standalone script (stdlib + pandas only, provenance header, export sanitizer baked in, `VALIDATED` vs `UNVALIDATED DRY-RUN` banner; nothing emitted on failure). `--sink sqlite:///WH.DB[:TABLE]` loads cleaned rows into SQLite (table defaults to input stem, `--sink-if-exists replace|append|fail`, raw cells — no Excel-quote corruption, sink failure fails loudly). Both work in batch via `emit_pipeline` / `sink` / `sink_if_exists` config keys. 12 new tests; emitted pipelines verified by executing them headlessly and replay-matching the run's CSV.

## 0.3.0 - adversarial hardening
Sandbox is now real (AST gate + subprocess isolation + timeout kill + scrubbed env). Crash-hardening across LLM, schema, and validate paths. Prompt-injection scanning, failure redaction, formula-safe exports, SSRF/output guards. Ingestion validates encoding/delimiters/headers/sizes and reads JSON Lines. Batch survives single-dataset crashes; exit codes, partial outputs, run IDs, row reconciliation, repeat-code detection. Pinned deps (pip-audit clean), hypothesis properties, 141 tests green.

## Milestones 1â€“5 â€” Core pipeline
Ingest â†’ infer schema â†’ generate code â†’ sandbox execute â†’ validate, with a self-correct retry loop and automated pandera schema generation with business-rule checks.

## Milestones 6â€“10 â€” Memory, generalization, robustness
Fix-log history fed into future prompts. Generalized to a second dataset. Migrated from deprecated `google-generativeai` to `google-genai`.

## Milestones 11â€“17 â€” CLI and reliability
YAML config support, batch mode, concurrency (`ThreadPoolExecutor`), retry-with-backoff on API errors, persistent `run_summary.json`, pytest suite, trend reporting.

## Milestones 18â€“20 â€” Documentation and reflection
README added. Automated test running via `run_tests.bat` / pre-commit hook.

## Milestones 21â€“30 â€” API ingestion
Direct URL ingestion, Link-header and page-param pagination (later auto-detected), Bearer-token auth, a real end-to-end run against OpenWeatherMap, coverage reporting via `pytest-cov`, targeted tests for `ingest.py` (which had two real bugs â€” a dropped `return df`, and lost branches after an edit), and `.env` substitution in `--file` URLs.

## Milestones 32 â€” Correctness hardening
Golden fixtures for GitHub users, Rick & Morty nested JSON, and OpenWeather shapes (eval now covers 5 dataset shapes). Dataset-level sanity checks in `validate.py` (empty output, row-drop fraction, newly all-null columns) wired into the retry loop. `--strict` mode fails fast with no retries (CLI + per-config). `--max-drop` tunes the row-drop threshold (default 0.75).

## Milestones 31+ â€” Safety, secrets, eval, robustness
Git repo + `.gitignore` (env, outputs, caches, logs stay local) + a pre-commit hook that refuses `.env` and likely API keys. Scrubbed a leaked OpenWeather key from run history (rotate it in the provider console). README rewritten to match reality (API ingestion, native types, `python -m pytest`). Fix memory now capped per error signature with 90-day expiry and truncated prompt blocks. Golden-file eval (`eval_fixtures/` + `test_eval_golden.py`) checks end-to-end cleaning quality offline. Adaptive schema sampling (`--sample-rows`: head + seeded random slice), `--no-cache`, and content-fingerprinted URL cache keys. Notable catch from the eval: pandas 3 infers one datetime format per Series, so mixed-format dates need `format="mixed"` â€” the code-gen prompt now says so.

## Known bugs fixed along the way
- `ingest.py` briefly returned `None` after an incomplete edit dropped its `return df` and the CSV/local-JSON branches â€” caught and fixed, then covered by tests in Milestone 28
- A test assertion in `test_engine.py` had an off-by-one in expected retry count â€” fixed

## 0.2.0 - 2026-09-29
Packaging, dead-code removal, and scheduled-run hardening

## 0.2.1 — 2026-09-29
LLM metering, clean-code reuse cache, model verification

## 0.2.2 — 2026-09-29
Budget-guarded retries and deterministic pre-clean pass

## 0.2.3 — 2026-09-29
Spend alerts for scheduled runs and opt-in smart pre-parsers

## 0.3.0 - adversarial hardening
Sandbox is now real (AST gate + subprocess isolation + timeout kill + scrubbed env). Crash-hardening across LLM, schema, and validate paths. Prompt-injection scanning, failure redaction, formula-safe exports, SSRF/output guards. Ingestion validates encoding/delimiters/headers/sizes and reads JSON Lines. Batch survives single-dataset crashes; exit codes, partial outputs, run IDs, row reconciliation, repeat-code detection. Pinned deps (pip-audit clean), hypothesis properties, 141 tests green.

## 0.2.4 — 2026-09-29
Static HTML dashboard for run history

## 0.3.1 — 2026-10-02
Input lineage, trends SKIP fix, redirect auth boundary, full-config parity, genuine LLM deadlines, chaos stall demo, DOMPurify
