# Self-Synthesizing Data Engine

Turns a messy raw CSV/JSON/API dataset into a clean, validated dataset automatically — infers a schema, generates cleaning code, runs and validates it, and self-corrects on failure, up to a retry cap.

## Setup

1. Create and activate a virtual environment:
```
python -m venv venv
venv\Scripts\activate.bat
```

2. Install dependencies:

```
pip install -r requirements.txt
```

3. Add your keys to `.env` (never committed — see Secrets below):

```
GEMINI_API_KEY=your_key_here
DATA_API_KEY=your_bearer_token_here        # only if your APIs need auth
OPENWEATHER_API_KEY=your_key_here          # only for the OpenWeather demo
```

## Usage

Single dataset, direct flags (local file or API URL):

```
python engine.py --file mydata.csv --rules "id is required and unique. status must be one of A, B, C." --output cleaned.csv
python engine.py --file "https://api.github.com/users" --rules "id is required and unique. login is required." --pagination auto --output cleaned_users.csv
```

Single dataset, via a config file:

```
python engine.py --config configs/customers.yaml
```

Batch mode — run every config in a folder (add `--tag`, `--cadence`, or `--dataset` to filter; `--list-configs` to preview):

```
python engine.py --config-dir configs --max-workers 3
```

Use `{ENV_VAR}` placeholders anywhere a file/URL or rules string appears — they are expanded from the environment (works for secrets in URLs):

```yaml
file: "https://api.example.com/data?token={DATA_API_KEY}"
```

Inspect without executing, quiet the logs, fail fast, or bypass the cache:

```
python engine.py --config configs/customers.yaml --dry-run
python engine.py --config-dir configs --quiet
python engine.py --file mydata.csv --rules "..." --strict
python engine.py --file mydata.csv --rules "..." --no-cache --max-drop 0.5
```

View historical pass rates and average retry counts per dataset:

```
python trends.py
```

## Pipeline export & warehouse sink

The engine can hand back the generated `clean()` itself as a reusable script — stdlib + pandas only, no data-engine dependency, with a provenance header (source, rules, `input_hash`, schema hash) and the CSV export sanitizer baked in:

```
python engine.py --file mydata.csv --rules "..." --output cleaned.csv --emit-pipeline
python engine.py --file mydata.csv --rules "..." --emit-pipeline pipelines/orders.py
```

The bare flag derives `cleaned.pipeline.py` next to `--output` (else `<stem>.pipeline.py`). Only validated code is exported — failed runs emit nothing, and `--dry-run` writes a draft bannered `UNVALIDATED`. Replay it anywhere pandas exists:

```
python cleaned.pipeline.py --input mydata.csv --output replayed.csv
```

Load cleaned rows straight into SQLite (v1 sink; postgres-shaped URIs are refused loudly, not silently ignored):

```
python engine.py --file mydata.csv --rules "..." --sink sqlite:///warehouse.db
python engine.py --file mydata.csv --rules "..." --sink sqlite:///warehouse.db:orders --sink-if-exists append
```

Table defaults to the input stem (slugified); `--sink-if-exists replace|append|fail` defaults to `replace`, matching `--output` overwrite semantics. Warehouse cells stay raw — the `'=...` Excel-quote prefix is CSV-only and would corrupt stored data. A requested sink that fails fails the dataset loudly (`success=False`), never passes silently. Batch configs accept `emit_pipeline:` (path or `true` for auto), `sink:`, and `sink_if_exists:` keys.

## Cost & caching

Every Gemini call is metered in `gemini_client.py` (per-dataset attribution, so batch runs stay honest). Each run prints its totals, `run_summary.json` keeps them, and `trends.py` aggregates tokens per dataset:

```
💰 sample_data.csv: 2 LLM call(s), 3841 tokens (est. $0.0021)
```

Dollar estimates appear only when you set rates from the provider pricing page (no hardcoded prices — they change):

```
GEMINI_PRICE_INPUT_PER_MTOK=0.50
GEMINI_PRICE_OUTPUT_PER_MTOK=2.00
```

Cap spend per dataset with `--max-cost-usd` (or `max_cost:` per config): once the estimated cost of a dataset's retries reaches the cap, the engine stops retrying and marks the result `budget_stopped`. Without configured rates the guard warns and stays inactive.

Gate scheduled runs on spend and health (exit code 2 on breach — wired into `run_daily.bat`):

```
python trends.py --alert-on-failure --alert-tokens-above 100000 --alert-cost-above 1.00
```

Two caches cut repeat spend to zero:
- `schema_cache.json` — inferred schemas, keyed by dataset+rules+content (URLs fingerprint fetched content, so changed APIs re-infer; `--no-cache` bypasses).
- `code_cache.json` — known-good `clean()` functions, keyed by schema+rules. Reused with no LLM call; execution + validation still run, and a stale entry falls back to fresh generation exactly once.

