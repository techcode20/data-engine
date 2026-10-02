"""Static dashboard: renders run history + fix memory into dashboard.html.

Usage:  python dashboard.py [--out dashboard.html]
No dependencies beyond the standard library. Open the HTML file in a browser.
"""
import argparse
import html
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))


def load_json(name, default):
    try:
        with open(os.path.join(HERE, name), "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def load_fix_log(limit=15):
    path = os.path.join(HERE, "fix_log.jsonl")
    entries = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except ValueError:
                        continue
    except FileNotFoundError:
        pass
    return entries[-limit:]


def esc(v):
    return html.escape(str(v), quote=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "dashboard.html"))
    args = ap.parse_args()

    history = load_json("run_summary.json", [])
    fixes = load_fix_log()

    executed = [x for r in history for x in r.get("results", []) if x.get("success") is not None]
    total_results = len(executed)
    passes = sum(1 for x in executed if x.get("success"))
    total_tokens = sum(x.get("usage", {}).get("total_tokens", 0) for x in executed)
    pass_rate = (passes / total_results * 100) if total_results else 0

    per_ds = {}
    for run in history:
        for x in run.get("results", []):
            if x.get("success") is None:
                continue  # dry-run SKIP: never executed, never a failure
            s = per_ds.setdefault(x["file"], {"runs": 0, "pass": 0, "att": 0, "tok": 0, "fail": 0})
            s["runs"] += 1
            s["pass"] += 1 if x.get("success") else 0
            s["fail"] += 0 if x.get("success") else 1
            s["att"] += x.get("attempts", 0)
            s["tok"] += x.get("usage", {}).get("total_tokens", 0)

    max_runs = max([s["runs"] for s in per_ds.values()] or [1])
    ds_rows = []
    for name, s in sorted(per_ds.items()):
        rate = s["pass"] / s["runs"] * 100
        color = "#2da44e" if rate == 100 else ("#bf8700" if rate >= 80 else "#cf222e")
        bar = int(s["runs"] / max_runs * 100)
        ds_rows.append(
            f"<tr><td>{esc(name)}</td><td>{s['runs']}</td>"
            f"<td><span class='pill' style='background:{color}'>{rate:.0f}%</span></td>"
            f"<td>{s['att'] / s['runs']:.1f}</td><td>{s['tok']}</td><td>{s['fail']}</td>"
            f"<td><div class='bar' style='width:{bar}%'></div></td></tr>")

    run_rows = []
    for run in reversed(history[-12:]):
        for x in run.get("results", []):
            badge = "✅" if x.get("success") else ("⏭" if x.get("success") is None else "❌")
            tok = x.get("usage", {}).get("total_tokens", 0)
            run_rows.append(
                f"<tr><td>{esc(run.get('timestamp', ''))}</td><td>{esc(x.get('file', ''))}</td>"
                f"<td>{badge}</td><td>{x.get('attempts', '')}</td><td>{tok}</td></tr>")

    fix_rows = []
    for e in reversed(fixes):
        err = esc(str(e.get("error", ""))[:220])
        fix_rows.append(
            f"<tr><td>{esc(e.get('timestamp', ''))}</td><td>{esc(e.get('dataset', ''))}</td>"
            f"<td>try {esc(e.get('attempt', ''))}</td><td class='mono'>{err}</td></tr>")

    page = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data Engine Dashboard</title>
<style>
body{{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:24px;color:#1f2328;background:#fff}}
h1{{margin-bottom:4px}} .sub{{color:#57606a;margin-top:0}}
.cards{{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}}
.card{{border:1px solid #d0d7de;border-radius:8px;padding:12px 18px;min-width:140px;background:#f6f8fa}}
.card b{{font-size:24px;display:block}}
table{{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}}
th,td{{border:1px solid #d0d7de;padding:6px 10px;text-align:left}}
th{{background:#f6f8fa}} .mono{{font-family:Consolas,monospace;font-size:12px;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.pill{{color:#fff;border-radius:10px;padding:2px 10px;font-size:12px}}
.bar{{height:10px;background:#0969da;border-radius:4px}}
h2{{margin-top:28px}}
</style></head><body>
<h1>🔧 Data Engine Dashboard</h1>
<p class="sub">Generated from run_summary.json + fix_log.jsonl — rerun <code>python dashboard.py</code> to refresh.</p>
<div class="cards">
<div class="card"><b>{total_results}</b>datasets cleaned</div>
<div class="card"><b>{pass_rate:.1f}%</b>pass rate</div>
<div class="card"><b>{total_tokens}</b>LLM tokens</div>
<div class="card"><b>{len(history)}</b>runs logged</div>
<div class="card"><b>{len(fixes)}</b>recent fixes shown</div>
</div>
<h2>Datasets</h2>
<table><tr><th>Dataset</th><th>Runs</th><th>Pass</th><th>Avg tries</th><th>Tokens</th><th>Fails</th><th>Volume</th></tr>
{''.join(ds_rows) or '<tr><td colspan="7">No history yet — run engine.py first.</td></tr>'}</table>
<h2>Latest runs</h2>
<table><tr><th>Time</th><th>Dataset</th><th>OK</th><th>Tries</th><th>Tokens</th></tr>
{''.join(run_rows) or '<tr><td colspan="5">None yet.</td></tr>'}</table>
<h2>Recent self-corrections</h2>
<table><tr><th>Time</th><th>Dataset</th><th>Try</th><th>Error</th></tr>
{''.join(fix_rows) or '<tr><td colspan="4">None yet.</td></tr>'}</table>
</body></html>"""

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"Wrote {args.out} ({total_results} results, {len(history)} runs)")


if __name__ == "__main__":
    main()
