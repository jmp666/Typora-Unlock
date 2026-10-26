@echo off
setlocal enabledelayedexpansion
rem ==========================================================
rem  Uninstall-TyporaUnlock.cmd  -  restore original app.asar
rem
rem  Usage:
rem    Uninstall-TyporaUnlock.cmd                  auto-detect
rem    Uninstall-TyporaUnlock.cmd "D:\Apps\Typora" specify install root
rem ==========================================================
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
  echo [ERROR] Typora not found. Pass the install root explicitly:
  echo           %~nx0 "C:\Program Files\Typora"
  echo.
  pause
  exit /b 1
)

if /i "%ROOT:~-10%"=="\resources" set "ROOT=%ROOT:~0,-10%"
set "DST=%ROOT%\resources"

echo [*] resources : %DST%

if not exist "%DST%\app.asar.orig" (
  echo [ERROR] Backup not found: "%DST%\app.asar.orig"
  echo         Nothing to restore.
  pause
  exit /b 1
)

net session >nul 2>&1
if errorlevel 1 (
  echo [*] Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList @('%ROOT%') -Verb RunAs"
  exit /b
)

copy /y "%DST%\app.asar.orig" "%DST%\app.asar" >nul
if errorlevel 1 (
  echo [ERROR] Failed to restore app.asar
  pause
  exit /b 1
)
if exist "%DST%\app" rmdir /s /q "%DST%\app"
del /q "%DST%\app.asar.orig" 2>nul

echo [OK] Restored original app.asar
echo      Backup file removed.
pause
exit /b 0

rem ---------- helper ----------
:probe
if defined ROOT goto :eof
set "CAND=%~1"
if /i "%CAND:~-10%"=="\resources" set "CAND=%CAND:~0,-10%"
if exist "%CAND%\resources\app.asar.orig" (
  set "ROOT=%CAND%"
  echo     found: !ROOT!
)
goto :eof