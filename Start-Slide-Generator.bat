@echo off
setlocal
cd /d "%~dp0"
title Slide Generator

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.11 or newer, then run this file again.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found.
    echo Install Node.js 18 or newer, then run this file again.
    echo The application includes its PowerPoint libraries, so no npm install is required.
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do (
    if %%V LSS 18 (
        echo Node.js 18 or newer is required. Your version is:
        node --version
        echo.
        pause
        exit /b 1
    )
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating the local Python environment...
    python -m venv --system-site-packages .venv
    if errorlevel 1 (
        echo Could not create the local Python environment.
        pause
        exit /b 1
    )
)

set "PYTHON=.venv\Scripts\python.exe"
%PYTHON% -c "import fastapi, uvicorn, openpyxl, multipart, pydantic" >nul 2>nul
if errorlevel 1 (
    echo Installing required Python packages...
    %PYTHON% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo Package installation failed. Connect to your normal package source and try again.
        pause
        exit /b 1
    )
)

for /f %%P in ('%PYTHON% -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1]); s.close()"') do set "PORT=%%P"
if not defined PORT (
    echo Could not select a local application port.
    pause
    exit /b 1
)

echo Starting Slide Generator at http://127.0.0.1:%PORT%
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%'"
%PYTHON% -m uvicorn app.server:app --host 127.0.0.1 --port %PORT%

if errorlevel 1 (
    echo.
    echo Slide Generator stopped because of an error.
    pause
)
endlocal
