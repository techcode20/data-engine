# Self-Synthesizing Data Engine

Turns a messy raw CSV/JSON file into a clean, validated dataset automatically — infers a schema, generates cleaning code, runs and validates it, and self-corrects on failure, up to a retry cap.

## Setup

1. Create and activate a virtual environment:
python -m venv venv venv\Scripts\activate.bat

2. Install dependencies:

pip install pandas pandera google-genai python-dotenv pyyaml pytest

3. Add your Gemini API key to `.env`:

GEMINI_API_KEY=your_key_here


## Usage

Single dataset, direct flags:

python engine.py --file mydata.csv --rules "id is required and unique. status must be one of A, B, C." --output cleaned.csv


Single dataset, via a config file:

python engine.py --config configs/customers.yaml


Batch mode — run every config in a folder:

python engine.py --config-dir configs --max-workers 3


View historical pass rates and average retry counts per dataset:

python trends.py


Run the test suite:

pytest -v


## How it works

1. **ingest.py** — loads the raw CSV/JSON (flattening nested JSON), everything as strings first
2. **schema_inference.py** — asks the model to propose a target schema (types, nullability, uniqueness, allowed values, min values) from a sample + your business rules
3. **schema_builder.py** — turns that JSON schema into a real `pandera.DataFrameSchema`
4. **code_gen.py** — asks the model to write a `clean(df)` function matching the schema; also holds `fix_transform_code()`, used when something fails
5. **sandbox.py** — executes generated code safely, capturing errors without touching the original DataFrame
6. **validate.py** — runs the cleaned result through the pandera schema
7. **engine.py** — orchestrates all of the above in a self-correct loop (capped retries), handles CLI args, config files, and batch/parallel execution
8. **fix_memory.py** — logs every error + fix to `fix_log.jsonl`, and feeds recent fixes back into future code generation as prior experience
9. **run_summary.py** / **trends.py** — record and report on run history over time
10. **gemini_client.py** — the one place all Gemini API calls go through (model name, retry-with-backoff)

## Config file format

```yaml
file: path/to/data.csv
rules: "plain-English business rules sentence"
retries: 5          # optional, default 5
output: cleaned.csv # optional
```

## Known limitations

- `infer_schema()` samples only the first N rows (see `schema_inference.py`) — a dataset with rare edge cases not present in that sample may need the sample size increased
- The self-correct loop caps at a fixed retry count; a dataset that's fundamentally ambiguous (contradictory business rules, genuinely malformed data) will exhaust retries rather than ask a human for clarification
- No support yet for pulling data directly from an API (only local CSV/JSON files)