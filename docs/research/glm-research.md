# GLM Research: BOB Claw Strategy Opportunity Analysis

> **문서 성격**: 리서치 사실 참조 + 전략 제안. **규칙이 아님.** 운영 규칙은 리포 루트 `AGENTS.md`.
> **작성일**: 2026-04-21
> **적용 범위**: BOB Gateway 공식 11 체인 (Ethereum, BOB L2, Base, BNB, Avalanche, Unichain, Berachain, Optimism, Soneium, Sei, Sonic)
> **기준 자본**: $100–500 소액 자동화 운용 (per-strategy cap 모델)
> **회계 단위**: BTC 우선 (AGENTS.md Payback Model 일관)

---

## 1. Executive Summary

**핵심 발견**: BTC 순수 lending yield는 2026-04 기준 거의 0%에 수렴. 하이리턴를 원하면 아래 3가지 경로 중 하나를 선택해야:

1. **Leverage loop** (2-3x) → 순수익 2-9% APY, 청산 리스크 존재
2. **BTC LST + Pendle PT** (고정수익) → 3-12% APY, 잠금 + 프로토콜 리스크
3. **Concentrated Liquidity + AERO 인센티브** → 5-185% APY, IL + 인센티브 소멸 리스크

순수 wBTC/cbBTC 랜딩 공급만으로는 수익이 Gateway round-trip 비용(0.2-1.6%)보다 낮음 → **자동 배치 불가능 상태**. leverage 또는 LST 경로가 필수.

**추천 우선순위** (BobClaw 자동화 아키텍처 기준):

| 우선순위 | 전략 | 기대 APY | 자동화 난이도 | 리스크 등급 |
|---|---|---|---|---|
| 1 | Wrapped BTC lending loop (Base/Moonwell) | 2-9% | 낮음 (이미 구현됨) | 중간 |
| 2 | Pendle PT on BSC (SolvBTC.BBN via Gateway) | 3-7% 고정 | 낮음 | 중간 |
| 3 | Aerodrome CL on Base (cbBTC/USDC + AERO) | 5-15% | 중간 | 중간-높음 |
| 4 | Perp basis on Avalanche (GMX) | 3-15% (regime-dependent) | 중간 | 높음 |
| 5 | Berachain BTC LST incentives | 8-12% (한시적) | 중간 | 높음 |

---

## 2. 체인별 DeFi Yield 현황 (2026-04 실측)

### 2.1 Ethereum

| 프로토콜 | 자산 | 공급 APY | TVL | 비고 |
|---|---|---|---|---|
| Aave v3 | WBTC | **0.00%** | $2.74B supplied | 이용률 ~2.57%, 차입 수요 극저 |
| Compound v3 | WBTC | 0% (담보 전용) | — | v3에서 WBTC는 이자 없는 담보 |
| Morpho | WBTC | **~0.3%** | $7.36B total | P2P 매칭으로 Aave보다 약간 높음 |
| Spark | WBTC | **0.00035%** | 중간 | Morpho Blue가 차입 비용 저렴화 |

**스테이블코인 스프레드**:

| 프로토콜 | USDC 공급 APY | USDC 차입 APY | 스프레드 |
|---|---|---|---|
| Aave v3 | 4.2% | 5.8% | 1.6% |
| Compound v3 | 4.0% | 5.5% | 1.5% |
| Morpho | 4.8% | 5.2% | 0.4% |

**DEX BTC 풀**: Uniswap V3 WBTC/USDC — 30.6% fee APY (30d), $26.6M TVL. IL 리스크 높음.

**Ethereum 평가**: 가스비($1-8/tx)가 소액 포지션 수익 전부 소진. BTC 랜딩 단독으로는 음수 수익. 레버리지 루프만 의미 있으나 가스 효율 낮음.

### 2.2 Base

| 프로토콜 | 자산 | 공급 APY | TVL | 비고 |
|---|---|---|---|---|
| Aave v3 | cbBTC | **~0%** | 대형 | 이용률 극저 |
| Moonwell | cbBTC | **~0%** (kink 전 0%) | 중간 | 2026-02 오라클 오설정 사고(~$1.78M bad debt) |
| Morpho (Seamless) | cbBTC | **0.3%** | $1.7M | Gauntlet 관리 |

