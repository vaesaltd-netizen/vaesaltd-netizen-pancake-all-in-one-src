@echo off
chcp 65001 >nul
title VAESA Extension - Build Groq Test
echo Building Groq test version...
node "%~dp0build-groq.js"
if %errorlevel% neq 0 (echo BUILD FAILED & pause & exit /b 1)
echo.
echo BUILD COMPLETE! Load dist-groq/ in Chrome to test.
pause
