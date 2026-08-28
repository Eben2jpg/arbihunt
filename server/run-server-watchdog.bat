@echo off
rem ArbiHunt server watchdog - auto-restarts if the server ever exits
title ArbiHunt Server (watchdog)
cd /d "%~dp0"
:loop
echo [%date% %time%] starting server...
node src\index.js >> "%~dp0server-live.log" 2>&1
echo [%date% %time%] server exited (code %errorlevel%), restarting in 3s... >> "%~dp0server-live.log"
timeout /t 3 /nobreak >nul
goto loop