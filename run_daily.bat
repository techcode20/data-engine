@echo off
rem Daily scheduled run: cleaning all --cadence daily configs, alert on failure.
rem NOTE: invoke via python.exe, not the data-engine.exe shim (Device Guard
rem blocks unsigned console-script .exes on some machines — same as pytest.exe).
cd /d "%~dp0"
if not exist logs mkdir logs
"%~dp0venv\Scripts\python.exe" engine.py --config-dir configs --cadence daily >> logs\daily_run.log 2>&1
if exist last_run_failures.txt (
    echo [%date% %time%] FAILURES detected: >> logs\daily_run.log 2>&1
    type last_run_failures.txt >> logs\daily_run.log 2>&1
    msg %username% "Data engine daily run failed - check logs\daily_run.log"
)
