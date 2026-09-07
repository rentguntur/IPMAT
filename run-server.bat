@echo off
echo Starting IPMAT site server...
echo.
echo Once it starts, open your browser to: http://localhost:5500
echo Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
npx --yes serve -l 5500 .
