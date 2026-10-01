import json
import hashlib
import os
import threading

CACHE_PATH = "schema_cache.json"
_lock = threading.Lock()  # batch mode shares this file across worker threads

def _is_url(path):
    return isinstance(path, str) and path.lower().startswith(("http://", "https://"))


def _file_hash(path):
    # URLs aren't local files — hash the URL string instead of opening it.
    # (Windows raises OSError: [Errno 22] Invalid argument for such paths.)
    if _is_url(path):
        return hashlib.md5(path.encode("utf-8")).hexdigest()
    try:
        with open(path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except (OSError, FileNotFoundError):
        # Missing/unreadable file: hash the path string so caching still works
        # instead of crashing the whole run.
        return hashlib.md5(str(path).encode("utf-8")).hexdigest()


def _load_cache():
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        with open(CACHE_PATH, "r") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Corrupt/unreadable cache — start fresh rather than crash.
        return {}


def _cache_key(file_path, rules, content_fingerprint=None):
    # A caller-supplied fingerprint (e.g. hash of fetched API content) takes
    # precedence: URL addresses alone go stale when the remote data changes.
    content_hash = content_fingerprint or _file_hash(file_path)
    return f"{file_path}:{rules}:{content_hash}"

def get_cached_schema(file_path, rules, content_fingerprint=None):
    cache = _load_cache()
    if not cache:
        return None
    key = _cache_key(file_path, rules, content_fingerprint)
    return cache.get(key)

def set_cached_schema(file_path, rules, schema_json, content_fingerprint=None):
    with _lock:
        cache = _load_cache()
        key = _cache_key(file_path, rules, content_fingerprint)
        cache[key] = schema_json
        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
        try:
            os.chmod(CACHE_PATH, 0o600)
        except OSError:
            pass