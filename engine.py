import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import glob
import hashlib
import os
import re
import sys
import yaml

from code_gen import fix_transform_code, generate_transform_code
from fix_memory import log_fix
from ingest import ingest
from run_summary import write_summary
from sandbox import run_generated_code
from schema_builder import build_pandera_schema
from schema_inference import infer_schema
from validate import validate
from importlib.metadata import version as _pkg_version
from schema_cache import get_cached_schema, set_cached_schema
from dotenv import load_dotenv
load_dotenv()


def substitute_env_vars(text: str) -> str:
    def replace(match):
        return os.getenv(match.group(1), match.group(0))
    return re.sub(r"\{([A-Z_][A-Z0-9_]*)\}", replace, text)


def _content_fingerprint(source: str, df) -> str | None:
    # Local files are already fingerprinted by content hash inside
    # schema_cache; for URLs the address alone goes stale when remote data
    # changes, so hash a slice of the fetched content instead.
    if isinstance(source, str) and source.lower().startswith(("http://", "https://")):
        try:
            blob = df.head(50).to_csv(index=False).encode("utf-8", errors="replace")
            return hashlib.md5(blob).hexdigest()
        except Exception:
            return None
    return None


def process_one(file_path, rules, retries, output_path, dry_run=False, quiet=False, pagination="link",
                no_cache=False, sample_rows=15):
    df = ingest(file_path, pagination=pagination)
    fingerprint = _content_fingerprint(file_path, df)
    schema_json = None if no_cache else get_cached_schema(file_path, rules, fingerprint)
    if schema_json is None:
        schema_json = infer_schema(df, rules, sample_rows=sample_rows)
    if not no_cache:
        set_cached_schema(file_path, rules, schema_json, fingerprint)
    pandera_schema = build_pandera_schema(schema_json)
    code = generate_transform_code(schema_json, rules)
    if dry_run:
        print("\n=== DRY RUN — SCHEMA ===")
        print(schema_json)
        print("\n=== DRY RUN — GENERATED CODE ===")
        print(code)
        return {"file": file_path, "success": None, "attempts": 0}

    attempt = 0
    success = False
    cleaned_df = None

    while attempt < retries and not success:
        attempt += 1
        if not quiet:
            print(f"\n=== {file_path} — ATTEMPT {attempt} ===")
        cleaned_df, exec_error = run_generated_code(code, df)

        if exec_error:
            print("Execution failed. Asking model to fix it...")
            log_fix(file_path, attempt, exec_error, code)
            code = fix_transform_code(code, exec_error, schema_json)
            continue

        ok, failures = validate(cleaned_df, pandera_schema)
        if ok:
            print(f"✅ {file_path}: VALIDATION PASSED (attempt {attempt})")
            success = True
        else:
            print("Validation failed. Asking model to fix it...")
            log_fix(file_path, attempt, str(failures), code)
            code = fix_transform_code(code, str(failures), schema_json)

    if success and output_path:
        cleaned_df.to_csv(output_path, index=False)
        print(f"Wrote {output_path}")

    return {"file": file_path, "success": success, "attempts": attempt}


def load_config(config_path):
    with open(config_path, "r") as f:
        config = yaml.safe_load(f)
    if not config:
        raise ValueError(f"{config_path} is empty or invalid YAML")
    missing = [k for k in ("file", "rules") if k not in config]
    if missing:
        raise ValueError(f"{config_path} is missing required key(s): {', '.join(missing)}")
    return config


