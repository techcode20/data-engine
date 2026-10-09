import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import glob
import hashlib
import os
import re
import sys
import uuid

import pandas as pd
import yaml

from code_gen import fix_transform_code, generate_transform_code
from code_cache import get_cached_code, set_cached_code
from fix_memory import log_fix
from gemini_client import estimate_cost, reset_usage, usage_totals
from ingest import ingest
from pipeline_emit import check_pipeline_path, default_pipeline_path, render_pipeline, write_pipeline
from pre_clean import format_report, pre_clean, sanitize_export_cells, smart_parse
from run_summary import write_summary
from sandbox import run_generated_code
from schema_builder import build_pandera_schema
from schema_inference import infer_schema
from sinks import parse_sink, write_sink
from validate import redact_failure_cases, sanity_checks, validate
from importlib.metadata import version as _pkg_version
from schema_cache import get_cached_schema, set_cached_schema
from dotenv import load_dotenv
load_dotenv()

try:
    # Same rationale as trends.py: emoji status lines must not crash cp1252 consoles.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def substitute_env_vars(text: str) -> str:
    def replace(match):
        return os.getenv(match.group(1), match.group(0))
    return re.sub(r"\{([A-Z_][A-Z0-9_]*)\}", replace, text)


def _infer_valid_schema(df, rules, sample_rows, file_path, max_schema_tries=2):
    """Infer until the schema parses (or tries run out). Malformed model JSON
    is a retryable model failure, not a process crash."""
    last_error = None
    for i in range(max_schema_tries):
        schema_json = infer_schema(df, rules, sample_rows=sample_rows, tag=file_path)
        try:
            build_pandera_schema(schema_json)
            return schema_json
        except ValueError as e:
            last_error = e
            print(f"Schema attempt {i + 1} unparseable ({e}); asking model to re-emit JSON...")
            log_fix(file_path, 0, f"malformed schema JSON (try {i + 1}): {e}", schema_json)
    raise ValueError(f"model could not emit a valid schema: {last_error}")


def _input_hash(file_path, rules) -> str:
    """Content fingerprint distinguishing reruns over different data.

    Local files hash by content, URLs by address (body may change between
    fetches — the schema fingerprint covers that case instead).
    """
    try:
        with open(file_path, "rb") as f:
            content = hashlib.md5(f.read()).hexdigest()
    except (OSError, TypeError):
        content = hashlib.md5(str(file_path).encode("utf-8")).hexdigest()
    return hashlib.md5(f"{content}:{rules}".encode("utf-8")).hexdigest()


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


def _resolve_emit_path(emit_pipeline, file_path, output_path) -> str | None:
    """Flag value → concrete path. True/"auto" derives per-dataset (batch-safe);
    an explicit path is used as-is (traversal-checked at write time)."""
    if not emit_pipeline:
        return None
    if emit_pipeline is True or str(emit_pipeline).lower() == "auto":
        return default_pipeline_path(file_path, output_path)
    check_pipeline_path(emit_pipeline)
    return str(emit_pipeline)


