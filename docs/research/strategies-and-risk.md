# 전략 수학 + 프로토콜 리스크 — 사실 참조

> **이 문서의 성격**: 리서치 사실 참조. **규칙이 아님.** 운영 규칙은 리포 루트 `AGENTS.md`.
> **갱신 주기**: TVL은 월 1회, 수학 공식·해킹 이력은 변하지 않음(필요 시 추가).
> **마지막 실사 기준일**: 2026-04-17.

---

## 1. Looping (랜딩 풍차돌리기)

### 1.1 핵심 수학

| 개념 | 공식 |
|---|---|
| 최대 레버리지 (n→∞) | **L = 1 / (1 − LTV)** |
| n번 루프 누적 노출 | **Σₖ₌₀ⁿ (LTV)ᵏ = (1 − LTVⁿ⁺¹) / (1 − LTV)** |
| Net APY | **(Supply_APY × L) − (Borrow_APY × (L − 1))** |
| Aave Health Factor | **HF = Σ(Cᵢ × LT_i) / TotalDebt**, 청산 HF < 1 |
| Close Factor | HF ∈ [0.95, 1): 최대 50% / HF < 0.95: 최대 100% |

**예시**: ETH LTV=82.5% → L_max=5.71x. 9–12 loop 후 수렴. Supply 3.5% / Borrow 3.0% / L=5x → Net 5.5% APY (수수료·슬리피지 前).

### 1.2 BTC denominated 루핑 PnL (BobClaw 특화)

일반 루핑 PnL은 USD 단위로 계산되지만, BobClaw는 **BTC 단위로 변환**해야 페이백 회계(`AGENTS.md "Payback Model"`)와 일치.

```
PnL_sats = (Net_APY_usd × Position_size_usd) / BTC_price_t1_usd × SATS_PER_BTC
         - Position_size_sats_t0
```

**BTC 가격 변동에 따른 BTC denominated 수익률**:
- BTC 가격 **상승** 시: USD 수익 같아도 BTC 수량 수익 **감소**
- BTC 가격 **하락** 시: USD 수익 같아도 BTC 수량 수익 **증가** (단, 입금 BTC의 USD 가치 감소로 명목상 손실 가능)

페이백 엔진은 항상 **BTC(sats) 단위 누적 수익 기준**. USD 환산은 로그/표시용.

### 1.3 Health Factor 권장치 (근거 있는 값)

- HF=2.0 → 담보 50% 하락까지 생존
- HF=1.5 → 33% 하락까지 생존
- **Correlated pair** (stETH/ETH, LBTC/WBTC): HF 1.1–1.3 허용
- **Non-correlated** (USDC/ETH): HF ≥1.5 필수

실제 strategy config의 `healthFactorMin`은 위 값을 하한으로. 레버리지 전략은 `liquidationBufferPct`도 함께 선언 (AGENTS.md Risk Limits).

### 1.4 자동 리밸런싱 트리거 (DeFi Saver 관행 참고)

- Ratio < "repay if below" → Auto-Repay (담보 일부 swap → debt 상환)
- Ratio > 상한 → Auto-Boost
- 1분 간격 oracle polling 표준
- DeFi Saver 서비스 자체는 **최소 debt $4,000** 요구 → 소액 단계에서는 자체 구현 또는 Summer.fi 대안

### 1.5 BTC Looping 실측 경로 (2025–2026)

- **LBTC/wBTC** on Morpho Blue: Lombard LUX + Babylon yield
- **eBTC** (ether.fi) on Zerolend/Morpho: ether.fi + EigenLayer points
- **PT-LBTC** Pendle 26-Dec-2024: 2025-03 PT **6.98% fixed APY**
- **PT-eBTC**: **4.73% fixed** (58d 만기)
- **SolvBTC.BBN** on Pendle Corn pool: Babylon + Solv points
- BTC LST 시장점유 (2024 Q4, Nansen): **LBTC 37%, solvBTC 26%, pumpBTC 9.5%**, 79.6%가 Ethereum mainnet

