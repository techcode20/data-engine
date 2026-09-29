import json
from datetime import datetime
from ingest import ingest
from schema_inference import infer_schema
from code_gen import generate_transform_code, fix_transform_code
from sandbox import run_generated_code
from validate import validate
from schema_builder import build_pandera_schema

MAX_RETRIES = 5

def log_fix(dataset_name, attempt_num, error, fixed_code):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "dataset": dataset_name,
        "attempt": attempt_num,
        "error": str(error)[:1000],
        "fix": fixed_code,
    }
    with open("fix_log.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")

df = ingest("sample_data.json")
rules = "customer_id is required and unique. name is required. plan must be one of FREE, BASIC, PRO. revenue must be numeric. contact.email must be a valid email."
schema_json = infer_schema(df, rules)
pandera_schema = build_pandera_schema(schema_json)
code = generate_transform_code(schema_json, rules)

attempt = 0
success = False

while attempt < MAX_RETRIES and not success:
    attempt += 1
    print(f"\n=== ATTEMPT {attempt} ===")

    cleaned_df, exec_error = run_generated_code(code, df)

    if exec_error:
        print("Execution failed. Asking model to fix it...")
        print(exec_error[:500])
        log_fix("sample_data.json", attempt, exec_error, code)
        code = fix_transform_code(code, exec_error, schema_json)
        continue
    print("DTYPES BEFORE VALIDATE:", cleaned_df.dtypes.to_dict())
    ok, failures = validate(cleaned_df, pandera_schema)

    if ok:
        print("✅ VALIDATION PASSED")
        print(cleaned_df)
        success = True
    else:
        print("Validation failed. Asking model to fix it...")
        print(failures)
        log_fix("sample_data.json", attempt, failures, code)
        code = fix_transform_code(code, str(failures), schema_json)

if not success:
    print(f"\n❌ Gave up after {MAX_RETRIES} attempts. Last code generated:")
    print(code)
