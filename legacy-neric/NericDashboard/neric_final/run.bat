@echo off
:: ══════════════════════════════════════════════════════
::  NERIC v3 — Start Script (Windows)
::  Jalankan: klik dua kali run.bat
:: ══════════════════════════════════════════════════════

title NERIC v3 Startup
color 0A

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  NERIC v3 — Multi-Intersection Dashboard          ║
echo  ║  IRaX Competition  ^|  Windows Startup             ║
echo  ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ── Check best.pt ──────────────────────────────────────
if exist "cv-backend\best.pt" (
    echo   [OK] best.pt ditemukan - YOLOv8 aktif
) else (
    echo   [WARN] best.pt tidak ada di cv-backend\
    echo   [WARN] CV Backend berjalan dalam SIMULATION MODE
)

:: ── CV Backend ─────────────────────────────────────────
echo.
echo  [1/3] Setting up Python CV Backend...
cd cv-backend
if not exist "venv" (
    echo   Creating virtualenv...
    python -m venv venv
)
call venv\Scripts\activate.bat
pip install -r requirements.txt -q
echo   [OK] Backend dependencies ready
start "NERIC CV Backend" cmd /k "venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
call venv\Scripts\deactivate.bat
cd ..

:: ── Frontend ───────────────────────────────────────────
echo.
echo  [2/3] Setting up React Frontend...
cd frontend
if not exist "node_modules" (
    echo   Installing npm packages (pertama kali ~30 detik)...
    npm install
)
echo   [OK] npm packages ready
start "NERIC Frontend" cmd /k "npm run dev"
cd ..

:: ── Done ───────────────────────────────────────────────
echo.
echo  ════════════════════════════════════════════════════
echo   NERIC v3 berjalan!
echo.
echo   Dashboard  : http://localhost:5173
echo   CV Backend : http://localhost:8001
echo   API Docs   : http://localhost:8001/docs
echo  ════════════════════════════════════════════════════
echo.
echo   Dua window CMD sudah terbuka untuk masing-masing server.
echo   Tutup window tersebut untuk menghentikan server.
echo.
pause
