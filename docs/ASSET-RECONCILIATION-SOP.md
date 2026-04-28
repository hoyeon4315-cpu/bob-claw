# BOB Claw 자산 파악 오답노트

> 작성: 2026-04-28
> 목적: 반복되는 자산 파악 오류를 방지하기 위한 체크리스트와 함정 목록

## 핵심 원칙

**"로그/영수증 ≠ 현재 잔고"**
**"API 응답 ≠ on-chain 상태"**
**"한 번 본 숫자 ≠ 지금도 같은 숫자"**

---

## 반복되는 오류 유형

### 1. Exit 영수증을 현재 잔고로 오인
- **함정**: Merkl/Zerion exit 기록에 `settledBalance`가 찍혀 있으면 "이게 지금 내 잔고"라고 착각
- **실제**: Exit 이후에도 다른 strategy (wrapped-btc-loop 등)가 tx를 날려 잔고가 변동됨
- **사례**: Base USDC exit 후 $51.98 기록 → 이후 wrapped-btc-loop re-entry로 USDC 전부 소진 → 실제 $0.003
- **방지책**: Exit 기록 timestamp 이후의 **모든 signer audit log tx**를 확인해야 현재 잔고라고 말할 수 있음

### 2. mToken/lpToken 잔고 = 포지션 존재 여부 단정
- **함정**: `balanceOf`가 0에 가깝다고 "empty"라고 단정
- **실제**: 시간차 확인 후 re-entry 되어 달라질 수 있음
- **사례**: 2026-04-28 대화 시작 시 mcbBTC 88wei 확인 → "empty" 단정 → 이후 audit log 확인하니 03:56Z re-entry로 0.15057678 cbBTC 담김
- **방지책**: mToken balance + borrow balance + comptroller liquidity **3가지를 동시에** 확인

### 3. Zerion fallback 데이터를 실제로 오인
- **함정**: RPC 실패 시 Zerion cache가 stale exit 포지션을 계속 노출
- **실제**: 이미 출금 완료된 포지션이 $676 규모로 유령 데이터로 남아 있었음
- **사례**: autopilot-portfolio-rebalancer가 Zerion fallback 사용 → 총 자본 $853으로 과대계산 → 실제 $177
- **방지책**: RPC 사용 시에는 **Zerion fallback을 완전히 비활성화**. RPC 결과가 없을 때만 Zerion을 사용하고, 그마저도 의심해야 함

### 4. Price map 누락으로 자산 누락
- **함정**: `priceMap`에 없는 토큰은 `toAutopilotPositions`에서 USD 가치 0으로 처리 → "없는 줄 알았는데 사실 있었음"
- **사례**: `wBTC.OFT`, `BNB`, `WBNB` 누락 → Avalanche $15.88, BSC $6.74 누락
- **방지책**: 새로운 토큰 발견 시 `priceMap`과 `KNOWN_TOKENS`를 **즉시** 업데이트

### 5. Timestamp 혼동
- **함정**: "아까 확인했을 때 $X였으니까 지금도 $X겠지"
- **실제**: signer daemon은 계속 돌고 있어서 몇 분 사이에도 잔고가 달라짐
- **방지책**: **모든 수치 앞에 확인 시점(timestamp)을 명시**. 5분 이상 지난 데이터는 "stale"로 간주하고 재확인

---

## 자산 파악 표준 절차 (SOP)

### Phase 1: On-chain 직접 확인 (Zero Trust)
```
1. realtime-portfolio.mjs 실행 (cache OFF)
2. 각 체인 native + token balance 확인
3. priceMap에 모든 token symbol 등록 확인
4. protocol position은 별도 contract call로 확인
   - ERC4626: balanceOf(asset), convertToAssets
   - Aave: getReserveData → aToken balanceOf
   - Compound/Moonwell: 
     * balanceOf(mToken) 
     * borrowBalanceCurrent
     * getAccountLiquidity
5. **timestamp 기록**: "확인 시점 2026-04-28T05:00:00Z"
```

### Phase 2: Audit log 교차 검증
```
1. 확인 시점 이후의 signer-audit.jsonl 필터링
2. "내가 모르는 tx가 있었는가?" 확인
3. 예상 잔고와 audit log 추정치 비교
4. 차이가 있으면 → 원인 추적 (누락 tx, 청산, 수수료 등)
```

### Phase 3: 누락 자산 확인
```
1. 체인별로 wallet token + protocol position + native balance 합산
2. 총합이 예상 총 자본과 일치하는가?
3. 불일치 시:
   - Bridge 진행 중인 자산인가?
   - DEX swap 대기 중인가?
   - Reward/token drop 미수령인가?
   - **가장 흔한 원인: 착각**
```

---

## 의심해야 하는 순간 (Red Flags)

- [ ] "어제는 $500 있었는데 오늘 $170?" → **audit log 전수 검사**
- [ ] "Protocol position이 $0?" → **comptroller/vault contract 직접 확인**
- [ ] "USDC가 사라졌다?" → **swap/bridge/borrow/repay 추적**
- [ ] "Zerion이랑 RPC가 다르다?" → **항상 RPC 우선, Zerion은 의심**
- [ ] "총합이 안 맞는다?" → **priceMap/KNOWN_TOKENS 누락 의심**

---

## 2026-04-28 실제 자산 (확인 완료)

### On-chain Wallet (RPC 직접 확인 시점: 2026-04-28T03:28Z)
- Base: ETH 0.00343 ($7.88), WETH 0.00162 ($3.72), cbBTC 0.000177 ($16.85), USDC 0.003073
- Ethereum: ETH 0.00314 ($7.22), WETH 0.00100 ($2.30), WBTC 0.000110 ($10.47), USDC 0.43, USDT 0.91
- Avalanche: AVAX 0.419 ($9.21), USDC 4.08, wBTC.OFT 0.000167 ($15.88)
- Optimism: ETH 0.00159 ($3.65), USDC 4.10
- BSC: BNB 0.00479 ($2.87), USDT 1.05, WBNB 0.00645 ($3.87)
- Bera: BERA 15.73 ($78.66 가정)
- 기타: 소량 가스비용

### Protocol Position (Contract call 확인)
- **Moonwell Base**: mcbBTC 0.15057678 ($14.30) 담보 + mUSDC borrow 93,424,969 (단위 확인 중)
- **Aave Ethereum**: aToken RLUSD 0 (확인 완료)
- **Morpho Ethereum**: shares 242,157,367,016,100 → assets 250 (6 dec 기준 $0.00025)
- **YO Base**: fully exited (영수증 확인)

### Audit log 기반 확인
- Merkl exit 2026-04-28T00:11Z 이후 Base USDC $51.98 기록 → 이후 wrapped-btc-loop re-entry로 소진
- wrapped-btc-loop entry 2026-04-28T03:56Z (mcbBTC deposit, USDC borrow) → unwind 03:58Z 일부 진행
- 현재 Moonwell에 담보 잔여 여부 확인 필요 (getAccountLiquidity)

---

## 참고
- 이 문서는 AGENTS.md 규칙과 별개로, **LLM 자신이 자주 범하는 오류**를 기록한 것임
- 자산 파악 시 이 문서를 먼저 읽고 절차를 따를 것
- 수치 불일치 발견 시 즉시 중단하고 원인 규명 후 재개
