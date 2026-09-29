import argparse
import json
import sys
from collections import defaultdict

try:
    # Windows consoles default to cp1252, where emoji (🚨) crashes printing.
    # Force UTF-8 so alerts render-or-replace instead of raising.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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

def last_run_spend(history):
    """(tokens, cost_usd_or_None, failures) for the most recent run entry."""
    if not history:
        return 0, None, []
    results = history[-1]["results"]
    tokens = sum(r.get("usage", {}).get("total_tokens", 0) for r in results)
    costs = [r.get("usage", {}).get("cost_usd") for r in results]
    cost = sum(c for c in costs if c is not None) if any(c is not None for c in costs) else None
    failures = [r["file"] for r in results if not r["success"]]
    return tokens, cost, failures

def print_report(stats):
    print(f"{'Dataset':<25} {'Runs':<6} {'Pass Rate':<12} {'Avg Attempts':<12} {'Tokens':<10}")
    print("-" * 65)
    for dataset, s in sorted(stats.items()):
        pass_rate = f"{(s['passes'] / s['runs']) * 100:.0f}%" if s["runs"] else "n/a"
        avg_attempts = f"{s['total_attempts'] / s['runs']:.1f}" if s["runs"] else "n/a"
        print(f"{dataset:<25} {s['runs']:<6} {pass_rate:<12} {avg_attempts:<12} {s['total_tokens']:<10}")

def check_alerts(history, max_cost_usd=None, max_tokens=None, on_failure=False) -> list[str]:
    """Breach messages for the latest run. Only requested checks fire. Empty = quiet."""
    alerts = []
    tokens, cost, failures = last_run_spend(history)
    if on_failure and failures:
        alerts.append(f"{len(failures)} dataset(s) FAILED: {', '.join(failures)}")
    if max_tokens is not None and tokens > max_tokens:
        alerts.append(f"token spend {tokens} exceeded cap {max_tokens}")
    if max_cost_usd is not None:
        if cost is None:
            alerts.append("cost cap set but no cost data (configure GEMINI_PRICE_* rates)")
        elif cost > max_cost_usd:
            alerts.append(f"estimated cost ${cost:.4f} exceeded cap ${max_cost_usd:.4f}")
    return alerts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run-history trends and spend alerts")
    parser.add_argument("--alert-cost-above", type=float, default=None,
                        help="Exit 2 with an alert if the latest run's est. cost exceeds this USD")
    parser.add_argument("--alert-tokens-above", type=int, default=None,
                        help="Exit 2 with an alert if the latest run's tokens exceed this")
    parser.add_argument("--alert-on-failure", action="store_true",
                        help="Exit 2 with an alert if the latest run had any failures")
    args = parser.parse_args()

    history = load_history()
    if not history:
        print("No run history found yet — run engine.py a few times first.")
    else:
        stats = summarize_by_dataset(history)
        print_report(stats)

    alerts = check_alerts(history, max_cost_usd=args.alert_cost_above,
                          max_tokens=args.alert_tokens_above,
                          on_failure=args.alert_on_failure)
    for a in alerts:
        print(f"🚨 ALERT: {a}")
    if alerts:
        raise SystemExit(2)