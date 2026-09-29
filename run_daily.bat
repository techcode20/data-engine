@echo off
cd /d C:\Users\lenovo\data-engine
call venv\Scripts\activate.bat
data-engine --config-dir configs --cadence daily >> logs\daily_run.log 2>&1
if exist last_run_failures.txt (
    msg %username% "Data engine run failed - check logs\daily_run.log"
)