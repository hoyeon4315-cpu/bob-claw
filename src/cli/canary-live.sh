#!/usr/bin/env bash
# ┌──────────────────────────────────────┐
# │  BOB Claw — Canary Live Launcher     │
# │  Interactive single-trade executor   │
# └──────────────────────────────────────┘
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/data/deployed-contract.json"
EMERGENCY="$ROOT/data/emergency-stop.json"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  BOB Claw — Canary Live Trading 🔥  ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Emergency stop check
if [ -f "$EMERGENCY" ]; then
  IS_STOPPED=$(node -e "const d=JSON.parse(require('fs').readFileSync('$EMERGENCY','utf8'));console.log(d.stopped?'yes':'no')" 2>/dev/null || echo "no")
  if [ "$IS_STOPPED" = "yes" ]; then
    echo "🛑 Emergency stop is ACTIVE. Remove data/emergency-stop.json to proceed."
    exit 1
  fi
fi

# Load contract
if [ ! -f "$CONFIG" ]; then
  echo "❌ data/deployed-contract.json not found. Deploy the contract first."
  exit 1
fi
CONTRACT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).contractAddress)")
echo "📋 Contract: $CONTRACT"

# Load wallet address from contract config
OWNER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).owner || '')")
echo "👛 Owner:    $OWNER"
echo ""

# Prompt for private key (never displayed)
echo "MetaMask → ⋮ → 계정 세부정보 → 비공개 키 표시"
echo ""
read -s -p "프라이빗 키 입력 (표시되지 않음): " RAW_KEY
echo ""

# Normalize: add 0x prefix if missing
if [[ "$RAW_KEY" != 0x* ]]; then
  RAW_KEY="0x${RAW_KEY}"
fi

# Validate format: must be 66 chars (0x + 64 hex)
if [[ ${#RAW_KEY} -ne 66 ]]; then
  echo "❌ 키 길이 오류 (${#RAW_KEY}자). 64자리 hex + 0x 접두사 = 66자."
  exit 1
fi

if ! echo "$RAW_KEY" | grep -qE '^0x[0-9a-fA-F]{64}$'; then
  echo "❌ 유효하지 않은 hex 문자 포함."
  exit 1
fi

echo "✅ 키 형식 유효"
echo ""

# Confirm
echo "⚠️  CANARY MODE: $5/일 손실 한도, 3연속 실패 시 자동 중단"
echo "    단일 거래를 실행합니다. 실패 시 가스비만 소실 (~$0.004)"
echo ""
read -p "진행할까요? (y/N): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "취소됨."
  exit 0
fi

echo ""
echo "🔍 최적 아비 루트 탐색 중..."
echo ""

# Run single canary trade
PRIVATE_KEY="$RAW_KEY" node "$ROOT/src/cli/trigger-triangular-arb.mjs" \
  --live --once \
  --contract "$CONTRACT" \
  --capital 1000 \
  --min-profit 0.10

echo ""
echo "╔══════════════════════════════════════╗"
echo "║         Canary 완료                  ║"
echo "╠══════════════════════════════════════╣"
echo "  결과는 위 출력 및 Telegram 확인"
echo "  로그: data/trigger-triangular-log.jsonl"
echo "╚══════════════════════════════════════╝"