def main():
    parser = argparse.ArgumentParser(description="Self-synthesizing data engine")
    parser.add_argument("--pagination", default="link", choices=["link", "page_param", "auto"], help="Pagination style for API sources (default: link)")
    parser.add_argument("--file", help="Path to input CSV or JSON")
    parser.add_argument("--rules", help="Business rules as a plain-English sentence")
    parser.add_argument("--retries", type=int, default=5, help="Max self-correct attempts (default: 5)")
    parser.add_argument("--output", default=None, help="Path to write cleaned CSV (optional)")
    parser.add_argument("--config", default=None, help="Path to a YAML config with file/rules/retries/output")
    parser.add_argument("--list-configs", action="store_true", help="Preview configs in --config-dir without running them")
    try:
        _v = _pkg_version("data-engine")
    except Exception:
        _v = "dev"
    parser.add_argument("--version", action="version", version=f"data-engine {_v}")
    parser.add_argument("--tag", default=None, help="Run only configs matching this tag from --config-dir")
    parser.add_argument("--cadence", default=None, help="Run only configs whose schedule field matches this value")
    parser.add_argument("--dataset", default=None, help="Run only the named config (e.g. 'customers') from --config-dir, by filename stem")
    parser.add_argument(
        "--config-dir",
        default=None,
        help="Path to a folder of YAML configs to run in batch",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=3,
        help="Max datasets to process concurrently in batch mode (default: 3)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Infer schema and generate code, but skip execution/validation")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-attempt progress output")
    parser.add_argument("--no-cache", action="store_true", help="Bypass the schema cache (re-infer every run)")
    parser.add_argument("--sample-rows", type=int, default=15, help="Rows sampled for schema inference: head + deterministic random slice (default: 15)")
    args = parser.parse_args()
    if args.file:
        args.file = substitute_env_vars(args.file)
    if args.rules:
        args.rules = substitute_env_vars(args.rules)

    # Apply configuration file fallbacks if provided
    if args.config:
        config = load_config(args.config)
        args.file = config.get("file", args.file)
        args.rules = config.get("rules", args.rules)
        args.retries = config.get("retries", args.retries)
        args.output = config.get("output", args.output)

    results = []

    if args.config_dir:
        config_files = sorted(glob.glob(os.path.join(args.config_dir, "*.yaml")))
        if args.tag:
            config_files = [p for p in config_files if load_config(p).get("tag") == args.tag]
            if not config_files:
                parser.error(f"No config tagged '{args.tag}' found in {args.config_dir}")
        if args.cadence:
            config_files = [p for p in config_files if load_config(p).get("schedule") == args.cadence]
            if not config_files:
                parser.error(f"No config with schedule '{args.cadence}' found in {args.config_dir}")
        if args.dataset:
            config_files = [p for p in config_files if os.path.splitext(os.path.basename(p))[0] == args.dataset]
            if not config_files:
                parser.error(f"No config named '{args.dataset}' found in {args.config_dir}")
        if args.list_configs:
            print(f"Found {len(config_files)} config(s) in {args.config_dir}:\n")
            for cfg_path in config_files:
                cfg = load_config(cfg_path)
                print(f"  {cfg_path}")
                print(f"    file:  {cfg['file']}")
                print(f"    rules: {cfg['rules'][:80]}{'...' if len(cfg['rules']) > 80 else ''}")
                print(f"    schedule: {cfg.get('schedule', 'manual')}")
            return
        if not config_files:
            parser.error(f"No .yaml files found in {args.config_dir}")

        configs_to_run = [load_config(p) for p in config_files]

        with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
            futures = {
                executor.submit(
                    process_one,
                    cfg["file"],
                    cfg["rules"],
                    cfg.get("retries", 5),
                    cfg.get("output"),
                    dry_run=args.dry_run,
                    quiet=args.quiet,
                    pagination=cfg.get("pagination", args.pagination),
                    no_cache=cfg.get("no_cache", args.no_cache),
                    sample_rows=cfg.get("sample_rows", args.sample_rows),
                ): cfg["file"]
                for cfg in configs_to_run
            }
            for future in as_completed(futures):
                results.append(future.result())
    else:
        if not args.file or not args.rules:
            parser.error("--file and --rules are required, either directly or via --config")

        result = process_one(args.file, args.rules, args.retries, args.output, dry_run=args.dry_run, quiet=args.quiet, pagination=args.pagination, no_cache=args.no_cache, sample_rows=args.sample_rows)
        results.append(result)

    print("\n=== SUMMARY ===")
    write_summary(results)
    for r in results:
        status = "✅ PASS" if r["success"] else "❌ FAIL"
        print(f"{status}  {r['file']}  (attempts: {r['attempts']})")

    if any(not r["success"] for r in results):
        failed = [r["file"] for r in results if not r["success"]]
        with open("last_run_failures.txt", "w") as f:
            f.write("\n".join(failed))
    elif os.path.exists("last_run_failures.txt"):
        os.remove("last_run_failures.txt")  # clean up once things pass again


if __name__ == "__main__":
    main()
