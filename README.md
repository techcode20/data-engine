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
pip install pandas pandera google-genai python-dotenv pyyaml requests pytest pytest-cov
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

Inspect without executing, or quiet the logs:

```
python engine.py --config configs/customers.yaml --dry-run
python engine.py --config-dir configs --quiet
```

View historical pass rates and average retry counts per dataset:

```
python trends.py
```

Run the test suite (via `python -m pytest`, not bare `pytest` — the `pytest.exe` shim is blocked by Device Guard on some machines):

```
run_tests.bat
```

## How it works

1. **ingest.py** — loads raw CSV (as strings), local JSON, or a paginated API (Link-header, `page` param, or auto-detected) into a DataFrame. Native JSON types are preserved; CSVs stay strings until cleaning.
2. **schema_inference.py** — asks the model to propose a target schema (types, nullability, uniqueness, allowed values, min values) from a sample + your business rules
3. **schema_builder.py** — turns that JSON schema into a real `pandera.DataFrameSchema`
4. **schema_cache.py** — caches inferred schemas per dataset+rules+content hash (URLs hash by address; `--no-cache` bypasses)
5. **code_gen.py** — asks the model to write a `clean(df)` function matching the schema (with exact-dtype casting rules); also holds `fix_transform_code()`, used when something fails
6. **sandbox.py** — executes generated code safely, capturing errors without touching the original DataFrame
7. **validate.py** — runs the cleaned result through the pandera schema
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
```

## Secrets

- `.env` is gitignored and a pre-commit hook refuses to commit it or any staged diff containing a likely API key.
- Pass secrets via `{ENV_VAR}` placeholders or environment variables — never paste raw keys into configs, prompts, or run logs.
- If a key ever leaks (it happened once with an OpenWeather key in run history), rotate it in the provider console immediately.

## Evaluation

Beyond the unit suite, `test_eval_golden.py` checks end-to-end cleaning quality against golden fixtures in `eval_fixtures/`: known-dirty input → expected clean output, run through fixed `clean()` functions plus schema validation. Add a fixture pair whenever you onboard a new dataset shape.

## Known limitations

- `infer_schema()` samples the head of the data by default (see `--sample-rows` / adaptive sampling in `schema_inference.py`) — mostly-uniform data with rare edge rows can still miss cases; widen the sample for such datasets
- The self-correct loop caps at a fixed retry count; a dataset that's fundamentally ambiguous (contradictory business rules, genuinely malformed data) will exhaust retries rather than ask a human for clarification
- URL schema-cache keys hash the address, not the content — re-fetching a changed API dataset can reuse a stale schema unless `--no-cache` is used