def process_one(file_path, rules, retries, output_path, dry_run=False, quiet=False, pagination="link",
                no_cache=False, sample_rows=15, strict=False, max_drop_fraction=0.75,
                no_pre_clean=False, max_cost_usd=None, smart_parse_cols=False,
                emit_pipeline=None, sink=None, sink_if_exists="replace"):
    reset_usage(tag=file_path)  # attribute this run's LLM spend to this dataset
    input_hash = _input_hash(file_path, rules)
    try:
        df = ingest(file_path, pagination=pagination)
        if not no_pre_clean:
            df, pre_report = pre_clean(df)
            if not quiet:
                print(f"🧹 pre-clean: {format_report(pre_report)}")
        if smart_parse_cols:
            df, parse_report = smart_parse(df)
            if not quiet:
                parsed = (parse_report["currency_parsed"] + parse_report["dates_parsed"]
                          or ["nothing confidently parseable"])
                print(f"🔍 smart-parse: {', '.join(parsed)}")
        fingerprint = _content_fingerprint(file_path, df)
        schema_json = None if no_cache else get_cached_schema(file_path, rules, fingerprint)
        if schema_json is None:
            try:
                schema_json = _infer_valid_schema(df, rules, sample_rows, file_path)
            except ValueError as e:
                print(f"❌ {file_path}: unusable schema after re-inference: {e}")
                log_fix(file_path, 0, f"schema rejected: {e}", "")
                usage = _run_usage(file_path)
                return {"file": file_path, "success": False, "attempts": 0,
                        "usage": usage, "budget_stopped": False,
                        "error": f"schema rejected: {e}",
                        "input_hash": input_hash,
                        "pipeline_path": None, "sink": None,
                        "rows_in": len(df), "rows_out": 0, "rows_dropped": len(df)}
        if not no_cache:
            set_cached_schema(file_path, rules, schema_json, fingerprint)
        try:
            pandera_schema = build_pandera_schema(schema_json)
        except ValueError as e:
            # Cached schemas were valid when stored; reaching here means cache
            # corruption — fail this dataset loudly instead of crashing the batch.
            print(f"❌ {file_path}: cached schema unusable: {e}")
            usage = _run_usage(file_path)
            return {"file": file_path, "success": False, "attempts": 0,
                    "usage": usage, "budget_stopped": False,
                        "error": f"cached schema unusable: {e}",
                        "input_hash": input_hash,
                        "pipeline_path": None, "sink": None,
                        "rows_in": len(df), "rows_out": 0, "rows_dropped": len(df)}
        cached_code = None if no_cache else get_cached_code(schema_json, rules)
        if cached_code is not None:
            print(f"♻️ {file_path}: reusing cached clean() — schema solved before, no LLM call")
            code = cached_code
            used_cache = True
        else:
            code = generate_transform_code(schema_json, rules, tag=file_path)
            used_cache = False
    except Exception as e:
        # Setup-phase failure (unreadable input, injection refusal, empty model
        # response…): a FAIL result for this dataset, never a batch-killing crash.
        print(f"❌ {file_path}: setup failed: {e}")
        usage = _run_usage(file_path)
        return {"file": file_path, "success": False, "attempts": 0,
                "usage": usage, "budget_stopped": False,
                        "error": f"setup failed: {type(e).__name__}: {e}",
                        "input_hash": input_hash,
                        "pipeline_path": None, "sink": None,
                        "rows_in": 0, "rows_out": 0, "rows_dropped": 0}
    if dry_run:
        print("\n=== DRY RUN — SCHEMA ===")
        print(schema_json)
        print("\n=== DRY RUN — GENERATED CODE ===")
        print(code)
        pipeline_path = None
        emit_to = _resolve_emit_path(emit_pipeline, file_path, output_path)
        if emit_to:
            # Draft code, never executed: bannered UNVALIDATED in the header.
            text = render_pipeline(code, source=file_path, rules=rules,
                                   input_hash=input_hash, schema_json=schema_json,
                                   validated=False)
            write_pipeline(emit_to, text)
            pipeline_path = emit_to
            print(f"Wrote UNVALIDATED pipeline draft {emit_to}")
        return {"file": file_path, "success": None, "attempts": 0,
                "usage": _run_usage(file_path), "budget_stopped": False,
                "input_hash": input_hash,
                "pipeline_path": pipeline_path, "sink": None}

    attempt = 0
    success = False
    budget_stopped = False
    cleaned_df = None
    last_frame = None  # best-effort partial output on terminal failure
    seen_code = {hashlib.md5(code.encode("utf-8")).hexdigest()}

    def _repair(current_code, problem):
        """Next code via fix path; guarded — a fix-generation crash ends the run."""
        nonlocal code, used_cache
        try:
            code = _next_code(current_code, problem, schema_json, rules, file_path, used_cache)
        except Exception as e:
            print(f"❌ {file_path}: fix generation failed ({e}) — stopping.")
            log_fix(file_path, attempt, f"fix generation failed: {type(e).__name__}: {e}", current_code)
            return False
        used_cache = False  # fresh/fixed code is never the cached entry
        digest = hashlib.md5(code.encode("utf-8")).hexdigest()
        if digest in seen_code:
            print(f"⛔ {file_path}: model repeated identical code — stopping instead of burning retries.")
            return False
        seen_code.add(digest)
        return True

    while attempt < retries and not success:
        attempt += 1
        if not quiet:
            print(f"\n=== {file_path} — ATTEMPT {attempt} ===")
        cleaned_df, exec_error = run_generated_code(code, df)

        if cleaned_df is not None and not isinstance(cleaned_df, pd.DataFrame):
            # Model returned a non-frame (None, list, scalar): retryable, not fatal.
            cleaned_df, exec_error = None, (
                f"clean() must return a pandas DataFrame, got {type(cleaned_df).__name__}"
            )
        if isinstance(cleaned_df, pd.DataFrame):
            last_frame = cleaned_df
            if not quiet:
                print(f"rows: {len(df)} → {len(cleaned_df)}")

        if exec_error:
            print("Execution failed. Asking model to fix it...")
            log_fix(file_path, attempt, exec_error, code)
            if _over_budget(file_path, max_cost_usd):
                print(f"💸 BUDGET: {file_path} hit the ${max_cost_usd:.4f} cap — stopping, no retries.")
                budget_stopped = True
                break
            if strict:
                print(f"⛔ STRICT MODE: {file_path} failed on attempt {attempt} — stopping, no retries.")
                break
            if attempt >= retries:
                break  # no budget left for another round — don't burn a fix call
            if not _repair(code, exec_error):
                break
            continue

        ok, failures = validate(cleaned_df, pandera_schema)
        if ok:
            sanity_issues = sanity_checks(df, cleaned_df, max_drop_fraction=max_drop_fraction)
            if sanity_issues:
                ok = False
                failures = "\n".join(f"SANITY: {s}" for s in sanity_issues)
        if ok:
            print(f"✅ {file_path}: VALIDATION PASSED (attempt {attempt})")
            success = True
        else:
            print("Validation failed. Asking model to fix it...")
            # Persist the REDACTED failure (shapes, not customer cell values);
            # the live fix prompt below keeps full values for same-dataset repair.
            log_fix(file_path, attempt, redact_failure_cases(failures), code)
            if _over_budget(file_path, max_cost_usd):
                print(f"💸 BUDGET: {file_path} hit the ${max_cost_usd:.4f} cap — stopping, no retries.")
                budget_stopped = True
                break
            if strict:
                print(f"⛔ STRICT MODE: {file_path} failed on attempt {attempt} — stopping, no retries.")
                break
            if attempt >= retries:
                break  # no budget left for another round — don't burn a fix call
            if not _repair(code, str(failures)):
                break

    if not success and not budget_stopped and not strict:
        print(f"❌ {file_path}: gave up after {attempt} attempt(s)")

    rows_out = len(last_frame) if isinstance(last_frame, pd.DataFrame) else 0
    pipeline_path = None
    sink_info = None
    sink_error = None
    if success:
        if not no_cache:
            set_cached_code(schema_json, rules, code)
        if output_path:
            _check_output_path(output_path)
            sanitize_export_cells(cleaned_df).to_csv(output_path, index=False)
            print(f"Wrote {output_path}")
        if sink:
            try:
                spec = parse_sink(sink, file_path)
                sink_info = write_sink(cleaned_df, spec, if_exists=sink_if_exists)
                print(f"Wrote sink {sink_info['db']} :: {sink_info['table']} "
                      f"({sink_info['rows']} rows, {sink_if_exists})")
            except Exception as e:
                # The warehouse load was explicitly requested: a missing sink
                # must fail the dataset loudly, never pass silently. The
                # pipeline emit below is skipped with it — a failed run leaves
                # neither artifact.
                print(f"❌ {file_path}: sink failed ({type(e).__name__}: {e})")
                success = False
                sink_error = f"sink failed: {type(e).__name__}: {e}"
        if success:
            emit_to = _resolve_emit_path(emit_pipeline, file_path, output_path)
            if emit_to:
                text = render_pipeline(code, source=file_path, rules=rules,
                                       input_hash=input_hash, schema_json=schema_json,
                                       validated=True)
                write_pipeline(emit_to, text)
                pipeline_path = emit_to
                print(f"Wrote pipeline {emit_to}")
    elif output_path and isinstance(last_frame, pd.DataFrame):
        # Terminal failure still leaves evidence: best-effort partial output.
        # No pipeline and no sink on failure — unvalidated code must never
        # ship as a reusable artifact through the success path.
        partial = _partial_path(output_path)
        sanitize_export_cells(last_frame).to_csv(partial, index=False)
        print(f"Wrote partial output {partial} ({rows_out} rows from last attempt)")
        if emit_pipeline or sink:
            print(f"no pipeline/sink emitted for {file_path} (run failed)")

    usage = _run_usage(file_path)
    if usage["calls"]:
        cost = f" (est. ${usage['cost_usd']:.4f})" if usage["cost_usd"] is not None else ""
        print(f"💰 {file_path}: {usage['calls']} LLM call(s), {usage['total_tokens']} tokens{cost}")
    print(f"🧾 reconciliation: {len(df)} in → {rows_out} out ({len(df) - rows_out} dropped)")
    result = {"file": file_path, "success": success, "attempts": attempt,
              "usage": usage, "budget_stopped": budget_stopped,
              "input_hash": input_hash,
              "pipeline_path": pipeline_path, "sink": sink_info,
              "rows_in": len(df), "rows_out": rows_out,
              "rows_dropped": len(df) - rows_out}
    if sink_error is not None:
        result["error"] = sink_error
    return result


