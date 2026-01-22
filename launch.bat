@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Turbulence Simulation Dev Environment

:: ==============================================================================
:: CONFIGURATION
:: ==============================================================================
set "SRC_DIR=src"
set "OUT_DIR=web"
set "TEMP_BUILD_DIR=temp_build"
set "LOG_DIR=logs"
set "SOURCE_FILE=%SRC_DIR%\engine.cpp"
set "OUTPUT_FILE=%OUT_DIR%\engine.js"
set "PORT=8005"
set "SERVER_SCRIPT=server.py"

:: ==============================================================================
:: INITIALIZATION & CLEANUP
:: ==============================================================================
:: Create directories and clean old logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
del /q "%LOG_DIR%\*" >nul 2>&1

if not exist "%TEMP_BUILD_DIR%" mkdir "%TEMP_BUILD_DIR%"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

:: ==============================================================================
:: GENERATE PYTHON SERVER
:: ==============================================================================
(
echo import http.server
echo import socketserver
echo import sys
echo import os
echo PORT = int(sys.argv[1]^)
echo class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer^):
echo     daemon_threads = True
echo     allow_reuse_address = True
echo class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler^):
echo     def end_headers(self^):
echo         self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'^)
echo         self.send_header('Pragma', 'no-cache'^)
echo         self.send_header('Expires', '0'^)
echo         self.send_header('Cross-Origin-Opener-Policy', 'same-origin'^)
echo         self.send_header('Cross-Origin-Embedder-Policy', 'require-corp'^)
echo         super(^).end_headers(^)
echo if __name__ == '__main__':
echo     if len(sys.argv^) ^> 2:
echo         os.chdir(sys.argv[2]^)
echo     socketserver.TCPServer.allow_reuse_address = True
echo     with ThreadedHTTPServer(("", PORT^), COOPCOEPHandler^) as httpd:
echo         print(f"Serving on port {PORT} with Multi-threaded Optimization"^)
echo         httpd.serve_forever(^)
) > "%SERVER_SCRIPT%"

:: ==============================================================================
:: ENVIRONMENT CHECKS
:: ==============================================================================
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Python not found.
    pause
    exit /b
)

if exist "%USERPROFILE%\emsdk\emsdk_env.bat" (
    set "EMSDK_PATH=%USERPROFILE%\emsdk\emsdk_env.bat"
) else if exist "C:\emsdk\emsdk_env.bat" (
    set "EMSDK_PATH=C:\emsdk\emsdk_env.bat"
) else (
    color 0C
    echo [ERROR] EMSDK not found.
    pause
    exit /b
)

call "%EMSDK_PATH%" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Failed to load EMSDK.
    pause
    exit /b
)

set "EMCC_FLAGS=-O3 -std=c++17 -msimd128 -pthread -s SHARED_MEMORY=1 -s MODULARIZE=1 -s EXPORT_NAME=createFluidEngine -s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web,worker --bind -Wno-pthreads-mem-growth"

:: ==============================================================================
:: SERVER START
:: ==============================================================================
taskkill /F /FI "WINDOWTITLE eq TurbulenceServer" /T >nul 2>&1
start "TurbulenceServer" /b python "%SERVER_SCRIPT%" %PORT% "%OUT_DIR%" > "%LOG_DIR%\server_stdout.log" 2> "%LOG_DIR%\server_stderr.log"

:: ==============================================================================
:: BUILD LOOP
:: ==============================================================================
:BUILD_START
cls
color 0E
echo ==========================================
echo  COMPILING... (%TIME%)
echo  (This may take a few seconds)
echo ==========================================

:: Copy static assets
copy /Y index.html "%OUT_DIR%\" >nul
copy /Y style.css "%OUT_DIR%\" >nul
copy /Y main.js "%OUT_DIR%\" >nul
copy /Y renderer.js "%OUT_DIR%\" >nul
copy /Y shaders.js "%OUT_DIR%\" >nul

:: Compile to TEMP folder first
set "TEMP_OUT=%TEMP_BUILD_DIR%\engine.js"
if exist "%TEMP_OUT%" del "%TEMP_OUT%"

:: Generate temp batch for compilation command to handle complexity
echo emcc %EMCC_FLAGS% "%SOURCE_FILE%" -o "%TEMP_OUT%" > build_step.bat

:: Execute using PowerShell to allow Tee-Object (Shows output in console AND saves to file)
powershell -Command ".\build_step.bat 2>&1 | Tee-Object -FilePath '%LOG_DIR%\compile.log'"

del build_step.bat

:: Check success by looking for output file (reliable method)
if not exist "%TEMP_OUT%" (
    color 0C
    echo.
    echo [FAIL] Compilation Failed! See output above or logs/compile.log
    goto WATCH_MODE
)

:: Atomic Move to Web Folder (Avoids "File Used By Process" errors)
move /Y "%TEMP_BUILD_DIR%\engine.js" "%OUT_DIR%\engine.js" >nul 2>&1
move /Y "%TEMP_BUILD_DIR%\engine.wasm" "%OUT_DIR%\engine.wasm" >nul 2>&1
if exist "%TEMP_BUILD_DIR%\engine.worker.js" move /Y "%TEMP_BUILD_DIR%\engine.worker.js" "%OUT_DIR%\engine.worker.js" >nul 2>&1

color 0A
echo [OK] Build Success.

if not defined BROWSER_LAUNCHED (
    start http://localhost:%PORT%/
    set "BROWSER_LAUNCHED=YES"
)

:: ==============================================================================
:: WATCH MODE
:: ==============================================================================
:WATCH_MODE
:: Check for file changes in source directory
for %%f in ("%SRC_DIR%\*") do set "CURRENT_STATE=!CURRENT_STATE!%%~tf"
if not defined LAST_STATE set "LAST_STATE=!CURRENT_STATE!"

if not "!LAST_STATE!"=="!CURRENT_STATE!" (
    set "LAST_STATE=!CURRENT_STATE!"
    set "CURRENT_STATE="
    goto BUILD_START
)

set "CURRENT_STATE="
timeout /t 1 /nobreak >nul
goto WATCH_MODE