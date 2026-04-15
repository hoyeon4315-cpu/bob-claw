#!/usr/bin/env bash
# ┌──────────────────────────────────────┐
# │  minProfitUsdc → $0.10 으로 변경     │
# └──────────────────────────────────────┘
set -euo pipefail

CONTRACT="0xA16601ac5026FEda2DC2b087d50Dd133f48dfD09"
RPC="https://mainnet.base.org"
NEW_MIN=100000  # $0.10 (6 decimals)

echo "╔══════════════════════════════════════╗"
echo "║  minProfitUsdc 변경: \$0.30 → \$0.10  ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "이렇게 하면 \$0.10 이상 수익 거래 모두 실행 가능"
echo ""

read -s -p "프라이빗 키 입력: " PK
echo ""

if [[ "$PK" != 0x* ]]; then PK="0x${PK}"; fi

CAST_BIN="$(which cast 2>/dev/null || echo "$HOME/.foundry/bin/cast")"

echo "🔧 setMinProfit(${NEW_MIN}) 호출 중..."
$CAST_BIN send "$CONTRACT" "setMinProfit(uint256)" "$NEW_MIN" \
  --rpc-url "$RPC" --private-key "$PK" 2>&1 | grep -v "private"

echo ""
echo "✅ 확인 중..."
RESULT=$($CAST_BIN call "$CONTRACT" "minProfitUsdc()(uint256)" --rpc-url "$RPC")
echo "   minProfitUsdc = $RESULT ($(echo "$RESULT / 1000000" | bc -l | head -c 6) USDC)"
echo ""
echo "완료! 이제 \$0.10+ 수익 거래 실행 가능합니다."
