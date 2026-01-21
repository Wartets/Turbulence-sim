@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Turbulence Simulation Dev Environment
color 0B
cls

:: ==============================================================================
:: CONFIGURATION
:: ==============================================================================
set "SRC_DIR=src"
set "OUT_DIR=web"
set "SOURCE_FILE=%SRC_DIR%\engine.cpp"
set "OUTPUT_FILE=%OUT_DIR%\engine.js"
set "PORT=8005"
set "SERVER_LOG=server_log.txt"
set "EMCC_FLAGS=-O3 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME=createFluidEngine --bind"

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
:: Logic moved outside of parentheses to prevent batch crashes
if exist "%USERPROFILE%\emsdk\emsdk_env.bat" goto FOUND_EMSDK
if exist "C:\emsdk\emsdk_env.bat" (
    set "EMSDK_PATH=C:\emsdk\emsdk_env.bat"
    goto SETUP_EMSDK
)

:: If we get here, EMSDK is missing
goto ERR_EMSDK

:FOUND_EMSDK
set "EMSDK_PATH=%USERPROFILE%\emsdk\emsdk_env.bat"

:SETUP_EMSDK
call :PROGRESS_BAR "Loading Emscripten SDK"
call "%EMSDK_PATH%" >nul
if %ERRORLEVEL% NEQ 0 goto ERR_EMSDK_LOAD
echo  [OK] EMSDK Environment Loaded.

:: 3. DIRECTORY SETUP
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if not exist "%SRC_DIR%" goto ERR_SRC

:: ==============================================================================
:: SERVER MANAGEMENT
:: ==============================================================================

echo  [*] Configuring High-Performance Server...

taskkill /F /FI "WINDOWTITLE eq TurbulenceServer" /T >nul 2>&1

echo import http.server > server_optimized.py
echo import socketserver >> server_optimized.py
echo import sys >> server_optimized.py
echo PORT = int(sys.argv[1]) >> server_optimized.py
echo class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer): >> server_optimized.py
echo     daemon_threads = True >> server_optimized.py
echo     allow_reuse_address = True >> server_optimized.py
echo class NoCacheHandler(http.server.SimpleHTTPRequestHandler): >> server_optimized.py
echo     def end_headers(self): >> server_optimized.py
echo         self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0') >> server_optimized.py
echo         self.send_header('Pragma', 'no-cache') >> server_optimized.py
echo         self.send_header('Expires', '0') >> server_optimized.py
echo         super().end_headers() >> server_optimized.py
echo if __name__ == '__main__': >> server_optimized.py
echo     socketserver.TCPServer.allow_reuse_address = True >> server_optimized.py
echo     with ThreadedHTTPServer(("", PORT), NoCacheHandler) as httpd: >> server_optimized.py
echo         print(f"Serving on port {PORT} with Multi-threaded Optimization") >> server_optimized.py
echo         httpd.serve_forever() >> server_optimized.py

echo  [..] Starting Optimized Server on Port %PORT%...
start "TurbulenceServer" /b python server_optimized.py %PORT% > "%SERVER_LOG%" 2>&1
echo  [OK] Server started (Threaded/No-Cache). Logs at: %SERVER_LOG%

:: ==============================================================================
:: BUILD LOOP
:: ==============================================================================

:BUILD_START
echo.
echo  ==============================================================================
echo   COMPILATION PHASE
echo  ==============================================================================
echo.

call :PROGRESS_BAR "Compiling C++ to WebAssembly"

set "START_TIME=%TIME%"
call emcc "%SOURCE_FILE%" %EMCC_FLAGS% -o "%OUTPUT_FILE%"

if %ERRORLEVEL% NEQ 0 goto BUILD_FAIL

call :SUCCESS "Build Complete!"
echo      Time: %START_TIME% - %TIME%

:: Launch Browser Only Once
if not defined BROWSER_LAUNCHED (
    echo  [..] Opening Browser...
    start http://localhost:%PORT%/%OUT_DIR%/
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
echo   [i] Server:   http://localhost:%PORT%/%OUT_DIR%/
echo   [i] Log:      %SERVER_LOG%
echo   [i] Press Ctrl+C to exit.
echo.

for %%f in ("%SOURCE_FILE%") do set LAST_TIMESTAMP=%%~tf

:WATCH_LOOP
timeout /t 1 /nobreak >nul
for %%f in ("%SOURCE_FILE%") do set CURRENT_TIMESTAMP=%%~tf

if not "!LAST_TIMESTAMP!"=="!CURRENT_TIMESTAMP!" (
    echo.
    echo  [!] Change detected. Recompiling...
    set "LAST_TIMESTAMP=!CURRENT_TIMESTAMP!"
    goto BUILD_START
)

goto WATCH_LOOP

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