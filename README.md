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

Two caches cut repeat spend to zero:
- `schema_cache.json` — inferred schemas, keyed by dataset+rules+content (URLs fingerprint fetched content, so changed APIs re-infer; `--no-cache` bypasses).
- `code_cache.json` — known-good `clean()` functions, keyed by schema+rules. Reused with no LLM call; execution + validation still run, and a stale entry falls back to fresh generation exactly once.

Run the test suite (via `python -m pytest`, not bare `pytest` — the `pytest.exe` shim is blocked by Device Guard on some machines):

```
run_tests.bat
```

Schedule the daily batch on Windows with Task Scheduler pointing at `run_daily.bat` (runs `--cadence daily` configs, appends to `logs\daily_run.log`, pops an alert on failure).

Cut a release after merging a feature:

```
python bump_version.py "Short note for the changelog"
```

## How it works

1. **ingest.py** — loads raw CSV (as strings), local JSON, or a paginated API (Link-header, `page` param, or auto-detected) into a DataFrame. Native JSON types are preserved; CSVs stay strings until cleaning.
2. **schema_inference.py** — asks the model to propose a target schema (types, nullability, uniqueness, allowed values, min values) from a sample + your business rules
3. **schema_builder.py** — turns that JSON schema into a real `pandera.DataFrameSchema`
4. **schema_cache.py** — caches inferred schemas per dataset+rules+content hash (URLs hash by address; `--no-cache` bypasses)
5. **code_gen.py** — asks the model to write a `clean(df)` function matching the schema (with exact-dtype casting rules); also holds `fix_transform_code()`, used when something fails
6. **sandbox.py** — executes generated code safely, capturing errors without touching the original DataFrame
7. **validate.py** — runs the cleaned result through the pandera schema, then applies dataset-level sanity checks (no empty output, row-drop fraction within `--max-drop`, no newly all-null columns). Sanity failures retry like validation failures — or stop immediately under `--strict`
8. **engine.py** — orchestrates all of the above in a self-correct loop (capped retries), handles CLI args, config files, env-var substitution, and batch/parallel execution
9. **fix_memory.py** — logs every error + fix to `fix_log.jsonl`, and feeds recent fixes back into future code generation as prior experience (capped per error signature so prompts stay lean)
10. **run_summary.py** / **trends.py** — record and report on run history over time
11. **gemini_client.py** — the one place all Gemini API calls go through (model name, retry-with-backoff)

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
```

## Secrets

- `.env` is gitignored and a pre-commit hook refuses to commit it or any staged diff containing a likely API key.
- Pass secrets via `{ENV_VAR}` placeholders or environment variables — never paste raw keys into configs, prompts, or run logs.
- If a key ever leaks (it happened once with an OpenWeather key in run history), rotate it in the provider console immediately.

## Evaluation

Beyond the unit suite, `test_eval_golden.py` checks end-to-end cleaning quality against golden fixtures in `eval_fixtures/`: known-dirty input → expected clean output, run through fixed `clean()` functions plus schema validation **and** sanity checks. Five shapes covered: `customers`, `orders`, `github` (API bools/ids), `rickmorty` (nested JSON flattening), `openweather` (single-object API payloads). Add a fixture quadruple whenever you onboard a new dataset shape.

## Known limitations

- `infer_schema()` samples the head of the data by default (see `--sample-rows` / adaptive sampling in `schema_inference.py`) — mostly-uniform data with rare edge rows can still miss cases; widen the sample for such datasets
- The self-correct loop caps at a fixed retry count; a dataset that's fundamentally ambiguous (contradictory business rules, genuinely malformed data) will exhaust retries rather than ask a human for clarification
- URL schema-cache keys hash the address, not the content — re-fetching a changed API dataset can reuse a stale schema unless `--no-cache` is used