def _partial_path(output_path: str) -> str:
    """Sibling path for best-effort partial output on terminal failure."""
    import os as _os

    root, ext = _os.path.splitext(str(output_path))
    return f"{root}.partial{ext or '.csv'}"


def _check_output_path(output_path: str):
    """Refuse parent-directory escapes in export paths.

    Absolute paths elsewhere on disk are the operator's explicit choice and
    stay allowed; `..` segments (classic traversal via shared configs) are not.
    """
    parts = str(output_path).replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError(f"refusing output path with parent escape: {output_path!r}")


def _over_budget(file_path, max_cost_usd) -> bool:
    """True when a cap is set, rates are configured, and spend hit the cap."""
    if max_cost_usd is None:
        return False
    totals = usage_totals(tag=file_path)
    spent = estimate_cost(totals["prompt_tokens"], totals["completion_tokens"])
    return spent is not None and spent >= max_cost_usd


def _next_code(broken_code, error_info, schema_json, rules, file_path, used_cache):
    """Repair path: a stale cache entry gets ONE fresh generation (not a fix
    of code that was never right for this data); otherwise ask for a fix."""
    if used_cache:
        print("Cached code failed — falling back to fresh generation.")
        return generate_transform_code(schema_json, rules, tag=file_path)
    return fix_transform_code(broken_code, error_info, schema_json, tag=file_path)


