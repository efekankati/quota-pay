@echo off
setlocal

set "GIT_BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "GIT_BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined GIT_BASH if exist "%ProgramFiles%\Git\usr\bin\bash.exe" set "GIT_BASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not defined GIT_BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "GIT_BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined GIT_BASH if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "GIT_BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"

if not defined GIT_BASH (
    echo ERROR: Git Bash was not found ^(avoiding Windows WSL bash.exe^). >&2
    echo Run Python directly instead: >&2
    echo   python e2e\five_phone_android_e2e.py --guests ^<N^> [--headless-guests ^| --show-all-windows] >&2
    exit /b 1
)

"%GIT_BASH%" "%~dp0run_android_e2e.sh" %*
exit /b %ERRORLEVEL%
