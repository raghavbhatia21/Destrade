@echo off
echo =======================================================
echo     Destrade Pro — GitHub Setup & Push Helper
echo =======================================================
echo.
set /p REPO_URL="Enter your GitHub Repository URL (e.g. https://github.com/username/destrade.git): "

if "%REPO_URL%"=="" (
    echo [ERROR] No URL provided. Exiting.
    pause
    exit /b
)

echo.
echo [1/4] Initializing Git...
git init

echo.
echo [2/4] Staging files...
git add .

echo.
echo [3/4] Committing code...
git commit -m "Initialize Destrade Pro with Autonomous Cloud Market Cron"

echo.
echo [4/4] Setting main branch & remote repository...
git branch -M main
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo.
echo Pushing to GitHub...
git push -u origin main

echo.
echo =======================================================
echo SUCCESS! Your project & Market Cron are pushed to GitHub!
echo GitHub Actions will now run every 5 mins during trading hours.
echo =======================================================
pause
