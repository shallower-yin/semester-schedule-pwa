@echo off
title Supabase Direct Connectivity Test
cd /d "%~dp0"

echo Turn off the proxy before running this test.
echo Enter a label such as: home-direct, mobile-direct, campus-direct
set /p NETWORK_LABEL=Network label:

node "scripts\test-supabase-connectivity.mjs" "%NETWORK_LABEL%" > "supabase-connectivity-result.txt" 2>&1
set TEST_EXIT=%ERRORLEVEL%

echo.
type "supabase-connectivity-result.txt"
echo.

if "%TEST_EXIT%"=="0" (
  echo RESULT: PASS
) else (
  echo RESULT: FAIL
)

echo Result saved to supabase-connectivity-result.txt
echo You can now turn the proxy back on and send that file to Codex.
pause
exit /b %TEST_EXIT%
