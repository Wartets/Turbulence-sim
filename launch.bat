@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Turbulence Simulation Dev Environment
color 0B

:: ==============================================================================
:: CONFIGURATION
:: ==============================================================================
set "SRC_DIR=src"
set "OUT_DIR=web"
set "SOURCE_FILE=%SRC_DIR%\engine.cpp"
set "OUTPUT_FILE=%OUT_DIR%\engine.js"
set "PORT=8005"
set "SERVER_LOG=server_log.txt"

:: ==============================================================================
:: ENVIRONMENT CHECKS
:: ==============================================================================

:BANNER
cls
echo.
echo  ==============================================================================
echo   TURBULENCE FLUID ENGINE - DEVELOPMENT CONSOLE
echo  ==============================================================================
echo.
echo  [*] Checking Environment...

:: 1. CHECK PYTHON
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto ERR_PYTHON
echo  [OK] Python found.

:: 2. CHECK EMSCRIPTEN
if exist "%USERPROFILE%\emsdk\emsdk_env.bat" (
    set "EMSDK_PATH=%USERPROFILE%\emsdk\emsdk_env.bat"
) else if exist "C:\emsdk\emsdk_env.bat" (
    set "EMSDK_PATH=C:\emsdk\emsdk_env.bat"
) else (
    goto ERR_EMSDK
)

call :PROGRESS_BAR "Loading Emscripten SDK"
call "%EMSDK_PATH%" >nul
if %ERRORLEVEL% NEQ 0 goto ERR_EMSDK_LOAD
echo  [OK] EMSDK Environment Loaded.

:: Verify emcc is available
where emcc >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto ERR_EMCC_NOT_FOUND
echo  [OK] emcc command found.

set "EMCC_FLAGS=-O3 -std=c++17 -msimd128 -pthread -s SHARED_MEMORY=1 -s MODULARIZE=1 -s EXPORT_NAME=createFluidEngine -s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web,worker --bind -Wno-pthreads-mem-growth"
echo  [OK] Emscripten configuration set.

:: 3. DIRECTORY SETUP
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if not exist "%SRC_DIR%" goto ERR_SRC

:: ==============================================================================
:: ASSET MANAGEMENT
:: ==============================================================================
echo  [*] Preparing web assets...
copy /Y index.html "%OUT_DIR%\" >nul
copy /Y style.css "%OUT_DIR%\" >nul
copy /Y main.js "%OUT_DIR%\" >nul
copy /Y renderer.js "%OUT_DIR%\" >nul
copy /Y shaders.js "%OUT_DIR%\" >nul
echo  [OK] All web assets copied to '%OUT_DIR%' directory.

:: ==============================================================================
:: SERVER MANAGEMENT
:: ==============================================================================

echo  [*] Configuring High-Performance Server...

taskkill /F /FI "WINDOWTITLE eq TurbulenceServer" /T >nul 2>&1

(
echo import http.server
echo import socketserver
echo import sys
echo import os
echo PORT = int(sys.argv[1])
echo WEB_DIR = sys.argv[2]
echo os.chdir(WEB_DIR)
echo class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
echo     daemon_threads = True
echo     allow_reuse_address = True
echo class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
echo     def end_headers(self):
echo         self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
echo         self.send_header('Pragma', 'no-cache')
echo         self.send_header('Expires', '0')
echo         self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
echo         self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
echo         super().end_headers()
echo if __name__ == '__main__':
echo     socketserver.TCPServer.allow_reuse_address = True
echo     with ThreadedHTTPServer(("", PORT), COOPCOEPHandler) as httpd:
echo         print(f"Serving '{WEB_DIR}' on port {PORT} with Multi-threaded Optimization")
echo         httpd.serve_forever()
) > server_optimized.py

