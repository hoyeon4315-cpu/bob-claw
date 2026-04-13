#!/bin/bash
# Fix minProfitUsdc on deployed contract (was set to wrong value during deploy)
# Usage: bash src/cli/fix-min-profit.sh
set -e
cd "$(dirname "$0")/../.."

CAST="$HOME/.foundry/bin/cast"
RPC="https://mainnet.base.org"
CONTRACT="0xA16601ac5026FEda2DC2b087d50Dd133f48dfD09"
MIN_PROFIT="300000"  # 0.30 USDC (6 decimals)

echo "╔═══════════════════════════════════════╗"
echo "║   Fix minProfitUsdc on Contract       ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Contract: $CONTRACT"
echo "New minProfitUsdc: $MIN_PROFIT (= \$0.30 USDC)"
echo ""

# Check current value
CURRENT=$($CAST call $CONTRACT "minProfitUsdc()(uint256)" --rpc-url $RPC 2>&1)
echo "Current value: $CURRENT"
echo ""

read -s -p "프라이빗 키 입력: " PK
echo ""

# Auto-fix 0x
if [[ ! "$PK" == 0x* ]]; then
  PK="0x${PK}"
fi

echo ""
echo "🔧 Sending setMinProfit($MIN_PROFIT)..."
RESULT=$($CAST send $CONTRACT "setMinProfit(uint256)" $MIN_PROFIT \
  --rpc-url $RPC \
  --private-key "$PK" 2>&1)

echo "$RESULT"

# Verify
echo ""
echo "🔍 Verifying..."
NEW_VAL=$($CAST call $CONTRACT "minProfitUsdc()(uint256)" --rpc-url $RPC 2>&1)
echo "New minProfitUsdc: $NEW_VAL"

if [ "$NEW_VAL" = "$MIN_PROFIT" ]; then
  echo "✅ Fixed!"
else
  echo "❌ Value mismatch. Expected $MIN_PROFIT, got $NEW_VAL"
fi
