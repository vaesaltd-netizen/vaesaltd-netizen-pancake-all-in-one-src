@echo off
chcp 65001 >nul 2>nul
title VAESA Extension All-in-One - Update
color 0B

echo ==========================================
echo   VAESA All-in-One Extension - Auto Update
echo   (CRM + Translator + Auto Inbox)
echo ==========================================
echo.
echo Dang tai ban moi nhat tu GitHub...

:: Tao thu muc tam
set "TEMP_DIR=%~dp0_update_temp"
set "ZIP_FILE=%TEMP_DIR%\latest.zip"
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

:: Tai zip tu GitHub
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/vaesaltd-netizen/pancake-all-in-one-dist/archive/refs/heads/main.zip' -OutFile '%ZIP_FILE%'"

if not exist "%ZIP_FILE%" (
    echo.
    echo [LOI] Khong tai duoc. Kiem tra ket noi mang!
    pause
    exit /b 1
)

echo Dang giai nen...

:: Giai nen
powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP_DIR%' -Force"

set "EXTRACTED=%TEMP_DIR%\pancake-all-in-one-dist-main"

if not exist "%EXTRACTED%" (
    echo.
    echo [LOI] Giai nen that bai!
    pause
    exit /b 1
)

echo Dang cap nhat...

:: === Root files ===
copy /y "%EXTRACTED%\manifest.json" "%~dp0manifest.json" >nul
copy /y "%EXTRACTED%\background.js" "%~dp0background.js" >nul

:: === Shared module (License) ===
if not exist "%~dp0shared" mkdir "%~dp0shared"
copy /y "%EXTRACTED%\shared\license.js" "%~dp0shared\license.js" >nul

:: === CRM module ===
if not exist "%~dp0crm" mkdir "%~dp0crm"
copy /y "%EXTRACTED%\crm\content.js" "%~dp0crm\content.js" >nul
copy /y "%EXTRACTED%\crm\content.css" "%~dp0crm\content.css" >nul
copy /y "%EXTRACTED%\crm\injected.js" "%~dp0crm\injected.js" >nul

:: === Translator module ===
if not exist "%~dp0translator\lib" mkdir "%~dp0translator\lib"
if not exist "%~dp0translator\content-scripts" mkdir "%~dp0translator\content-scripts"
if not exist "%~dp0translator\styles" mkdir "%~dp0translator\styles"

copy /y "%EXTRACTED%\translator\lib\license-service.js" "%~dp0translator\lib\license-service.js" >nul
copy /y "%EXTRACTED%\translator\lib\language-detector.js" "%~dp0translator\lib\language-detector.js" >nul
copy /y "%EXTRACTED%\translator\lib\language-worker-client.js" "%~dp0translator\lib\language-worker-client.js" >nul
copy /y "%EXTRACTED%\translator\lib\language-worker.js" "%~dp0translator\lib\language-worker.js" >nul
copy /y "%EXTRACTED%\translator\lib\openai-translator.js" "%~dp0translator\lib\openai-translator.js" >nul

copy /y "%EXTRACTED%\translator\content-scripts\inline-translator.js" "%~dp0translator\content-scripts\inline-translator.js" >nul
copy /y "%EXTRACTED%\translator\content-scripts\inline-toolbar.js" "%~dp0translator\content-scripts\inline-toolbar.js" >nul

copy /y "%EXTRACTED%\translator\styles\inline.css" "%~dp0translator\styles\inline.css" >nul

:: === Auto Inbox module ===
if not exist "%~dp0auto-inbox\js" mkdir "%~dp0auto-inbox\js"
if not exist "%~dp0auto-inbox\css" mkdir "%~dp0auto-inbox\css"
if not exist "%~dp0auto-inbox\icons" mkdir "%~dp0auto-inbox\icons"

copy /y "%EXTRACTED%\auto-inbox\js\*.js" "%~dp0auto-inbox\js\" >nul 2>nul
copy /y "%EXTRACTED%\auto-inbox\css\*.css" "%~dp0auto-inbox\css\" >nul 2>nul
copy /y "%EXTRACTED%\auto-inbox\icons\*" "%~dp0auto-inbox\icons\" >nul 2>nul
copy /y "%EXTRACTED%\auto-inbox\sidepanel.html" "%~dp0auto-inbox\sidepanel.html" >nul 2>nul
copy /y "%EXTRACTED%\auto-inbox\rules.json" "%~dp0auto-inbox\rules.json" >nul 2>nul

:: === Popup ===
if not exist "%~dp0popup" mkdir "%~dp0popup"
copy /y "%EXTRACTED%\popup\popup.html" "%~dp0popup\popup.html" >nul
copy /y "%EXTRACTED%\popup\popup.js" "%~dp0popup\popup.js" >nul
copy /y "%EXTRACTED%\popup\popup.css" "%~dp0popup\popup.css" >nul

:: === Icons ===
if not exist "%~dp0assets" mkdir "%~dp0assets"
copy /y "%EXTRACTED%\assets\*" "%~dp0assets\" >nul 2>nul

:: Don dep
rmdir /s /q "%TEMP_DIR%"

echo.
echo ==========================================
echo   CAP NHAT THANH CONG!
echo ==========================================
echo.
echo Buoc tiep theo:
echo   1. Mo Chrome -^> chrome://extensions
echo   2. Bam nut reload tren extension
echo   3. F5 lai trang Pancake va Facebook
echo.
pause