### 1.6 Looping 역사적 위험 사례

| 사건 | 교훈 |
|---|---|
| 2022-06 stETH depeg (3AC/Celsius) | Correlated pair도 depeg 시 대규모 루핑 unwind 불가 → HF 버퍼 필수 |
| 2023-03-11 USDC depeg (SVB) | Aave v2/v3 **3,400건 자동 청산, $24M 담보**. Stable 담보도 depeg 가정 |
| 2023-03-13 Euler $197M exploit | 23일 후 전액 회수되긴 했으나, 프로토콜 신생도 = 코드 리스크 |
| 2026-03-03 Solv BRO 볼트 $2.7M | Reserve 토큰 본체와 위성 상품 구분 필수 (docs/research/bob-ecosystem.md §1.7) |
| 2026-03-12 Aave CAPO $862K | 오라클 오설정 손실 |

### 1.7 오픈소스 참조 (구현 참고)

- **Contango V2** (`docs.contango.xyz`): 0.05%/0.25% fee, 1-tx 루핑
- **DeFi Saver** (ConsenSys/Dedaub 감사): Aave V4 day-1 지원
- **Instadapp DSA** (`github.com/instadapp/dsa-contracts`)
- **Summer.fi**: Maker/Aave/Spark/Morpho
- **Yearn V3** (`github.com/yearn/yearn-vaults-v3`)

---

## 2. 프로토콜 리스크

### 2.1 2026-04 기준 블루칩 루핑 프로토콜 TVL

DeFiLlama 2026-03~04 스냅샷. **주간 ±20% 변동 가능** — 월 1회 재검증.

- **Aave v3**: $24.8–25.95B, 208 pools, 44 fork
- **Morpho V1/Blue**: $6.7–7.47B, 721 pools, V2 전환 진행 중, Morpho Vaults V2 출시 2025-11
- **SparkLend**: $1.86–2.07B (Spark 전체 $5.85B)
- **Compound V3**: $1.24–1.39B, isolated base asset
- **Euler V2**: $480–526M, 156 pool, EVK 모듈형, BOB L2 배포됨
- **Gearbox V3**: $48M, Credit Account 최대 10x
- **Fluid (Instadapp)**: $810M
- **Contango V2**: 소규모, flash-loan 기반 1-tx 루핑

### 2.2 주요 해킹 이력 (rekt.news 2026-04)

**규모 큰 순**:
- Ronin Network (Axie) $624M — bridge private key
- Poly Network $611M (회수됨)
- BNB Chain bridge $570M
- Wormhole $325M
- Euler $197M (회수됨)
- BadgerDAO $120M (frontend)
- Ankr $5M → stETH 토큰 가치 붕괴
- Solv BRO 2026-03-03 $2.7M (docs/research/bob-ecosystem.md §1.7)

**핵심 교훈**:
- **브릿지가 가장 큰 단일 장애 지점** — multi-bridge 경로를 전략에서 가정
- **프런트엔드 해킹 대비** — 트랜잭션은 항상 원시 calldata로 검증, 대시보드 서명 금지 (AGENTS.md LLM matrix)
- **오라클 오설정** — 프로토콜 버그 아니어도 주변 리스크 존재

### 2.3 블루칩 기준 (업계 관행)

- **TVL ≥ $500M**: 메인 포지션 대상
- **TVL $100M–500M**: 제한적 포지션
- **TVL < $100M**: 실험 bucket, 누적 5–10% 이내

BobClaw의 per-strategy cap (`src/config/strategy-caps.mjs`)은 이 값을 **상한**으로 해석, 실제 값은 더 작을 수 있음.

### 2.4 고위험 섹터 특이점

- **Perp DEX (HLP/JLP/GMX)**: Funding rate 변동성 및 oracle 의존. 단독 포지션 10% 이내 권장.
- **Meme·launchpad token 레버리지**: 유동성 증발 리스크. 루핑 금지.
- **사이드체인 wrapped BTC**: bridge 리스크 + wrapping 리스크 중첩. 제한적 사용.

