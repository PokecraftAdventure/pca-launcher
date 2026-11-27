@echo off
rem Arranca el launcher en modo desarrollo (no necesita PowerShell ni PATH propio).
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs"
set NODE_ENV=dev
if not exist "node_modules\electron\dist\electron.exe" (
    echo Falta Electron. Ejecuta: node node_modules\electron\install.js
    pause
    exit /b 1
)
"node_modules\electron\dist\electron.exe" .
if errorlevel 1 pause
