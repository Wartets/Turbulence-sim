@echo off
title Turbulence Sim Launcher
cd /d "%~dp0"

if exist "%USERPROFILE%\emsdk\emsdk_env.bat" (
    call "%USERPROFILE%\emsdk\emsdk_env.bat" >nul
) else (
    echo [ERROR] Could not find emsdk_env.bat at %USERPROFILE%\emsdk\
    echo Please check your installation path.
    pause
    exit /b
)

tasklist /FI "WINDOWTITLE eq TurbulenceServer" 2>NUL | find /I /N "python.exe">NUL
if "%ERRORLEVEL%"=="1" (
    start "TurbulenceServer" python -m http.server 8000
)

start http://localhost:8000/web/

:COMPILATION
cls
echo [2/4] Compiling C++ code...
call emcc src/engine.cpp -O3 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME="createFluidEngine" --bind -o web/engine.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [FAILURE] Compilation Error!
) else (
    echo      Compilation Successful.
)

for %%f in (src\engine.cpp) do set LAST_TIMESTAMP=%%~tf

echo.
echo ======================================================
echo   Server running in background.
echo   Watching src/engine.cpp for changes...
echo ======================================================

:WATCH_LOOP
timeout /t 2 /nobreak >nul
for %%f in (src\engine.cpp) do set CURRENT_TIMESTAMP=%%~tf
if not "%LAST_TIMESTAMP%"=="%CURRENT_TIMESTAMP%" (
    echo.
    echo [DETECTED] Change in engine.cpp.
    echo Press any key to recompile...
    pause >nul
    goto COMPILATION
)
goto WATCH_LOOP