### 2.5 분산 가이드라인 (참고 값, 실제 캡은 strategy-caps에)

| 항목 | 참고 상한 | 근거 |
|---|---|---|
| 단일 프로토콜 | ≤ 25% | 블루칩 기준 일반 관행 |
| 단일 체인 (L2) | ≤ 20% | 체인 리스크·브릿지 |
| 단일 체인 (Ethereum) | ≤ 50% | 메인넷 보안 프리미엄 |
| BOB L2 직접 보관 | ≤ 10% (BitVM mainnet 전) / ≤ 20% (후) | docs/research/bob-ecosystem.md §1.12 |
| 고위험 실험 (누적) | ≤ 5–10% | Exponential.fi D–F 등급 |
| BTC 계열 자산 비율 | **≥ 40%** (WBTC/LBTC/xSolvBTC/PT-LBTC 등) | 페이백 회계 일관성 |

**BTC denomination 유지 비율 ≥ 40%**이 BobClaw 특화 제약. USDC/스테이블 노출이 페이백 계산의 BTC 환산 변동성을 키우므로 제한. 실제 enforcement는 `src/config/strategy-caps.mjs` + Capital Manager 합산 검증에서.

---

## 3. Impermanent Loss + Concentrated Liquidity

### 3.1 IL 공식

```
price_ratio = P_t1 / P_t0
IL = 2 × sqrt(price_ratio) / (1 + price_ratio) - 1
```

**시사**:
- price_ratio=1 (가격 불변) → IL=0
- price_ratio=2 (한쪽 2배) → IL≈-5.72%
- price_ratio=4 (한쪽 4배) → IL≈-20%

IL은 실현 손실이 **아니다** — LP 포지션 종료 시 토큰 수량이 x/y 풀 공식에 따라 재분배되어, 단순 보유 대비 "덜 번 것"으로 측정된다.

### 3.2 Uniswap v3 CL 수학

집중 유동성은 범위 [P_a, P_b] 안에서만 활성.

```
L (유동성) = amount_X / (1/sqrt(P_a) - 1/sqrt(P_current))    // X 토큰 관점
         = amount_Y / (sqrt(P_current) - sqrt(P_a))          // Y 토큰 관점
```

**capital efficiency**: range 좁을수록 자본효율 높고 IL 노출도 집중됨. **BTC-USD 같은 변동성 큰 페어는 넓은 range + 동적 리밸런싱**, **LBTC-WBTC 같은 correlated 페어는 좁은 range 가능**.

### 3.3 ALM (Active Liquidity Management) 비교 (2026-04)

| 매니저 | 특징 | 수수료 |
|---|---|---|
| **Arrakis** | 동적 range, 자동 리밸런싱 | 운영 수수료 |
| **Gamma** | Hypervisor 패턴 | 운영 수수료 |
| **Steer Protocol** | 다전략 매니저 | 운영 수수료 |
| **Maverick** | 방향성 유동성 | 프로토콜 내장 |

직접 관리 vs ALM 선택 기준: 포지션 크기 × 리밸런싱 빈도 × 가스비 > ALM 운영 수수료면 ALM 사용.

### 3.4 BTC LP 전략 (BobClaw 우선)

- **cbBTC/LBTC** (correlated) on Aerodrome: 좁은 range 가능, IL 최소
- **cbBTC/USDC** on Aerodrome: 넓은 range, 페이백 회계 관점에서 USDC 비중 주의
- **wBTC.OFT/wBTC.OFT** (same asset cross-chain): pair가 성립하면 IL 0, 하지만 실제 풀 존재 여부 확인 필요

### 3.5 IL 헷지 (고급, 소액 단계 부적합)

- Perp short으로 한쪽 토큰 익스포저 상쇄 (델타중립)
- 바이너리 옵션 (Dopex, Lyra)
- Dynamic rebalancing (range 이탈 시 즉시 close + re-open)