**Aerodrome CL BTC 풀** (AERO 인센티브 포함):

| 풀 | Fee APY | TVL | IL 리스크 |
|---|---|---|---|
| cbBTC/LBTC | **~1.5%** | $7.9M | 낮음 (correlated) |
| tBTC/cbBTC | **~1.4%** | $9.7M | 낮음 (correlated) |
| cbBTC/USDC | **176-185%** | 변동 | 높음 (non-correlated) |
| cbBTC/cbETH | **106-177%** | 변동 | 중간 |
| cbBTC/cbXRP | **760%** | 변동 | 매우 높음 |
| cbBTC/cbDOGE | **1,453%** | 변동 | 극단적 |

**BTC LST**: PT-LBTC (Base) = **6.3% 고정** (~106일 만기)

**Base 평가**: Gateway 메인 목적지. 가스비 $0.002-0.05/tx로 소액 자동화 최적. Aerodrome AERO 인센티브가 트리플딧짜리 APY를 만들지만, 인센티브 소멸 시 fee-only APY는 correlated pair 1-2%, non-correlated 5-15%로 수렴 예상.

### 2.3 BNB Chain

| 프로토콜 | 자산 | 공급 APY | TVL | 비고 |
|---|---|---|---|---|
| Venus | BTCB | **0.06-0.19%** | $397-725M | 최대 BSC 렌더. 2025-09 $27M 익스플로잇 |
| Aave v3 | BTCB | **~0%** | $67-70M | 이용률 극저 |

**BTC LST on Pendle (BSC)**: SolvBTC.BBN = **5.1-7.2%** 고정수익. BOB Gateway Custom Action으로 직접 진입 가능.

**BSC 평가**: BTCB는 Binance 커스터디 리스크. Venus 익스플로잇 이력. 하지만 Pendle PT 경로가 Gateway와 직접 연결되어 자동화 매력적.

### 2.4 Avalanche

| 프로토콜 | 자산 | 공급 APY | TVL | 비고 |
|---|---|---|---|---|
| BENQI | BTC.b | **0.4%** | $25.8M | Risk Grade C |

**DEX BTC 풀**:

| 풀 | APY | TVL | IL |
|---|---|---|---|
| Trader Joe BTC.b/AVAX (Standard) | **112.7%** | $2.7M | 높음 |
| Trader Joe BTC.b/AVAX (Auto CL) | **5,034.7%** | $2.7M | 극단적 |

**GMX V2 on Avalanche**: BTC 퍼펴추얼. 1x 숏 포지션 + WBTC 담보 → delta-neutral borrow fee 수집. 현재 펀딩률은 근소 음수~0%. 불장에서 5-15% APY 가능.

**Avalanche 평가**: GMX perp basis가 가장 의미 있는 BTC 수익 경로. 펀딩률이 양수로 돌아서면 자동 활성화 가능.

### 2.5 Unichain

| 프로토콜 | TVL | 비고 |
|---|---|---|
| Euler v2 | $330M | MEV 저항 청산 |
| Morpho | $67M | Gauntlet/RE7 관리 |
| Uniswap V4 | $641M | 네이티브 DEX |

**BTC 수익 데이터**: 아직 희소. Euler/Morpho vault가 USDC/ETH 중심. WBTC/USDC V4 풀 $5.25M TVL.

**Unichain 평가**: 성장 중이지만 BTC 특화 수익 아직 부족. 모니터링만.

### 2.6 Berachain

| 프로토콜 | 타입 | BTC 지원 | 수익 메커니즘 |
|---|---|---|---|
| Bend | 렌딩 | LBTC, WBTC | 이자 + BGT 보상 |
| BEX (BeraSwap) | DEX | WBTC, LBTC pairs | 거래 수수료 + BGT |
| Berps | 퍼펴추얼 | BTC perps | 수수료 분배 + BGT |

**BTC LST via Pendle**:

| 자산 | APY | 만기 |
|---|---|---|
| EtherFi LiquidBeraBTC | **11.4%** | ~57일 |
| SolvBTC.BERA | **12.05%** | ~57일 |
| Lombard LBTC (Bera) | **11.97%** | ~57일 |

