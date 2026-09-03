@echo off
setlocal
cd /d "%~dp0"
npm run smoke:auto -- %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Session Guard auto test did not complete. See the message above or .csg-smoke\bootstrap.log.
)
exit /b %EXIT_CODE%