def _run_usage(file_path):
    totals = usage_totals(tag=file_path)
    totals["cost_usd"] = estimate_cost(totals["prompt_tokens"], totals["completion_tokens"])
    return totals


def _validate_cli(args, parser):
    """Fail fast on nonsense numeric options and traversal-y export paths."""
    if args.retries is not None and args.retries < 1:
        parser.error("--retries must be >= 1")
    if args.max_drop is not None and not 0 <= args.max_drop <= 1:
        parser.error("--max-drop must be between 0 and 1")
    if args.sample_rows is not None and args.sample_rows < 1:
        parser.error("--sample-rows must be >= 1")
    if args.output:
        try:
            _check_output_path(args.output)
        except ValueError as e:
            parser.error(str(e))
    if args.emit_pipeline and args.emit_pipeline != "auto":
        try:
            check_pipeline_path(args.emit_pipeline)
        except ValueError as e:
            parser.error(str(e))
    if args.sink:
        try:
            parse_sink(args.sink, args.file or "x")
        except ValueError as e:
            parser.error(f"--sink: {e}")


def _expand_str(value):
    return substitute_env_vars(value) if isinstance(value, str) else value


# Config keys and the argparse attribute each one overrides (single-config).
_CONFIG_KEYS = (
    ("file", "file"), ("rules", "rules"), ("retries", "retries"),
    ("output", "output"), ("pagination", "pagination"), ("strict", "strict"),
    ("sample_rows", "sample_rows"), ("no_cache", "no_cache"),
    ("max_drop", "max_drop"), ("no_pre_clean", "no_pre_clean"),
    ("max_cost", "max_cost_usd"), ("smart_parse", "smart_parse"),
    ("emit_pipeline", "emit_pipeline"), ("sink", "sink"),
    ("sink_if_exists", "sink_if_exists"),
)
_EXPAND_KEYS = ("file", "rules", "output", "emit_pipeline", "sink")


