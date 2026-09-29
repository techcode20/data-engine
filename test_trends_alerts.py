from trends import check_alerts, last_run_spend


def _history():
    return [
        {"timestamp": "2026-01-01T00:00:00", "results": [
            {"file": "a.csv", "success": True, "attempts": 1,
             "usage": {"calls": 2, "prompt_tokens": 1000, "completion_tokens": 200,
                       "total_tokens": 1200, "cost_usd": 0.005}},
            {"file": "b.csv", "success": False, "attempts": 3,
             "usage": {"calls": 4, "prompt_tokens": 3000, "completion_tokens": 600,
                       "total_tokens": 3600, "cost_usd": 0.015}},
        ]},
        {"timestamp": "2026-01-02T00:00:00", "results": [
            {"file": "a.csv", "success": True, "attempts": 1,
             "usage": {"calls": 1, "prompt_tokens": 500, "completion_tokens": 100,
                       "total_tokens": 600, "cost_usd": 0.002}},
        ]},
    ]


def test_last_run_spend_reads_latest_entry_only():
    tokens, cost, failures = last_run_spend(_history())
    assert tokens == 600
    assert cost == 0.002
    assert failures == []


def test_last_run_spend_handles_missing_usage():
    history = [{"timestamp": "t", "results": [{"file": "x", "success": True, "attempts": 1}]}]
    assert last_run_spend(history) == (0, None, [])


def test_last_run_spend_empty_history():
    assert last_run_spend([]) == (0, None, [])


def test_no_flags_means_quiet():
    assert check_alerts(_history()) == []


def test_failure_alert_lists_files():
    history = [{"timestamp": "t", "results": [
        {"file": "a.csv", "success": False, "attempts": 2},
        {"file": "b.csv", "success": True, "attempts": 1}]}]
    alerts = check_alerts(history, on_failure=True)
    assert len(alerts) == 1 and "a.csv" in alerts[0]
    assert check_alerts(history) == []


def test_token_cap_breach_and_pass():
    assert check_alerts(_history(), max_tokens=599) != []
    assert check_alerts(_history(), max_tokens=600) == []


def test_cost_cap_breach_and_pass():
    assert check_alerts(_history(), max_cost_usd=0.001) != []
    assert check_alerts(_history(), max_cost_usd=0.002) == []


def test_cost_cap_without_data_warns():
    history = [{"timestamp": "t", "results": [{"file": "x", "success": True, "attempts": 1}]}]
    alerts = check_alerts(history, max_cost_usd=1.0)
    assert any("no cost data" in a for a in alerts)
