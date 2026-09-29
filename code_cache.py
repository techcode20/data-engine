"""Cache of known-good clean() functions, keyed by schema+rules hash.

When an identical schema+rules pair was solved before, the cached code is
reused with zero LLM calls — execution + validation still run, so a stale
entry can never silently pass: on failure the engine falls back to fresh
generation exactly once.
"""
import hashlib
import json
import os

CODE_CACHE_PATH = "code_cache.json"


def _cache_key(schema_json: str, rules: str) -> str:
    schema_hash = hashlib.md5(schema_json.encode("utf-8")).hexdigest()
    rules_hash = hashlib.md5(rules.encode("utf-8")).hexdigest()
    return f"{schema_hash}:{rules_hash}"


def _load_cache():
    if not os.path.exists(CODE_CACHE_PATH):
        return {}
    try:
        with open(CODE_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get_cached_code(schema_json: str, rules: str) -> str | None:
    return _load_cache().get(_cache_key(schema_json, rules))


def set_cached_code(schema_json: str, rules: str, code: str):
    cache = _load_cache()
    cache[_cache_key(schema_json, rules)] = code
    with open(CODE_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