def _apply_config_to_args(args, config):
    """Overlay every documented config key onto parsed CLI args.

    {ENV_VAR} placeholders expand AFTER the merge, so --config values expand
    too (CLI values get a harmless, idempotent second pass).
    """
    for cfg_key, arg_key in _CONFIG_KEYS:
        if cfg_key in config and config[cfg_key] is not None:
            setattr(args, arg_key, config[cfg_key])
    for key in _EXPAND_KEYS:
        val = getattr(args, key, None)
        if isinstance(val, str):
            setattr(args, key, substitute_env_vars(val))
    return args


def _expand_config(cfg: dict) -> dict:
    """Copy of a batch config with {ENV_VAR} expanded in string values."""
    out = dict(cfg)
    for key in _EXPAND_KEYS:
        out[key] = _expand_str(out.get(key))
    return out


def load_config(config_path):
    with open(config_path, "r") as f:
        config = yaml.safe_load(f)
    if not config:
        raise ValueError(f"{config_path} is empty or invalid YAML")
    missing = [k for k in ("file", "rules") if k not in config]
    if missing:
        raise ValueError(f"{config_path} is missing required key(s): {', '.join(missing)}")
    if "retries" in config and config["retries"] < 1:
        raise ValueError(f"{config_path}: retries must be >= 1")
    if "max_drop" in config and not 0 <= config["max_drop"] <= 1:
        raise ValueError(f"{config_path}: max_drop must be between 0 and 1")
    if "sample_rows" in config and config["sample_rows"] < 1:
        raise ValueError(f"{config_path}: sample_rows must be >= 1")
    if config.get("output"):
        _check_output_path(config["output"])
    if config.get("emit_pipeline") not in (None, True, "auto"):
        check_pipeline_path(config["emit_pipeline"])
    if config.get("sink"):
        try:
            parse_sink(config["sink"], config["file"])
        except ValueError as e:
            raise ValueError(f"{config_path}: sink: {e}")
    if config.get("sink_if_exists") not in (None, "replace", "append", "fail"):
        raise ValueError(f"{config_path}: sink_if_exists must be replace|append|fail")
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
    parser.add_argument("--strict", action="store_true", help="Fail fast on first error: no self-correct retries")
    parser.add_argument("--no-pre-clean", action="store_true", help="Skip the deterministic pre-clean pass")
    parser.add_argument("--smart-parse", action="store_true", help="Best-effort currency/datetime parsing before inference (all-or-nothing per column)")
    parser.add_argument("--max-cost-usd", type=float, default=None, help="Stop retrying a dataset once estimated LLM spend reaches this USD cap (needs GEMINI_PRICE_* rates)")
    parser.add_argument("--max-drop", type=float, default=0.75, help="Fail validation if cleaning drops more than this fraction of rows (default: 0.75)")
    parser.add_argument("--sample-rows", type=int, default=15, help="Rows sampled for schema inference: head + deterministic random slice (default: 15)")
    parser.add_argument("--emit-pipeline", nargs="?", const="auto", default=None, metavar="PATH",
                        help="Export the validated clean() as a standalone pipeline script (stdlib+pandas only). Bare flag derives foo.pipeline.py next to --output, else give a PATH.")
    parser.add_argument("--sink", default=None, metavar="SPEC",
                        help="Warehouse sink for cleaned rows, v1: sqlite:///PATH.DB[:TABLE] (table defaults to input stem)")
    parser.add_argument("--sink-if-exists", default="replace", choices=["replace", "append", "fail"],
                        help="What to do when the sink table already exists (default: replace)")
    args = parser.parse_args()
    if args.max_cost_usd is not None and estimate_cost(1, 1) is None:
        print("WARNING: --max-cost-usd is set but GEMINI_PRICE_INPUT_PER_MTOK / "
              "GEMINI_PRICE_OUTPUT_PER_MTOK are not configured — budget guard is inactive.")
    _validate_cli(args, parser)

    # Apply configuration file fallbacks if provided (every documented key,
    # not just file/rules/retries/output — single-config behaves like batch).
    if args.config:
        _apply_config_to_args(args, load_config(args.config))

    # CLI-only runs still need their placeholders expanded.
    for key in _EXPAND_KEYS:
        val = getattr(args, key, None)
        if isinstance(val, str):
            setattr(args, key, substitute_env_vars(val))

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

        configs_to_run = [_expand_config(load_config(p)) for p in config_files]

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
                    strict=cfg.get("strict", args.strict),
                    max_drop_fraction=cfg.get("max_drop", args.max_drop),
                    no_pre_clean=cfg.get("no_pre_clean", args.no_pre_clean),
                    max_cost_usd=cfg.get("max_cost", args.max_cost_usd),
                    smart_parse_cols=cfg.get("smart_parse", args.smart_parse),
                    emit_pipeline=cfg.get("emit_pipeline", args.emit_pipeline),
                    sink=cfg.get("sink", args.sink),
                    sink_if_exists=cfg.get("sink_if_exists", args.sink_if_exists),
                ): cfg["file"]
                for cfg in configs_to_run
            }
            for future in as_completed(futures):
                name = futures[future]
                try:
                    results.append(future.result())
                except Exception as e:
                    # One dataset must never kill the batch or discard the
                    # results its siblings already earned.
                    print(f"❌ {name}: crashed ({type(e).__name__}: {e})")
                    results.append({"file": name, "success": False, "attempts": 0,
                                    "usage": {"calls": 0, "prompt_tokens": 0,
                                              "completion_tokens": 0, "total_tokens": 0,
                                              "cost_usd": None},
                                    "budget_stopped": False,
                                    "error": f"crashed: {type(e).__name__}: {e}",
                                    "input_hash": None,
                                    "pipeline_path": None, "sink": None,
                                    "rows_in": 0, "rows_out": 0, "rows_dropped": 0})
    else:
        if not args.file or not args.rules:
            parser.error("--file and --rules are required, either directly or via --config")

        result = process_one(args.file, args.rules, args.retries, args.output, dry_run=args.dry_run, quiet=args.quiet, pagination=args.pagination, no_cache=args.no_cache, sample_rows=args.sample_rows, strict=args.strict, max_drop_fraction=args.max_drop, no_pre_clean=args.no_pre_clean, max_cost_usd=args.max_cost_usd, smart_parse_cols=args.smart_parse, emit_pipeline=args.emit_pipeline, sink=args.sink, sink_if_exists=args.sink_if_exists)
        results.append(result)

    print("\n=== SUMMARY ===")
    failed = summarize_results(results)
    inputs = "".join(sorted(f"{r['file']}:{r.get('error', '')}" for r in results))
    run_id = hashlib.md5(inputs.encode()).hexdigest()[:8] + "-" + uuid.uuid4().hex[:8]
    write_summary(results, run_id=run_id)

    if failed:
        with open("last_run_failures.txt", "w") as f:
            f.write("\n".join(failed))
    elif os.path.exists("last_run_failures.txt"):
        os.remove("last_run_failures.txt")  # clean up once things pass again
    return 1 if failed else 0


def summarize_results(results):
    """Print per-dataset lines; return failed files. dry_run (success None)
    reports SKIP and never counts as failure."""
    failed = []
    for r in results:
        if r["success"] is None:
            print(f"⏭ SKIP  {r['file']}  (dry-run, attempts: {r['attempts']})")
        elif r["success"]:
            extra = ""
            if "rows_in" in r:
                extra = f"  rows {r['rows_in']}→{r['rows_out']}"
            print(f"✅ PASS  {r['file']}  (attempts: {r['attempts']}){extra}")
        else:
            reason = f" — {r['error']}" if r.get("error") else ""
            print(f"❌ FAIL  {r['file']}  (attempts: {r['attempts']}){reason}")
            failed.append(r["file"])
    return failed


if __name__ == "__main__":
    sys.exit(main())