소액 단계에서는 가스비 대비 편익 부족 → **소액 단계는 correlated pair 좁은 range + 단순 보유** 조합 권장.

---

## 4. BTCfi 핵심 (BobClaw 직결)

### 4.1 프로토콜 비교 (2026-04)

| 프로토콜 | TVL | Yield 출처 | APY | 감사·이력 |
|---|---|---|---|---|
| **Babylon** | **$3.6B** (피크 $7B) | BSN 검증 + BABY 토큰 | GRR **1–2%** | 감사 완료 |
| **Lombard LBTC** | ~$1.5B, 15+ 체인 | Babylon staking | **~1%** (8% perf fee 후) | Chainlink PoR 2026-02-05 |
| **Solv solvBTC** | ~$1.7B (24,226+ BTC) | 래퍼 (무수익) | 0% | CertiK/SlowMist/Quantstamp. 2026-03-03 BRO 별건 |
| **Solv xSolvBTC** | subset | Babylon + basis + Core + AI | **4.2–7.8%** (상한 23%) | xSolvBTC 자체 사고 없음 |
| **Pell** | 수만 BTC | Restaking AVS/DVS + PELL | 포인트 중심 | Yes |
| **Bedrock uniBTC** | $338.91M | Babylon+Pell+Kernel+SatLayer | 2–5% + 포인트 | Chainlink PoR, 2024-09 $2M 이력 |

**핵심 인사이트**: Babylon이 BTCfi 실수익 원천(1–2%). LBTC/xSolvBTC/brBTC는 모두 Babylon 래퍼. **고APY는 대부분 토큰 인센티브** — BobClaw 회계는 포인트/토큰 분리 측정(AGENTS.md Reporting의 paper/estimated/realized 구분).

### 4.2 Moonwell cbBTC on Base (`wrapped-btc-loop-base-moonwell` 근거)

- 현재 cbBTC collateral_factor=0.81 (Gauntlet 2026-04 0.85 상향 제안 진행 중)
- HF 1.5 제약 하의 LTV_max = 0.81 / 1.5 = **0.54**
- 이 값은 `src/config/strategy-caps.mjs`의 `wrapped-btc-loop-base-moonwell` 엔트리와 일관 유지

### 4.3 Morpho cbBTC/USDC on Base

- market id: `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` (Base)
- LLTV: 0.86
- 결합 TVL (2026-04): $2.55B
- 루프 대상 후보이지만, `stable-entry-exit-loops`가 `measured_no_edge`로 분류된 이유 중 하나 — cbBTC→USDC→cbBTC 루프의 측정된 엣지가 아직 음수

### 4.4 Pendle PT 고정수익 (참고)

- **PT-LBTC** 26-Dec-2024 만기: 6.98% fixed (2025-03 측정)
- **PT-eBTC** 58d 만기: 4.73% fixed
- Pendle v3 Boros는 별도 트랙. funding rate / basis 시장.

---

## 5. Bitcoin L2 비교 (컨텍스트)

| L2 | TVL | 특징 |
|---|---|---|
| Bitlayer | $400M+ | BitVM 사이드체인 |
| Merlin | $1.7B 피크 | ZK Rollup, 중앙화 Cobo 커스터디 |
| CoreDAO | 상위권 | Satoshi Plus |
| B² Network | $369M | ZK Rollup |
| Stacks | ~$208M | Nakamoto sBTC, Clarity |
| **BOB** | $10.17M DeFi / $66M bridged / ~$152M ecosystem peak | OP Stack + Kailua + BitVM(초기 mid-2026) + Gateway 11 체인 |

BobClaw는 **BOB 전용**(Gateway 경로). 다른 L2는 리서치 대상이지 현재 집행 대상 아님.

---

## 문서 이력

- 2026-04-17: v3 가이드라인 Part 3·4·5·9 재구성. $500-5K 소액 전제 제거(실제 per-strategy cap으로 enforce). BTC denominated 수식을 sats 단위로 명시.
