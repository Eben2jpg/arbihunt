@echo off
rem Start ArbiHunt server + client in background windows
start "ArbiHunt Server" cmd /k "cd /d %~dp0server && npm run dev"
timeout /t 3 >nul
start "ArbiHunt Client" cmd /k "cd /d %~dp0client && npm run dev"
echo Both started. Server: http://localhost:4000  Client: http://localhost:5173