**BGT 보상**: WBTC/WBERA vault — BGT APR **15.26%**

**Berachain 평가**: BGT 인센티브가 BTC 수익을 11-15%로 끌어올림. 하지만 BGT는 소울바운드(비이전), 인플레이션 ~10%/년. 인센티브 종료 시 수익 급락. 한시적 기회.

### 2.7 Optimism

| 프로토콜 | 자산 | 공급 APY | 비고 |
|---|---|---|---|
| Aave v3 | WBTC | **0.02%** | 211 WBTC, 이용률 ~5.75%, 감소 추세 |

**Optimism 평가**: BTC 랜딩 수익 사실상 없음. Synthetix Perps V2/V3만 의미 있으나 펀딩률 근소.

### 2.8 Soneium

- TVL: $78-155M
- Sony 백업 OP Stack L2
- **BTC 특화 DeFi 수익 상품 없음** — GameFi/NFT/소비자 앱 중심
- LI.FI Earn 통합으로 간접적 크로스체인 yield 접근 가능

**Soneium 평가**: BTC 수익 목적지로 부적합. 모니터링만.

### 2.9 Sei

- 총 랜딩 TVL: $22.48M (극소)
- **BTC 랜딩 풀/수익 상품 TVL > $50M 없음**
- Silo V2는 Sonic(Sei 후속)에 배포

**Sei 평가**: BTC 수익 생태계 미성숙. 제외.

### 2.10 Sonic

| 자산 | 백킹 | 수익 메커니즘 |
|---|---|---|
| scBTC (Rings) | LBTC + eBTC + wBTC | 이자 bearing + stkscBTC 주간 yield |
| LBTC | Lombard Babylon | ~0.41% base + DeFi |
| eBTC | EtherFi | Multi-layer yield |

**Silo V2**: $400M+ TVL. STS deposit APY ~1.1%. Risk-isolated.

**Sonic 평가**: scBTC가 의미 있는 BTC yield 경로. Silo V2 TVL 충분. 하지만 BTC 특화 pool 규모는 작음. 보조적 활용.

### 2.11 BOB L2

| 상품 | APY | 메커니즘 |
|---|---|---|
| K3 Capital WBTC/LBTC loop | **36.99%** (max ROE) | Euler V2 루프 레버리지 |
| Tulipa Saffron WBTC/LBTC | **31.55%** (max ROE) | 레버리지 yield 전략 |
| K3 HybridBTC.pendle/LBTC | **23.19%** (max ROE) | 크로스체인 yield vault |
| HybridBTC.pendle | 가변 (Pendle PT) | Veda 관리, $3B+ 백킹 |

**BOB L2 평가**: 최고 APY 표면. 하지만 max ROE는 최적 조건 가정치. 실제 risk-adjusted 수익은 5-15% 예상. Euler V2 루프가 가장 접근 가능. 750K OP 토큰 인센티브(Grant S6) 진행 중.

---

## 3. BTC LST (Liquid Staking Token) 종합 비교

| 프로토콜 | 자산 | Base APY | Pendle PT APY | 메커니즘 | TVL/유통 |
|---|---|---|---|---|---|
| **Lombard** | LBTC | 0.41% | 6.3-11.97% (체인별) | Babylon staking; BABY → BTC 전환 | ~$772M |
| **Solv** | xSolvBTC / BTC+ | 3-5.5% | 5.1-7.2% (.BBN) | 다중전략: basis, lending, RWA | $450M+ |
| **Bedrock** | uniBTC | 리베이싱 | 7.3% (Corn PT) | Babylon + EigenLayer restaking | 중간 |
| **EtherFi** | eBTC | Multi-layer | 10.5% (Corn PT) | LBTC 담보 + 재스테이킹 | 성장 중 |
| **Babylon** | Native BTC | 0.05-1.98% | N/A | 네이티브 BTC 타임락; BABY 토큰 보상 | ~44-57K BTC |

