import json
import os
from datetime import datetime

SUMMARY_PATH = "run_summary.json"

def write_summary(results: list[dict], run_id: str | None = None):
    entry = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(),
        "results": results,
    }
    history = []
    try:
        with open(SUMMARY_PATH, "r") as f:
            history = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        history = []
    history.append(entry)
    with open(SUMMARY_PATH, "w") as f:
        json.dump(history, f, indent=2)
    try:
        os.chmod(SUMMARY_PATH, 0o600)
    except OSError:
        pass