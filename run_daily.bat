@echo off
rem Daily scheduled run: cleaning all --cadence daily configs, alert on failure.
rem NOTE: invoke via python.exe, not the data-engine.exe shim (Device Guard
rem blocks unsigned console-script .exes on some machines — same as pytest.exe).
cd /d "%~dp0"
if not exist logs mkdir logs
set LOG=logs\daily_run.log
if not defined DAILY_MAX_TOKENS set DAILY_MAX_TOKENS=100000
"%~dp0venv\Scripts\python.exe" engine.py --config-dir configs --cadence daily >> %LOG% 2>&1
set FAILED=0
if exist last_run_failures.txt set FAILED=1
"%~dp0venv\Scripts\python.exe" trends.py --alert-on-failure --alert-tokens-above %DAILY_MAX_TOKENS% >> %LOG% 2>&1
if %ERRORLEVEL% NEQ 0 set FAILED=1
if defined DAILY_MAX_COST "%~dp0venv\Scripts\python.exe" trends.py --alert-cost-above %DAILY_MAX_COST% >> %LOG% 2>&1
if %ERRORLEVEL% NEQ 0 set FAILED=1
if %FAILED% NEQ 0 (
    echo [%date% %time%] daily run needs attention >> %LOG% 2>&1
    msg %username% "Data engine daily run failed - check logs\daily_run.log"
)