**핵심 인사이트**: Pendle PT가 BTC yield의 핵심 인플레이션 원천. 하지만:
- Pendle TVL 2025 피크 대비 **74% 하락** ($13.38B → $3.44B)
- $PENDLE 가격 **69% 하락** ($6.85 → $2.13)
- Ethena Season 4 인센티브 종료 후 캐리 플립
- 현재 PT 고정수익은 3-6% 수렴 중, 인센티브 재개 시 7-12% 가능

---

## 4. 전략 심층 분석

### 4.1 Leverage Loop (BTC Lending Loop)

**현재 상태**: `recursive_wrapped_btc_lending_loop` — receipt_backed_validation_ready, dry-run 14회 통과, signer-backed 12회 실행.

**수학**:
```
최대 레버리지: L = 1 / (1 - LTV)
LTV = 0.81 (Moonwell cbBTC), HF 1.5 제약 → 실제 LTV_max = 0.81 / 1.5 = 0.54
3x 루프: Net APY = (Supply_APY × 3) - (Borrow_APY × 2)
Supply 0.3%, Borrow 3% → Net = 0.9% - 6% = -5.1% (음수!)
```

**문제**: BTC 공급 APY(0-0.3%)가 차입 APY(3-5%)보다 훨씬 낮음 → BTC 단일 루프는 **음수 수익**.

**해결**: 두 가지 경로만 양수 가능:
1. **BTC 담보 → USDC 차입 → Pendle PT 배치**: cbBTC 담보 60% LTV → USDC 차입 7.47% → PT 12.61% → 스프레드 ~3.1%
2. **크로스 프로토콜 스프레드**: Aave 차입 2.83% → Morpho 공급 4.0-7.2% → 스프레드 ~1.5-4.4%

**리스크**:
- HF 1.5 기준 → BTC 33% 하락 시 청산
- 3x 루프 → 15% BTC 하락 시 HF ~1.08 (위험)
- 2023-03 USDC depeg: Aave 3,400건 자동 청산, $24M 손실
- Kelp DAO 2026-04 익스플로잇($292M)이 Aave 연쇄 bad debt 유발

**가스비 영향** ($100-500 포지션):
- Base: $0.01-0.10/리밸런스 → 무시 가능
- Ethereum: $2-8/리밸런스 → $100 포지션에서 수익 33%+ 가스로 소진

### 4.2 Pendle PT (BTC LST 고정수익)

**BOB Gateway 직접 경로**: Custom DeFi Action으로 native BTC → SolvBTC.BNB on BSC Pendle market 1클릭 진입.

**현재 PT 수익률**:

| 자산 | 체인 | PT 고정 APY | 만기 | 수익 확실성 |
|---|---|---|---|---|
| LBTC (Corn) | Ethereum | ~7.7% | ~15일 | 인센티브 의존, 압축 중 |
| LBTC (Base) | Base | ~6.3% | ~106일 | 비교적 안정 |
| eBTC (Corn) | Ethereum | ~10.5% | ~43일 | 인센티브 부스터 |
| SolvBTC.BBN | BNB | ~5.1% | ~43일 | 중간 |
| SolvBTC.BBN | Ethereum | ~7.2% | ~43일 | 중간 |
| LBTC (Bera) | Berachain | ~11.97% | ~57일 | BGT 인센티브 의존 |
| SolvBTC.BERA | Berachain | ~12.05% | ~57일 | BGT 인센티브 의존 |

**자동화 경로**:
1. Gateway onramp: BTC → BSC wBTC.OFT
2. DEX swap: wBTC.OFT → SolvBTC.BNB
3. Pendle deposit: SolvBTC.BBN → PT 토큰
4. 만기까지 보유 → 원금 + 고정 이자 상환
5. Gateway offramp: 수익 → BTC L1

**리스크**:
- PT는 만기 시 원금 보장 (프로토콜 기본 가정)
- YT 손실 100% 가능
- Pendle LP 포지션: 5-30% IL
- Lombard/Solv/EtherFi: WBTC보다 짧은 운영 이력

**가스비**: BSC $0.10-0.30/tx. $100 포지션에서 무시 가능.

### 4.3 Concentrated Liquidity (Aerodrome on Base)

**cbBTC/USDC 전략** (가장 현실적):

