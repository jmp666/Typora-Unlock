@echo off
setlocal enabledelayedexpansion
rem ==========================================================
rem  Install-TyporaUnlock.cmd
rem  Patch Typora to bypass license UI (requires admin)
rem
rem  Usage:
rem    Install-TyporaUnlock.cmd                  auto-detect install path
rem    Install-TyporaUnlock.cmd "D:\Apps\Typora" specify install root
rem    (the "resources" suffix is added automatically)
rem ==========================================================
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"

rem ---------- locate Typora ----------
set "ROOT="
if not "%~1"=="" (
  set "ROOT=%~1"
) else (
  echo [*] Auto-detecting Typora installation...
  call :probe "C:\Program Files\Typora"
  if not defined ROOT call :probe "C:\Program Files (x86)\Typora"
  if not defined ROOT call :probe "%LOCALAPPDATA%\Programs\Typora"
  if not defined ROOT call :probe "%LOCALAPPDATA%\Typora"
  if not defined ROOT call :probe "%APPDATA%\Typora"
  if not defined ROOT call :probe "D:\Program Files\Typora"
  if not defined ROOT call :probe "D:\Typora"
  if not defined ROOT call :probe "E:\Typora"
  if not defined ROOT call :probe "C:\Typora"
)

if not defined ROOT (
  echo.
  echo [ERROR] Typora not found in common locations.
  echo         Please pass the install root explicitly:
  echo.
  echo           %~nx0 "C:\Program Files\Typora"
  echo           %~nx0 "D:\Apps\Typora"
  echo.
  pause
  exit /b 1
)

rem normalize: accept either root or root\resources
if /i "%ROOT:~-10%"=="\resources" set "ROOT=%ROOT:~0,-10%"
set "DST=%ROOT%\resources"

echo [*] Typora root: %ROOT%
if not exist "%DST%\app.asar" (
  echo [ERROR] Missing "%DST%\app.asar"
  echo         This does not look like a Typora installation.
  pause
  exit /b 1
)
echo [*] resources : %DST%

rem ---------- admin check ----------
net session >nul 2>&1
if errorlevel 1 (
  echo [*] Requesting administrator privileges...
  set "ELEV=1"
) else (
  set "ELEV=0"
)

if "%ELEV%"=="1" (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList @('%ROOT%') -Verb RunAs"
  exit /b
)

rem ---------- node check ----------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo         Install from https://nodejs.org and retry.
  pause
  exit /b 1
)

rem ---------- 1. backup ----------
echo [1/5] Backing up app.asar ...
if not exist "%DST%\app.asar.orig" (
  copy /y "%DST%\app.asar" "%DST%\app.asar.orig" >nul
) else (
  echo       backup already exists, skipped
)

rem ---------- 2. extract ----------
echo [2/5] Extracting app.asar ...
if exist "%DST%\app" rmdir /s /q "%DST%\app"
node "%SRC%\asar.js" "%DST%\app.asar.orig" "%DST%\app"
if errorlevel 1 goto :fail

rem ---------- 3. install unlock.js ----------
echo [3/5] Installing unlock.js ...
copy /y "%SRC%\unlock.js" "%DST%\app\unlock.js" >nul
if errorlevel 1 goto :fail

rem ---------- 4. switch entry ----------
echo [4/5] Switching entry point to unlock.js ...
powershell -NoProfile -Command "$p='%DST%\app\package.json'; $j=Get-Content $p -Raw | ConvertFrom-Json; $j.main='unlock.js'; $j | ConvertTo-Json -Depth 10 | Set-Content $p -Encoding UTF8"
if errorlevel 1 goto :fail

rem ---------- 5. repack ----------
echo [5/5] Repacking app.asar ...
del /q "%DST%\app.asar" 2>nul
node "%SRC%\asar_pack_noint.js" "%DST%\app" "%DST%\app.asar"
if errorlevel 1 goto :fail

echo.
echo [OK] Done. Launch Typora to verify:
echo        - no "Activate Typora" dialog
echo        - no "UNREGISTERED" badge at bottom-left
echo.
echo      Log     : %%APPDATA%%\Typora\unlock.log
echo      Rollback: Uninstall-TyporaUnlock.cmd "%ROOT%"
echo.
pause
exit /b 0

rem ---------- helper: probe one candidate ----------
:probe
if defined ROOT goto :eof
set "CAND=%~1"
if /i "%CAND:~-10%"=="\resources" set "CAND=%CAND:~0,-10%"
if exist "%CAND%\resources\app.asar" (
  set "ROOT=%CAND%"
  echo     found: !ROOT!
)
goto :eof

:fail
echo.
echo [ERROR] Installation failed. See messages above.
pause
exit /b 1