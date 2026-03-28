@echo off
TITLE Motor de IA - Orbita Clinica LOS
COLOR 0B

echo ======================================================================
echo   ORBITA CLINICA - MOTOR DE IA: ESTANCIA PREDICTIVA (LOS)
echo   Iniciando sistema de analisis...
echo ======================================================================

:: 1. Posicionarse en la carpeta del script y subir un nivel
cd /d "%~dp0"
cd ..

:: 2. Intentar activar entorno virtual de forma directa (sin IF para evitar errores de parentesis)
echo [STATUS] Cargando dependencias...
call ".venv\Scripts\activate.bat" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Usando entorno de sistema global.
)

:: 3. Asegurar librerias minimas
pip install -q fastapi uvicorn pandas numpy joblib openpyxl python-multipart

:: 4. Lanzar servidor
echo [SUCCESS] Servidor IA habilitado en Puerto 8001.
echo Presione CTRL+C para detener.
python -m uvicorn prediccion.scripts.api_clinica:app --host 0.0.0.0 --port 8001 --reload --log-level info

pause
