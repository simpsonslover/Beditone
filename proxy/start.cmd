@echo off
cd /d "%~dp0"
if not exist "..\node_modules" (
  echo installing dep
  pushd ..
  call npm install
  popd
)
if not exist "node_modules" (
  echo installing dep x2
  call npm install --allow-git=all
)
call node build.mjs
if errorlevel 1 goto :end
set "SERVER=%*"
if "%SERVER%"=="" set /p "SERVER=Enter the address of the server you want to connect to:  "
node dist\proxy.mjs %SERVER%
:end
pause
