@echo off
chcp 65001 >nul
title VAESA Extension - Build
echo Building extension...
node "%~dp0build.js"
if %errorlevel% neq 0 (echo BUILD FAILED & pause & exit /b 1)
echo.
echo BUILD COMPLETE! Reload dist/ in Chrome.
pause
