@echo off
set "MIMO_EXE=%~dp0..\..\tools\mimocode-0.1.14\mimo.exe"
if not exist "%MIMO_EXE%" (
  echo MiMo Code is not installed under desktop\tools.
  pause
  exit /b 1
)
"%MIMO_EXE%" auth login --provider xiaomi
pause
