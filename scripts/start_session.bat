@echo off
setlocal
cd /d "%~dp0\.."
python scripts\session_guard.py %*