| 파라미터 | 값 |
|---|---|
| 풀 | Aerodrome Slipstream cbBTC/USDC (0.01% fee tier) |
| 범위 | BTC 현재가 ±2.5% |
| Fee APY (AERO 미포함) | ~5-8% |
| AERO 인센티브 포함 | 176-185% |
| 리밸런스 주기 | 2-3회/주 (>2% 이탈 시) |
| Zero-swap 리밸런싱 | Snuggle 방식, IL 실현 지연 |

**cbBTC/LBTC 전략** (저위험):

| 파라미터 | 값 |
|---|---|
| 풀 | Aerodrome cbBTC/LBTC |
| 범위 | 극좁 (0.1-0.5% spread) |
| Fee APY | ~1.5% |
| IL | 거의 0 (correlated pair) |
| 리밸런스 필요 | 거의 없음 |

**BTC/USDC + Perp 헷지 전략** (참고):
- cbBTC/USDC CL 포지션 + Hyperliquid BTC 숏 → delta-neutral
- Target APY ~75% (GitHub ONETheo/btc-hyperliquid-aerodrome)
- **문제**: Hyperliquid은 Gateway 체인 아님 → 자동화 경로 불가

**리스크**:
- cbBTC/USDC: BTC 2배 상승 시 IL ≈ -5.72%, 4배 시 ≈ -20%
- AERO 인센티브 소멸 시 APY 급락 (185% → 5-8%)
- 범위 이탈 시 수수료 0, 리밸런스 필요
- MetaDEX03 업그레이드(Q2 2026)가 MEV 캡처 → LP 수익 10-30% 증가 가능

### 4.4 Perp Basis / Funding Rate Arbitrage

**현재 펀딩률** (2026-04):

| 플랫폼 | BTC 펀딩 | 모델 | 비고 |
|---|---|---|---|
| Hyperliquid | **-4.18% APY** (현재), 30d 평균 0.6% | 연속(블록당) | **Gateway 체인 아님** |
| Binance/OKX/Bybit | **-0.0072%** (8시간) | CEX | CEX leg 자동화 불가 |
| GMX V2 (Avalanche) | 가변, pool 기반 | AMM | **Gateway 체인** |
| Synthetix (Optimism/Base) | 가변 | Perps V2/V3 | **Gateway 체인** |

**Cash-and-Carry 전략**:

| 페어링 | 순 APY | Gateway 자동화 |
|---|---|---|
| Base/Aave supply + GMX 숏 | ~5-15% (불장) | 부분 가능 |
| Base DEX spot + Synthetix 숏 | ~3-10% | 전체 온체인 |
| Aave 루프 + perp 숏 | ~8-20% | 복합 리스크 |

**GMX 접근** (가장 관련):
- Avalanche에 배포 → Gateway 지원 체인
- 1x 숏 + WBTC 담보 → delta-neutral, borrow fee 수집
- 펀딩률이 양수일 때만 수익 → 현재는 근소 음수 → **대기**

**리스크**:
- 펀딩 플립 시 연속 음수 수익
- 2026-04 KiloEx perp 익스플로잇 $7.4M (오라클 조작)
- 2026-04 Drift Protocol $285M (관리키 침해)
- Perp DEX는 랜딩 프로토콜보다 운영 리스크 높음

### 4.5 Cross-Chain Arbitrage (wBTC 가격차)

**이미 측정됨**: `btc_proxy_spreads: measured_below_policy`. 순수익 -$0.90, 가스/슬리피지 분산 $7.45. **음수 엣지 확인**.

**브릿지 비용이 수익 잠식**:
- 0.5% 가격 기회 → 브릿지비 0.06% + 가스 + DEX 수수료 0.05-0.30% + 슬리피지 → **-0.2%**
- 2026-04 Kelp DAO 익스플로잇: LayerZero OFT 어댑터 → BOB Gateway와 동일 메시징 레이어

**결론**: 소액 포지션에서 cross-chain arb는 **확정 음수**. AGENTS.md에서 이미 재평가 lane으로 분류. 주력 전략에서 제외.

### 4.6 Vault Strategies (Beefy/Yearn/Convex)

