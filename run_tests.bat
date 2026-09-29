@echo off
echo Running test suite...
rem NOTE: do NOT call bare `pytest` / pytest.exe here — the .exe console-script
rem shim is blocked by Device Guard. `python -m pytest` runs the same suite
rem via python.exe, which is allowed.
"%~dp0venv\Scripts\python.exe" -m pytest -v
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo TESTS FAILED - do not trust the pipeline until this is fixed.
    exit /b 1
) else (
    echo.
    echo All tests passed.
)