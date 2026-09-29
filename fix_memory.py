import json
import os

LOG_PATH = "fix_log.jsonl"

def load_past_fixes(limit: int = 10) -> list[dict]:
    """Return the most recent fix log entries, newest last."""
    if not os.path.exists(LOG_PATH):
        return []
    entries = []
    with open(LOG_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries[-limit:]

def format_fixes_for_prompt(entries: list[dict]) -> str:
    if not entries:
        return "No prior fixes recorded yet."
    blocks = []
    for e in entries:
        blocks.append(
            f"Problem: {e['error'][:300]}\nFix applied:\n{e['fix']}"
        )
    return "\n\n---\n\n".join(blocks)
from datetime import datetime

def log_fix(dataset_name, attempt_num, error, fixed_code):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "dataset": dataset_name,
        "attempt": attempt_num,
        "error": str(error)[:1000],
        "fix": fixed_code,
    }
    with open(LOG_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")