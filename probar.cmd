@echo off
setlocal DisableDelayedExpansion
set "result=2"
set "testFile=%~f1"

node --version >nul 2>&1
if errorlevel 1 goto missing_node
if not exist "%~dp0dist\cli.js" goto missing_build
if defined testFile goto run
if exist "%~dp0httpi.yaml" goto project

echo Running the public remote demo. Internet is required.
echo Its write requests are simulated and use fictitious data.
set "testFile=%~dp0examples\remotas\httpi.yaml"
goto run

:project
set "testFile=%~dp0httpi.yaml"

:run
node "%~dp0dist\cli.js" run "%testFile%" --show-response
set "result=%errorlevel%"
echo.
if "%result%"=="0" goto passed
if "%result%"=="1" goto failed
if "%result%"=="2" goto invalid
if "%result%"=="3" goto connection
echo UNEXPECTED ERROR - see the output above.
goto finish

:passed
echo ALL TESTS PASSED - see the per-request results above.
goto finish

:failed
echo TESTS FAILED - one or more checks failed. See the results above.
goto finish

:invalid
echo COULD NOT RUN - check the file, variables and configuration above.
goto finish

:connection
echo CONNECTION OR AUTHENTICATION ERROR - see the results above.
goto finish

:missing_node
echo COULD NOT RUN - install Node.js 22 or later and reopen this window.
goto finish

:missing_build
echo COULD NOT RUN - build Tsyce first:
echo Open a terminal in the Tsyce folder and run npm.cmd run build

:finish
echo.
if not "%HTTPI_NO_PAUSE%"=="1" pause
exit /b %result%
