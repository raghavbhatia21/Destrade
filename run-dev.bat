@echo off
TITLE Destrade Pro - Local Dev
echo.
echo   \x1b[32m[DESTRADE PRO]\x1b[0m Starting Local Development Environment...
echo.
:: Check for node
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo   \x1b[31m[ERROR]\x1b[0m Node.js is not installed or not in PATH.
    echo   Please install Node.js to run the local proxy.
    pause
    exit
)

:: Start Proxy in a new minimized window
start /min "Destrade Proxy" node dev-proxy.js

:: Open index.html
echo   \x1b[34m[INFO]\x1b[0m Launching Dashboard...
start "" "http://localhost:8080/index.html"

echo.
echo   \x1b[33m[SUCCESS]\x1b[0m Destrade Pro is now running locally.
echo   Keep this window open to maintain the API connection.
echo.
pause
