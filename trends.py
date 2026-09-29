import json
from collections import defaultdict

SUMMARY_PATH = "run_summary.json"

def load_history():
    try:
        with open(SUMMARY_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def summarize_by_dataset(history):
    stats = defaultdict(lambda: {"runs": 0, "passes": 0, "total_attempts": 0, "total_tokens": 0})
    for run in history:
        for result in run["results"]:
            s = stats[result["file"]]
            s["runs"] += 1
            s["passes"] += 1 if result["success"] else 0
            s["total_attempts"] += result["attempts"]
            s["total_tokens"] += result.get("usage", {}).get("total_tokens", 0)
    return stats

def print_report(stats):
    print(f"{'Dataset':<25} {'Runs':<6} {'Pass Rate':<12} {'Avg Attempts':<12} {'Tokens':<10}")
    print("-" * 65)
    for dataset, s in sorted(stats.items()):
        pass_rate = f"{(s['passes'] / s['runs']) * 100:.0f}%" if s["runs"] else "n/a"
        avg_attempts = f"{s['total_attempts'] / s['runs']:.1f}" if s["runs"] else "n/a"
        print(f"{dataset:<25} {s['runs']:<6} {pass_rate:<12} {avg_attempts:<12} {s['total_tokens']:<10}")

if __name__ == "__main__":
    history = load_history()
    if not history:
        print("No run history found yet — run engine.py a few times first.")
    else:
        stats = summarize_by_dataset(history)
        print_report(stats)