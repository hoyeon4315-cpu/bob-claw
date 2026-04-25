#!/usr/bin/env bash
# ┌──────────────────────────────────────┐
# │  BOB Claw — 자동 캐너리 실행기       │
# │  기회 발견까지 대기 → 자동 실행      │
# └──────────────────────────────────────┘
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/data/deployed-contract.json"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  BOB Claw — Auto Canary 🔥          ║"
echo "║  기회 발견 시 자동 실행             ║"
echo "╚══════════════════════════════════════╝"
echo ""

CONTRACT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).contractAddress)")
echo "📋 Contract: $CONTRACT"

read -s -p "프라이빗 키 입력: " PK
echo ""
if [[ "$PK" != 0x* ]]; then PK="0x${PK}"; fi
if [[ ${#PK} -ne 66 ]]; then
  echo "❌ 키 길이 오류"; exit 1
fi
echo "✅ 키 유효 — 기회 탐색 시작 (Ctrl+C로 중단)"
echo ""

# Loop: scan → execute when profitable
export PRIVATE_KEY="$PK"
while true; do
  node "$ROOT/src/cli/trigger-triangular-arb.mjs" \
    --live --once \
    --contract="$CONTRACT" \
    --capital=1000 \
    --min-profit=0.10

  echo ""
  echo "⏳ 60초 후 다시 스캔..."
  sleep 60
done