echo  [..] Starting Optimized Server on Port %PORT%...
start "TurbulenceServer" /b python server_optimized.py %PORT% %OUT_DIR% > "%SERVER_LOG%" 2>&1
echo  [OK] Server started (Threaded/No-Cache). Logs at: %SERVER_LOG%

:: ==============================================================================
:: BUILD LOOP
:: ==============================================================================

:BUILD_START
cls
echo.
echo  ==============================================================================
echo   COMPILATION PHASE (%TIME%)
echo  ==============================================================================
echo.

call :PROGRESS_BAR "Compiling C++ to WebAssembly"

set "START_TIME=%TIME%"
emcc %EMCC_FLAGS% "%SOURCE_FILE%" -o "%OUTPUT_FILE%" >nul 2>&1

if %ERRORLEVEL% NEQ 0 goto BUILD_FAIL

call :SUCCESS "Build Complete!"
echo      Time: %START_TIME% - %TIME%

if not defined BROWSER_LAUNCHED (
    echo  [..] Opening Browser...
    start http://localhost:%PORT%/
    set "BROWSER_LAUNCHED=YES"
)

goto WATCH_MODE

:BUILD_FAIL
call :ERROR "Compilation Failed!"
echo      Check the console output above for C++ errors.
call :BEEP
goto WATCH_MODE

:: ==============================================================================
:: WATCH MODE
:: ==============================================================================

:WATCH_MODE
echo.
echo  ==============================================================================
echo   WATCH MODE ACTIVE
echo  ==============================================================================
echo   [i] Watching: %SOURCE_FILE%
echo   [i] Server:   http://localhost:%PORT%/
echo   [i] Log:      %SERVER_LOG%
echo   [i] Press Ctrl+C to exit.
echo.

for %%f in ("%SOURCE_FILE%") do set LAST_TIMESTAMP=%%~tf

:WATCH_LOOP
timeout /t 1 /nobreak >nul
for %%f in ("%SOURCE_FILE%") do set CURRENT_TIMESTAMP=%%~tf

if not "!LAST_TIMESTAMP!"=="!CURRENT_TIMESTAMP!" (
    echo.
    echo  [!] Change detected at %TIME%. Recompiling...
    set "LAST_TIMESTAMP=!CURRENT_TIMESTAMP!"
    goto BUILD_START
)

goto WATCH_LOOP

exit /b

:: ==============================================================================
:: ERROR HANDLERS
:: ==============================================================================

:ERR_PYTHON
call :ERROR "Python is not installed or not in PATH."
echo      Please install Python 3.x.
pause
exit /b

:ERR_EMSDK
call :ERROR "EMSDK not found."
echo      Checked: %USERPROFILE%\emsdk\emsdk_env.bat
echo      Checked: C:\emsdk\emsdk_env.bat
echo      Please install Emscripten or edit this batch file with your path.
pause
exit /b

:ERR_EMSDK_LOAD
call :ERROR "Failed to load EMSDK environment."
pause
exit /b

:ERR_EMCC_NOT_FOUND
call :ERROR "emcc command not found in PATH after loading SDK."
echo      Your Emscripten installation might be corrupt or not activated.
echo      Try running 'emsdk install latest' and 'emsdk activate latest' from the emsdk directory.
pause
exit /b

:ERR_SRC
call :ERROR "Source directory '%SRC_DIR%' not found."
pause
exit /b

:: ==============================================================================
:: UTILITY FUNCTIONS
:: ==============================================================================

:PROGRESS_BAR
set "MSG=%~1"
<nul set /p "=[..] %MSG% "
for /L %%i in (1,1,10) do (
    <nul set /p "=."
    ping localhost -n 1 -w 30 >nul
)
echo  [OK]
exit /b

:ERROR
color 0C
echo.
echo  [X] ERROR: %~1
echo.
exit /b

:SUCCESS
color 0A
echo.
echo  [V] SUCCESS: %~1
echo.
exit /b

:BEEP
rundll32 user32.dll,MessageBeep
exit /b