| Vault | 체인 | 타입 | APY | 비고 |
|---|---|---|---|---|
| Beefy Convex multiBTC | Ethereum | Curve metapool + CVX | 5-15% (인센티브) | Ethereum 가스 비효율 |
| Beefy Curve Tricrypto | Ethereum | BTC/ETH/USDT | 3-8% | IL 포함 |
| Beefy lending folding | 멀티체인 | 레버리지 공급/차입 | 2-8% | 가장 관련 |
| Yearn WBTC | Ethereum | 렌딩 + 전략 로테이션 | 1-3% | 낮음 |

**자동화**: set-and-forget. 예치 후 자동 복리. 가장 수동적 전략.

**한계**: 수익이 낮음(1-8%). "더 나은 기회를 기다리는 동안 자본 주차" 용도.

### 4.7 BitVM / YBTC (신흥)

- Bitlayer BitVM Bridge 2025-07 메인넷 라이브
- BOB가 BitVM Alliance 창립 멤버
- 신뢰 모델: honest-majority → existential honesty (1-of-n) 개선
- YBTC: 스테이킹, 렌딩, DEX LP 지원
- **현재**: 생태계 초기, 도구 부족, 자동화 난이도 높음
- **잠재력**: WBTC 커스터디 리스크를 비트코인 수준 보안으로 대체 가능

---

## 5. Perp Funding Rate 전망

현재 BTC 펀딩은 **근소 음수~0%** (2026-04). 숏이 롱에게 지불 → cash-and-carry 전략에 유리.

| 시나리오 | 펀딩 APY | Basis 전략 수익 | 확률 |
|---|---|---|---|
| 강세장(지속 상승) | 10-30% | 10-28% | 30% |
| 중립(횡보) | 0-5% | 3-8% | 40% |
| 약세장(하락) | -5~0% | -3~2% | 30% |

**자동화 트리거**: BTC 30일 펀딩 APY가 5% 이상으로 연속 7일 유지 시 GMX/Synthetix 숏 포지션 진입. 음수 3일 연속 시 자동 청산.

---

## 6. 2026 Q1 주요 리스크 이벤트

| 사건 | 날짜 | 규모 | BOB Claw 영향 |
|---|---|---|---|
| Kelp DAO LayerZero OFT | 2026-04-18 | $292M | **직접 관련** — BOB Gateway와 동일 LayerZero 메시징 |
| Drift Protocol 관리키 | 2026-04-01 | $285M | Perp DEX 운영 리스크 실증 |
| Aperture Finance | 2026-01 | $3.7M | 11체인 임의 호출 취약점 |
| Moonwell 오라클 | 2026-02 | ~$1.78M | Base cbBTC 오라클 오설정 → bad debt |

**조치 권고**: `src/config/payback.mjs` emergency pause 트리거를 LayerZero OFT 어댑터 익스플로잇 패턴에 대해 테스트.

---

## 7. 자동화 구현 로드맵

### Phase 1: 즉시 (이미 구현됨, 활성화만 필요)

| 전략 | 구현 상태 | 활성화 조건 |
|---|---|---|
| Wrapped BTC lending loop (Base/Moonwell) | `receipt_backed_validation_ready` | measured positive edge, daemon start |
| Gateway onramp/offramp | End-to-end proven | 충분한 BTC 자본 입금 |

### Phase 2: 1-2주 내 구현 가능

| 전략 | 필요 작업 | 예상 공수 |
|---|---|---|
| Pendle PT on BSC (SolvBTC.BBN) | Gateway Custom Action → Pendle deposit adapter | 2-3일 |
| Aerodrome CL cbBTC/LBTC | Position manager + range logic | 3-5일 |
| Beefy folding vault (Base) | Deposit/withdraw adapter | 1-2일 |

### Phase 3: 1-2개월 내 구현

| 전략 | 필요 작업 | 예상 공수 |
|---|---|---|
| Perp basis (GMX Avalanche) | Funding rate oracle + position manager | 5-7일 |
| Aerodrome CL cbBTC/USDC + auto-rebalance | Range management + IL watcher | 5-7일 |
| Berachain BTC LST (Bend/BEX) | Chain adapter + BGT 보상 추적 | 5-7일 |

