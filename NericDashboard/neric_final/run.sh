#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════
#  NERIC v3 — Start Script (Linux / macOS)
#  Jalankan: chmod +x run.sh && ./run.sh
# ══════════════════════════════════════════════════════════
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ok()     { echo -e "${GREEN}  ✔  $1${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠  $1${NC}"; }
err()    { echo -e "${RED}  ✘  $1${NC}"; }

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║  NERIC v3 — Multi-Intersection Dashboard          ║"
echo "║  IRaX Competition · Automated Startup             ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Check prerequisites ────────────────────────────────────
header "Checking prerequisites"
command -v python3 >/dev/null 2>&1 && ok "Python3 found" || { err "Python3 not found. Install from python.org"; exit 1; }
command -v node    >/dev/null 2>&1 && ok "Node.js found" || { err "Node.js not found. Install from nodejs.org"; exit 1; }
command -v npm     >/dev/null 2>&1 && ok "npm found"     || { err "npm not found"; exit 1; }

# ── Check best.pt ──────────────────────────────────────────
header "Checking YOLO model"
if [ -f "$ROOT/cv-backend/best.pt" ]; then
  ok "best.pt found → YOLOv8 inference aktif"
else
  warn "best.pt tidak ditemukan di cv-backend/"
  warn "CV Backend akan berjalan dalam SIMULATION MODE"
  warn "Untuk aktifkan YOLO: cp /path/to/best.pt $ROOT/cv-backend/"
fi

# ── Python Backend ─────────────────────────────────────────
header "Starting CV Backend (port 8001)"
cd "$ROOT/cv-backend"
if [ ! -d "venv" ]; then
  echo "  Creating virtualenv..."
  python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt -q --no-warn-script-location
ok "Dependencies installed"
uvicorn main:app --host 0.0.0.0 --port 8001 --reload --log-level warning &
CV_PID=$!
deactivate
ok "CV Backend started (PID $CV_PID)"

# ── Frontend ───────────────────────────────────────────────
header "Starting React Frontend (port 5173)"
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  echo "  Installing npm packages (first time ~30s)..."
  npm install --silent
fi
ok "npm packages ready"
npm run dev &
FE_PID=$!
ok "Frontend started (PID $FE_PID)"

# ── Summary ────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅  NERIC v3 berjalan!${NC}"
echo ""
echo -e "  Dashboard  : ${CYAN}http://localhost:5173${NC}"
echo -e "  CV Backend : ${CYAN}http://localhost:8001${NC}"
echo -e "  API Docs   : ${CYAN}http://localhost:8001/docs${NC}"
echo ""
echo -e "${YELLOW}  Tekan Ctrl+C untuk menghentikan semua server.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Keep running until Ctrl+C
cleanup() {
  echo -e "\n${YELLOW}Shutting down servers...${NC}"
  kill $CV_PID $FE_PID 2>/dev/null
  echo -e "${GREEN}Done.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM
wait