Run the test suite (via `python -m pytest`, not bare `pytest` — the `pytest.exe` shim is blocked by Device Guard on some machines):

```
run_tests.bat
```

Schedule the daily batch on Windows with Task Scheduler pointing at `run_daily.bat` (runs `--cadence daily` configs, appends to `logs\daily_run.log`, pops an alert on failure).

See the visual frontend:

```
python dashboard.py
```

This builds `dashboard.html` from your run history (pass rates, tokens, latest runs, recent self-corrections) — open it in a browser, and re-run the script to refresh after new runs.

For the full interactive experience, see `frontend/` — **PipelineForge Transit**, a living-subway-map React app that plays a scripted run of this exact pipeline (ticket gate → 7 stations → turnstile validation → repair reroutes → archive cards → export tickets). `cd frontend && npm install && npm run dev`.

Cut a release after merging a feature:

```
python bump_version.py "Short note for the changelog"
```

## How it works

1. **ingest.py** — loads raw CSV (as strings), local JSON, or a paginated API (Link-header, `page` param, or auto-detected) into a DataFrame. Native JSON types are preserved; CSVs stay strings until cleaning.
2. **pre_clean.py** — deterministic, zero-LLM tidy pass (trims whitespace, maps empties to NaN, drops wholly-empty rows) so the model starts from clean input. Disable per run with `--no-pre-clean`. Opt-in `--smart-parse` additionally parses currency/datetime columns — strictly all-or-nothing per column, so the LLM has less conversion work and fewer chances to fumble dtypes.
2. **schema_inference.py** — asks the model to propose a target schema (types, nullability, uniqueness, allowed values, min values) from a sample + your business rules
3. **schema_builder.py** — turns that JSON schema into a real `pandera.DataFrameSchema`
4. **schema_cache.py** — caches inferred schemas per dataset+rules+content hash (URLs hash by address; `--no-cache` bypasses)
5. **code_gen.py** — asks the model to write a `clean(df)` function matching the schema (with exact-dtype casting rules); also holds `fix_transform_code()`, used when something fails
6. **sandbox.py** — executes generated code safely, capturing errors without touching the original DataFrame
7. **validate.py** — runs the cleaned result through the pandera schema, then applies dataset-level sanity checks (no empty output, row-drop fraction within `--max-drop`, no newly all-null columns). Sanity failures retry like validation failures — or stop immediately under `--strict`
8. **engine.py** — orchestrates all of the above in a self-correct loop (capped retries), handles CLI args, config files, env-var substitution, and batch/parallel execution
9. **fix_memory.py** — logs every error + fix to `fix_log.jsonl`, and feeds recent fixes back into future code generation as prior experience (capped per error signature so prompts stay lean)
10. **run_summary.py** / **trends.py** — record and report on run history over time
11. **gemini_client.py** — the one place all Gemini API calls go through (deterministic config, timeout, retry-with-backoff, per-call usage metering)

## Security model

Generated code is untrusted input — treat it that way:

- **Static gate** (`sandbox.py::gate_code`): an ALLOWLIST, not a denylist. Only `pd.<allowlisted>` data names (42 of them — no readers, no writers, no config), non-file-writing methods on the dataframe, pure builtins, and names bound inside the function survive. Imports, class definitions, async, unknown names/calls, and dunder access are rejected *without executing anything*.
- **Subprocess isolation**: approved code runs in a child process with a scrubbed environment (no `*API_KEY*/*SECRET*/*TOKEN*`), a foreign cwd, a kill-on-timeout (`SANDBOX_TIMEOUT_S`, default 120s), and POSIX memory/CPU caps where available (`SANDBOX_MAX_RSS_BYTES`, `SANDBOX_MAX_CPU_S`). Opt-in container mode: `SANDBOX_BACKEND=docker` + `SANDBOX_DOCKER_IMAGE=<img with pandas/pyarrow>` runs the child as `docker run --rm --pull never --network none` with only the workdir and the single worker file mounted (never the repo — that would expose `.env`); missing binary/image fails loudly, never falls back.
- **Data-only result transport**: the child returns the frame as PARQUET plus a JSON status file — the parent never unpickles worker output, so a hostile `__reduce__` gadget cannot execute here. No pickle fallback by design (a missing/blocked parquet engine fails the run loudly).
- **Prompt hygiene**: inference samples are wrapped in `<DATA>` tags with an untrusted-data instruction, capped at 200 chars/cell, and scanned for instruction patterns (refuses loudly instead of sending).
- **Leak discipline**: failure logs store error *shapes*, not cell values; only the live same-dataset fix prompt sees full values. State files are written owner-only (`0o600`).
- **Exports**: CSV cells starting with `= + @ |` (and friends) are quote-prefixed against spreadsheet formula injection.
- **Fetches**: non-public URL hosts are refused (`DATA_ALLOW_PRIVATE_HOSTS=1` bypasses for intranet demos); `..` in `--output` paths is rejected; CSV delimiter/encoding/headers are validated instead of guessed.
- **Residual risks (documented, not hidden)**: no RAM cap on Windows (timeout is the guard); DNS-rebinding TOCTOU on the URL check; shared YAML configs can point `file:` anywhere (by design for a local CLI).
- **Trust boundary (read this before exposing the engine)**: the AST gate + subprocess sandbox are *risk reduction*, not a strong security boundary — generated Python still runs on the same machine and filesystem (it can read local files the gate doesn't block and exfiltrate via the returned frame). Treat hostile datasets like hostile input: keep them in an OS-level container or equivalent isolation. The `Dockerfile` exists for exactly this: run untrusted sources with `--network none` and a read-only mount for inputs, e.g. `docker run --rm --network none -v %cd%/in:/app/in:ro -v %cd%/out:/app/out ...`. Do not put this CLI behind a network service without that layer.

## Config file format

```yaml
file: path/to/data.csv            # or an https:// API URL (supports {ENV_VAR})
rules: "plain-English business rules sentence"
retries: 5                        # optional, default 5
output: cleaned.csv               # optional
tag: production                   # optional, filter with --tag
schedule: daily                   # optional, filter with --cadence
pagination: auto                  # optional: link | page_param | auto (API sources only)
strict: false                     # optional, fail fast with no retries (like --strict)
max_drop: 0.75                    # optional, max row-drop fraction (like --max-drop)
no_cache: false                   # optional, re-infer schema every run
sample_rows: 15                   # optional, rows sampled for inference
no_pre_clean: false               # optional, skip the deterministic tidy pass
max_cost: 0.10                    # optional, USD cap per dataset (needs price rates)
smart_parse: false                # optional, best-effort currency/datetime parsing
```

## Secrets

- `.env` is gitignored and a pre-commit hook refuses to commit it or any staged diff containing a likely API key.
- Pass secrets via `{ENV_VAR}` placeholders or environment variables — never paste raw keys into configs, prompts, or run logs.

## Environment variables & limits

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | (required) | Model access. Never committed; never visible to generated code (sandbox env is scrubbed). |
| `DATA_API_KEY` | — | Bearer token attached to API fetches (same host only). |
| `OPENWEATHER_API_KEY` | — | Demo source only. |
| `GEMINI_PRICE_INPUT_PER_MTOK` / `GEMINI_PRICE_OUTPUT_PER_MTOK` | — | USD per 1M tokens, from the provider pricing page. Enables `$` estimates, `--max-cost-usd`, and cost alerts. No hardcoded prices. |
| `GEMINI_TIMEOUT_S` | `120` | Per-LLM-call timeout. Expiry is retryable, then terminal. |
| `SANDBOX_TIMEOUT_S` | `120` | Kill budget per `clean()` execution. Hung code becomes a fixable failure, not a hung run. |
| `SANDBOX_MAX_RSS_BYTES` / `SANDBOX_MAX_CPU_S` | `0` (off) | POSIX-only memory/CPU caps for the sandbox child. On Windows the timeout is the guard. |
| `DATA_MAX_BYTES` | `500 MB` | Local inputs above this are refused before loading. |
| `DATA_ALLOW_PRIVATE_HOSTS` | — | Set to `1` to fetch intranet/test URLs the SSRF guard would refuse. |
| `DAILY_MAX_TOKENS` / `DAILY_MAX_COST` | `100000` / unset | Alert thresholds consumed by `run_daily.bat`. |

Error budget per dataset: `retries` attempts (default 5) × `GEMINI_TIMEOUT_S` + `SANDBOX_TIMEOUT_S` bounds wall-clock; `--strict` fails after attempt 1; identical model output stops the loop immediately instead of burning retries. Exit code is `1` on any failure, `0` only when everything passes.
- If a key ever leaks (it happened once with an OpenWeather key in run history), rotate it in the provider console immediately.

## Evaluation

Beyond the unit suite, `test_eval_golden.py` checks end-to-end cleaning quality against golden fixtures in `eval_fixtures/`: known-dirty input → expected clean output, run through fixed `clean()` functions plus schema validation **and** sanity checks. Five shapes covered: `customers`, `orders`, `github` (API bools/ids), `rickmorty` (nested JSON flattening), `openweather` (single-object API payloads). Add a fixture quadruple whenever you onboard a new dataset shape.

## Known limitations

- `infer_schema()` samples the head of the data by default (see `--sample-rows` / adaptive sampling in `schema_inference.py`) — mostly-uniform data with rare edge rows can still miss cases; widen the sample for such datasets
- The self-correct loop caps at a fixed retry count; a dataset that's fundamentally ambiguous (contradictory business rules, genuinely malformed data) will exhaust retries rather than ask a human for clarification
- URL schema-cache keys hash the address, not the content — re-fetching a changed API dataset can reuse a stale schema unless `--no-cache` is used