### Phase 4: 모니터링/대기

| 전략 | 활성화 조건 |
|---|---|
| Perp basis | BTC 30d funding > 5% APY 연속 7일 |
| BitVM/YBTC | BitVM 메인넷 안정화 + 생태계 도구 성숙 |
| Berachain 인센티브 | 새 시즌 BGT 분배 발표 시 |
| Cross-chain arb | 측정 엣지 양수 전환 시 (현재 음수) |

---

## 8. 포트폴리오 시나리오 분석

### Conservative ($300 자본, 목표 3-5% APY)

| 슬리브 | 배분 | 전략 | 기대 APY | BTC 회계 영향 |
|---|---|---|---|---|
| BTC 담보 + USDC 차입 → PT | $200 | Moonwell cbBTC 담보 → Morpho USDC 차입 → Pendle PT | ~3.1% net | BTC 노출 유지 |
| Correlated CL | $80 | Aerodrome cbBTC/LBTC | ~1.5% | BTC 노출 유지 |
| Gas reserve | $20 | Base ETH | 0% | 운영비 |

**연간 기대 수익**: ~$7.53 USD → ~7,530 sats (BTC $100K 기준)
**페이백 누적**: 20% × 7,530 = 1,506 sats/년 → minPaybackBtc(50,000 sats) 도달에 ~33년
**평가**: Conservative만으로는 페이백 최소량 도달 불가. 자본 확대 또는 leverage 필수.

### Moderate ($500 자본, 목표 6-10% APY)

| 슬리브 | 배분 | 전략 | 기대 APY |
|---|---|---|---|
| BTC → USDC 루프 + PT | $250 | Moonwell/Morpho cross-protocol | ~4-5% net |
| Pendle PT (BSC) | $150 | SolvBTC.BBN via Gateway | ~5.1-7.2% 고정 |
| Aerodrome CL cbBTC/USDC | $80 | ±5% range + AERO | ~10-15% |
| Gas reserve | $20 | | 0% |

**연간 기대 수익**: ~$33 → ~33,000 sats
**페이백 누적**: 20% × 33,000 = 6,600 sats/년 → minPaybackBtc 도달에 ~7.6년
**평가**: 페이백 사이클 가동 가능하나 회수 기간 긺. 자본 $1,000+에서 의미적.

### Aggressive ($1,000 자본, 목표 12-20% APY)

| 슬리브 | 배분 | 전략 | 기대 APY |
|---|---|---|---|
| 3x BTC 루프 + USDC → PT | $400 | Moonwell 3x → Pendle | ~8-12% net |
| Pendle PT 다중체인 | $200 | BSC + Bera LBTC/eBTC | ~7-12% 고정 |
| Aerodrome CL cbBTC/USDC | $200 | ±2.5% range + AERO | ~15-20% |
| GMX perp basis | $150 | Avalanche 1x 숏 | ~5-15% (regime) |
| Gas reserve | $50 | Multi-chain | 0% |

**연간 기대 수익**: ~$140 → ~140,000 sats
**페이백 누적**: 20% × 140,000 = 28,000 sats/년 → minPaybackBtc 도달에 ~1.8년
**평가**: $1,000+ 자본에서 페이백 사이클이 의미적. 하지만 청산/IL 리스크 상당.

---

## 9. 핵심 결론 및 권고

### 9.1 "BTC 넣으면 알아서 배치" 현실 검증

| 조건 | 현재 상태 | 필요 작업 |
|---|---|---|
| Gateway 입출금 코드 | 완료 | — |
| 렌딩 루프 코드 | 구현됨 (dry-run 14회 통과) | 양수 엣지 측정 |
| 정책 엔진 | 구현됨 | 데몬 시작 |
| 서명 데몬 | 구현됨 | 실제 실행 |
| **측정 양수 엣지** | **없음** | **BTC → USDC → PT 스프레드 측정** |
| 충분한 BTC 자본 | 부족 | 최소 $300-500 필요 |

**자동 배치 활성화 최소 조건**:
1. BTC $300-500 입금
2. Moonwell cbBTC 담보 → USDC 차입 → Pendle PT 경로의 **실측 순수익 양수** 확인
3. 서명 데몬 + 정책 엔진 실행
4. `autoExecute: true` 커밋 + per-strategy cap 선언

