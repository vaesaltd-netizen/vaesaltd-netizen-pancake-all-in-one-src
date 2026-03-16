@echo off
chcp 65001 >nul
title VAESA Extension - Build (Obfuscate)
color 0E

echo ==========================================
echo   VAESA Extension - Build Tool
echo ==========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Chua cai Node.js!
    echo Tai tai: https://nodejs.org/
    pause
    exit /b 1
)

:: Auto-install javascript-obfuscator if needed
if not exist "%~dp0node_modules\javascript-obfuscator" (
    echo Dang cai dat javascript-obfuscator...
    cd /d "%~dp0"
    npm init -y >nul 2>nul
    npm install javascript-obfuscator --save-dev
    echo.
)

:: Run build
echo Dang build (obfuscate source code)...
echo.
node "%~dp0build.js"

if %errorlevel% neq 0 (
    echo.
    echo [LOI] Build that bai!
    pause
    exit /b 1
)

:: Auto-push dist to public repo
echo.
echo Dang day ban obfuscated len GitHub (dist repo)...
cd /d "%~dp0dist"

:: Init git if needed
if not exist ".git" (
    git init
    git branch -M main
    git remote add origin https://github.com/vaesaltd-netizen/pancake-all-in-one-dist.git
    git config user.name "vaesaltd-netizen"
    git config user.email "vaesaltd-netizen@users.noreply.github.com"
)

git add -A
git commit -m "Update dist: %date% %time:~0,5%"
git push -u origin main

cd /d "%~dp0"

:: Auto-push src to private repo
echo.
echo Dang day source code len GitHub (src repo)...

:: Init git if needed
if not exist ".git" (
    git init
    git branch -M main
    git remote add origin https://github.com/vaesaltd-netizen/vaesaltd-netizen-pancake-all-in-one-src.git
    git config user.name "vaesaltd-netizen"
    git config user.email "vaesaltd-netizen@users.noreply.github.com"
)

git add -A
git commit -m "Update src: %date% %time:~0,5%"
git push -u origin main

echo.
echo ==========================================
echo   BUILD + PUSH THANH CONG!
echo   (Da push ca dist va src)
echo ==========================================
echo.
echo Nhan phim bat ky de dong...
pause >nul
