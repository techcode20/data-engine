from ingest import ingest
from schema_inference import infer_schema
from code_gen import generate_transform_code
from sandbox import run_generated_code
from validate import validate

df = ingest("sample_data.csv")

rules = "customer_id is required and unique. name is required. plan must be one of FREE, BASIC, PRO. revenue must be numeric."

schema_json = infer_schema(df, rules)
print("Schema inferred.\n")

code = generate_transform_code(schema_json, rules)
print("--- GENERATED CODE ---")
print(code)

cleaned_df, error = run_generated_code(code, df)

if error:
    print("\n--- EXECUTION FAILED ---")
    print(error)
else:
    print("\n--- CLEANED DATA ---")
    print(cleaned_df)
    ok, failures = validate(cleaned_df)
    if ok:
        print("\n✅ VALIDATION PASSED")
    else:
        print("\n❌ VALIDATION FAILED")
        print(failures)