### 9.2 전략 선택 의사결정

```
BTC만 넣고 아무것도 안 하면:        0% APY
BTC 랜딩만 하면:                   0-0.3% APY (Gateway 비용 > 수익)
BTC → USDC 루프 + PT:              3-5% APY (최소 의미적)
BTC → USDC 루프 + PT + CL:         6-15% APY (모더레이트)
BTC → 레버리지 + PT + CL + Perp:   12-20% APY (어그레시브, 높은 리스크)
```

### 9.3 즉시 실행 가능한 첫 전략

**가장 빠른 경로**: BTC → Gateway onramp → Base cbBTC → Moonwell 담보 → USDC 차입 → Pendle PT-LBTC (Base, 6.3% 고정)

이미 구현된 컴포넌트: Gateway onramp, Moonwell adapter, policy engine, signer daemon
필요 추가: USDC → Pendle deposit adapter, PT 만기 → USDC → cbBTC 상환 adapter

---

## 출처

- [Aavescan WBTC Ethereum](https://aavescan.com/ethereum-v3/wbtc)
- [Morpho Dashboard](https://data.morpho.org/)
- [Babylon Staking Guide](https://passiveyieldlab.com/blog/babylon-staking-btcfi-passive-income-2026)
- [Lombard Yield Docs](https://docs.lombard.finance/learn/products-overview/yield)
- [Aerodrome BTC Pools](https://exponential.fi/pools/aerodrome-btc-market-making-base/06666d97-5ff1-40e4-82c2-dc6146ef4df9)
- [Aerodrome cbAsset Rewards](https://outposts.io/article/aerodrome-offers-triple-digit-lp-rewards-on-base-cbassets-0cca223b-4217-464f-9398-44013782ef36)
- [BOB Gateway Custom DeFi Actions](https://gobob.xyz/blog/custom-defi-actions-now-integrated-in-bob-gateway-sdk)
- [BTC Yield Strategies (Nansen)](https://research.nansen.ai/articles/btc-yield-strategies-restaking-and-pendle-markets)
- [Funding Rate Arbitrage Guide 2026](https://degen0x.com/learn/funding-rate-arbitrage-guide-2026/)
- [Basis Trading 15%+ APY 2026](https://decentralised.news/the-funding-rate-arbitrage-playbook-6-exchanges-where-basis-trading-still-prints-15-apy-in-2026)
- [Convex vs Yearn vs Beefy 2026](https://defisect.com/yield-aggregators-in-2026-yearn-v3-vs-beefy-finance-vs-convex-architecture-yields-and-risk-compared/)
- [Kelp DAO $292M Hack](https://www.cryptotimes.io/2026/04/19/kelp-dao-bridge-drained-for-292m-in-2026s-biggest-defi-hack/)
- [Drift Protocol $285M Hack](https://www.spotedcrypto.com/drift-protocol-285m-hack-explained/)
- [BitVM Bridge Live](https://bitcoinnews.com/press-release/bitlayer-bitvm-bridge-live-on-mainnet/)
- [Sonic scBTC and LBTC](https://blog.soniclabs.com/scbtc-and-lbtc-bringing-bitcoin-to-the-sonic-defi-scene/)
- [Berachain Bend Docs](https://docs.berachain.com/bend/learn/overview)
- [Venus BTC on BNB](https://exponential.fi/pools/venus-btc-lending-bnb-chain/d7eeb6c9-9660-43b5-bfa8-304cdaf34e85)
- [BOB Hybrid BTC Yield](https://blog.gobob.xyz/posts/bob-launches-hybrid-btc-yield-products-ushering-in-a-new-era-of-bitcoin-defi)
- [Bitcoin Passive Income 2026](https://passiveyieldlab.com/blog/bitcoin-passive-income-2026-earn-yield-wbtc-defi)

---

## 문서 이력

- 2026-04-21: 초안 작성. 11 체인 수익 현황 + 7 전략 심층 분석 + 포트폴리오 시나리오 + 자동화 로드맵.