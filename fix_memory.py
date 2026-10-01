import json
import os
import re
import threading
from datetime import datetime, timedelta

LOG_PATH = "fix_log.jsonl"
MAX_STORED_ENTRIES = 500  # hard cap on log file growth; oldest entries are dropped on write
DEFAULT_MAX_AGE_DAYS = 90  # fixes older than this are not fed back into prompts
DEFAULT_PER_SIGNATURE = 2  # newest fixes kept per distinct error signature

_lock = threading.Lock()  # batch mode shares this file across worker threads


def _restrict(path):
    """Owner-only permissions: error text may contain data shapes + context."""
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _error_signature(error: str) -> str:
    """Normalize an error into a short grouping key (first line, numbers masked)."""
    text = str(error).strip()
    first_line = text.splitlines()[0] if text else "unknown"
    first_line = re.sub(r"\d+", "#", first_line)
    return first_line[:160]


def _parse_ts(ts):
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def load_past_fixes(limit: int = 10, max_age_days: int = DEFAULT_MAX_AGE_DAYS,
                    per_signature: int = DEFAULT_PER_SIGNATURE) -> list[dict]:
    """Return recent, deduplicated fix log entries, oldest first.

    Entries older than ``max_age_days`` are expired, and at most
    ``per_signature`` newest entries are kept per distinct error signature,
    so prompts stay lean and stop repeating stale advice.
    """
    if not os.path.exists(LOG_PATH):
        return []
    entries = []
    with open(LOG_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue
    if max_age_days is not None:
        cutoff = datetime.now() - timedelta(days=max_age_days)
        entries = [e for e in entries
                   if (_parse_ts(e.get("timestamp")) or datetime.now()) >= cutoff]
    # Newest first, keep the newest `per_signature` per error signature.
    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    seen: dict[str, int] = {}
    kept = []
    for e in entries:
        sig = _error_signature(e.get("error", ""))
        if seen.get(sig, 0) >= per_signature:
            continue
        seen[sig] = seen.get(sig, 0) + 1
        kept.append(e)
    # Return oldest-first (newest last), capped at `limit`.
    kept.sort(key=lambda e: e.get("timestamp", ""))
    return kept[-limit:]


def format_fixes_for_prompt(entries: list[dict], max_fix_chars: int = 600) -> str:
    if not entries:
        return "No prior fixes recorded yet."
    blocks = []
    for e in entries:
        fix = e.get("fix", "")
        if len(fix) > max_fix_chars:
            fix = fix[:max_fix_chars] + "\n... [truncated]"
        blocks.append(
            f"Problem: {str(e.get('error', ''))[:300]}\nFix applied:\n{fix}"
        )
    return "\n\n---\n\n".join(blocks)


def log_fix(dataset_name, attempt_num, error, fixed_code):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "dataset": dataset_name,
        "attempt": attempt_num,
        "error": str(error)[:1000],
        "fix": fixed_code,
    }
    with _lock:
        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")
        _restrict(LOG_PATH)
        _enforce_cap_locked()


def _enforce_cap():
    """Keep the log file from growing without bound."""
    with _lock:
        _enforce_cap_locked()


def _enforce_cap_locked():
    """Caller must hold _lock (log_fix already does)."""
    try:
        with open(LOG_PATH, "r") as f:
            lines = [ln for ln in f if ln.strip()]
    except OSError:
        return
    if len(lines) > MAX_STORED_ENTRIES:
        with open(LOG_PATH, "w") as f:
            f.writelines(lines[-MAX_STORED_ENTRIES:])


def prune_fix_log(max_age_days: int = DEFAULT_MAX_AGE_DAYS) -> int:
    """Drop expired entries from the log file. Returns number of entries removed."""
    if not os.path.exists(LOG_PATH):
        return 0
    cutoff = datetime.now() - timedelta(days=max_age_days)
    kept = []
    with open(LOG_PATH, "r") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if (_parse_ts(e.get("timestamp")) or datetime.now()) >= cutoff:
                kept.append(line if line.endswith("\n") else line + "\n")
    removed = sum(1 for _ in open(LOG_PATH) if _.strip()) - len(kept)
    with open(LOG_PATH, "w") as f:
        f.writelines(kept)
    _restrict(LOG_PATH)
    return removed
