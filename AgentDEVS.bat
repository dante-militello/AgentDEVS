@echo off
setlocal
title AgentDEVS
cd /d "%~dp0"

set "PORT=4317"
set "URL=http://localhost:%PORT%"

rem Already running? Just open the browser.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  echo AgentDEVS ya esta corriendo. Abriendo %URL% ...
  start "" "%URL%"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No encontre Node.js. Instalalo desde https://nodejs.org ^(v24 o superior^).
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias ^(solo la primera vez^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo npm install.
    pause
    exit /b 1
  )
)

echo Compilando la interfaz...
call npm run build >nul
if errorlevel 1 (
  echo [ERROR] Fallo la compilacion de la web. Corre "npm run build" para ver el detalle.
  pause
  exit /b 1
)

rem Open the browser as soon as the server answers (in the background).
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing '%URL%/api/session' -TimeoutSec 1 | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo.
echo  AgentDEVS en %URL%
echo  Cerrar esta ventana apaga el servidor ^(tus sesiones se restauran al volver a abrirlo^).
echo.
call npm start
