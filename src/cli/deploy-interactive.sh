#!/bin/bash
# BOB Claw — Interactive Deploy Helper
# 프라이빗 키 형식을 자동 보정하고 배포합니다
set -e
cd "$(dirname "$0")/../.."

echo "╔══════════════════════════════════════╗"
echo "║   BOB Claw — 컨트랙트 배포 도우미   ║"
echo "╚══════════════════════════════════════╝"
echo ""

FORGE="$HOME/.foundry/bin/forge"
CAST="$HOME/.foundry/bin/cast"
RPC="https://mainnet.base.org"
WALLET="0x96262be63aa687563789225c2fe898c27a3b0ae4"

# Check forge exists
if [ ! -f "$FORGE" ]; then
  echo "❌ Foundry 미설치. 설치: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

# Get private key
echo "MetaMask → ⋮ → 계정 세부정보 → 비공개 키 표시"
echo ""
read -s -p "프라이빗 키 입력 (표시되지 않음): " PK
echo ""

# Auto-fix: add 0x if missing
if [[ ! "$PK" == 0x* ]]; then
  PK="0x${PK}"
  echo "⚠️  0x 접두사 추가됨"
fi

# Validate length
if [ ${#PK} -ne 66 ]; then
  echo "❌ 키 길이 오류: ${#PK}자 (66자 필요)"
  echo "   MetaMask에서 다시 복사해보세요."
  exit 1
fi

# Validate hex
if ! echo "$PK" | grep -qE '^0x[0-9a-fA-F]{64}$'; then
  echo "❌ 유효하지 않은 16진수 문자 포함"
  exit 1
fi

echo "✅ 키 형식 유효"

# Derive address
echo ""
echo "🔑 주소 확인..."
DERIVED=$($CAST wallet address --private-key "$PK" 2>&1)
echo "   지갑: $DERIVED"

if [ "${DERIVED,,}" != "${WALLET,,}" ]; then
  echo "   ⚠️  예상 지갑($WALLET)과 다름"
  read -p "   계속하시겠습니까? (y/n): " CONT
  if [ "$CONT" != "y" ]; then exit 0; fi
fi

# Check balance
echo ""
echo "💰 잔고 확인..."
BAL=$($CAST balance $DERIVED --rpc-url $RPC --ether 2>&1)
echo "   $BAL ETH"

# Deploy
echo ""
echo "🚀 배포 중... (30초 소요)"
RESULT=$($FORGE create src/contracts/BalancerFlashArb.sol:BalancerFlashArb \
  --rpc-url $RPC \
  --private-key "$PK" \
  --constructor-args $WALLET 2>&1)

echo "$RESULT"

# Extract and save address
ADDR=$(echo "$RESULT" | grep "Deployed to:" | awk '{print $3}')
if [ -n "$ADDR" ]; then
  echo ""
  echo "{" > data/deployed-contract.json
  echo "  \"contractAddress\": \"$ADDR\"," >> data/deployed-contract.json
  echo "  \"owner\": \"$WALLET\"," >> data/deployed-contract.json
  echo "  \"chain\": \"base\"," >> data/deployed-contract.json
  echo "  \"chainId\": 8453," >> data/deployed-contract.json
  echo "  \"deployedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" >> data/deployed-contract.json
  echo "}" >> data/deployed-contract.json
  
  echo "╔══════════════════════════════════════╗"
  echo "║         ✅ 배포 성공!                ║"
  echo "╠══════════════════════════════════════╣"
  echo "  Contract: $ADDR"
  echo "  Config:   data/deployed-contract.json"
  echo ""
  echo "  다음: npm run trigger:arb -- --once --simulate"
  echo "╚══════════════════════════════════════╝"
else
  echo ""
  echo "❌ 배포 실패 — 위의 에러 메시지를 확인하세요"
fi
