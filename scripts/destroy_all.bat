@echo off
setlocal
echo =======================================================================
echo [Quota Pay] Initiating Full Infrastructure Teardown...
echo =======================================================================

cd /d "%~dp0\.."
python scripts\destroy_all.py %*

echo.
echo [Quota Pay] Complete. Spend is $0.00/hr.
exit /b 0
