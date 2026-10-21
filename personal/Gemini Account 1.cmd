@echo off
setlocal
title Gemini - Account 1
node "%~dp0AntigravityCli.mjs" --account 1 -- %*
set "GEMINI_LAUNCH_EXIT=%ERRORLEVEL%"
if not "%GEMINI_LAUNCH_EXIT%"=="0" pause
exit /b %GEMINI_LAUNCH_EXIT%
