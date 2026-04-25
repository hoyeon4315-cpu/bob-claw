# 자율 BTC 운용 에이전트 — 설계 플랜

> 문서 주체: 이 파일은 사람(운영자) + 여러 AI 코딩 도구(Claude, Codex, Copilot, 기타)가 함께 읽고 이어서 발전시키는 **살아있는 설계 문서**다. 마지막 수정이 최신이 아니라 최신 코드 상태와의 일관성이 최신 여부를 결정한다. "현재 시스템 상태" 섹션의 사실관계는 실제 repo와 대조해 항상 검증하고, 어긋나면 이 파일부터 고칠 것.
>
> 작성 시작: 2026-04-15 (Claude Opus 4.6)
> 연관 파일: [AGENTS.md](../AGENTS.md), [src/risk/policy.mjs](../src/risk/policy.mjs), [docs/current-status.md](current-status.md), [docs/dashboard-context.md](dashboard-context.md)

---

## 0. 목적 (North Star)

> **네이티브 BTC 한 가지만 들고 시작해서, 여러 체인 · 여러 프로토콜 · 여러 자산군에 자동 배분하고, 리스크를 수동 감시 없이 스스로 관리하며 BTC가 "일하는" 상태를 유지하는 자율 에이전트.**

세부 요건:

- 시작 인벤토리: **네이티브 BTC만**. 다른 체인의 wrapped-BTC, 스테이블, ETH, XAUT 등은 전부 에이전트가 스스로 스왑/브리지로 획득.
- BOB Gateway 인프라를 1차 라우팅 레이어로 적극 사용.
- CEX 는 사용하지 않음 (키 분리, 상대방 리스크, 인출 제한).
- 단일 프로토콜 몰빵 금지. 해킹 · 급격한 유동성 감소 · 오라클 고장에 대비해 포트폴리오 분산 및 자동 철수 필수.
- 단일 수익률 상위 전략에 자본을 모두 배정하지 않음. **리스크-조정 수익(risk-adjusted)** 기준으로 배분.
- 모든 실행 결정은 on-chain 관찰 가능한 측정값 기반. LLM 은 실행 경로에 들어가지 않음.

---

## 1. 사용 원칙 (이 문서를 읽는 모든 에이전트 대상)

1. **수정 가능 범위**: 이 파일은 누구나 수정 가능. 단 "§3 현재 시스템 상태" 와 "§8 안전 가드레일" 항목을 변경할 때는 근거(파일 경로+line number, 테스트 결과, 측정 데이터)를 인라인으로 남길 것.
2. **검증 우선**: 이 문서가 어떤 전략이 "지원된다" 라고 말해도, 실제 파일/테스트가 그걸 뒷받침하지 않으면 이 문서가 틀린 것이다. 먼저 문서를 고친 뒤 코드 작업에 착수할 것.
3. **오픈 섹션**: `§OPEN-*` 로 표시된 섹션은 AI/사람이 아이디어를 추가하는 자리다. 채워지면 표시를 `§CLOSED-*` 로 바꾸고 요약으로 정리.
4. **언어**: 한국어를 기본, 코드/필드/명령은 영문 그대로. 장문 로직 설명은 어느 쪽이든 무방.
5. **범위 규율**: "전체 시스템"을 한 번에 구현하지 말 것. §4 Phase 단위로 끊고, 각 Phase 종료 시 체크리스트 통과 후 다음 Phase.

---

## 2. 제약 (Hard Constraints)

- ✅ **허용**: BOB Gateway, BOB Mainnet 위 on-chain 프로토콜, Ethereum · Base · BNB · Avalanche · Berachain · Solana(추후) 등 Gateway 연결 체인 위 검증된 DeFi, LayerZero / CCIP 수준의 크로스체인 메시징, lending loop · 온체인 perps 를 포함한 레버리지 전략, 현물/스왑, LP 포지션, 스테이킹.
- ❌ **금지**: 중앙화 거래소(Binance, Coinbase, Bybit 등) 사용. 사용자 서명이 필요한 매 거래 개입(에이전트는 자체 서명자를 가짐). Private key 를 LLM 프로세스·대시보드·Telegram 핸들러가 보유. 무한 approval. 무감사 프로토콜(audit 없거나 TVL 극소). Martingale/streak-based 사이징. LLM 이 실행 판단 분기에 직접 개입.
- 🟡 **조건부**: 레버리지 전략은 per-strategy config 에 `healthFactorMin`, `liquidationBufferPct`, `unwindTriggerHealthFactor`, `perTradeCapUsd`, `maxLoopIterations`, `maxLtvPct` 를 선언해야 live 승격 가능 — 값 누락 시 자동으로 live 거부.

---

## 3. 현재 시스템 상태 (2026-04-15 기준)

> 변경 시 코드와 대조해서 업데이트.

### 3.1 정책 · 런타임 게이트

- 리스크 정책 schema v2 ([src/risk/policy.mjs](../src/risk/policy.mjs)):
  - `projectLossCapUsd: null` (링펜스 제거)
  - `dailyLossCapUsd: null` (프로젝트 전역 기본 캡 없음, per-strategy 에서 선언)
  - `minNetProfitUsd: 0`, `minNetProfitPct: 0` (양수 EV 만 요구)
  - `maxConsecutiveFailures: 3`, `maxFailedGasCost24hUsd: 3` (유지)
  - `leverage: { allowed: true, healthFactorMin: null, liquidationBufferPct: null }` (per-strategy override 전제)
- 실행 게이트: [src/risk/execution-gate.mjs](../src/risk/execution-gate.mjs) 는 위 null-tolerant 처리됨.
- 대시보드 `liveTrading` 플래그: [src/status/dashboard-status.mjs](../src/status/dashboard-status.mjs) 의 `decideOverall` 가 blockers 가 없으면 `ALLOWED`.
- 컨트랙트 하한 아직 존재: [src/contracts/BalancerFlashArb.sol:58](../src/contracts/BalancerFlashArb.sol) — `minProfitUsdc = 300000` (USD 0.30). 플래시-arb 경로는 재배포 전까지 0.30 하한 유지.

### 3.2 전략 카탈로그 (코드에 존재)

- [src/strategy/](../src/strategy/) 아래 ~40개 모듈. 주요:
  - `btc-proxy-spreads` — wrapped BTC 패밀리 간 proxy spread (WBTC/wBTC.OFT/uniBTC)
  - `dex-gateway-arbitrage` — Gateway 경유 DEX 아비
  - `cross-asset-arbitrage` — 자산간 아비
  - `stablecoin_entry_exit_loops` (pivot) — 스테이블↔BTC 라운드트립
  - `triangular_flash_btc` — 삼각 플래시 아비
  - `gateway_wrapped_btc_loops` — BOB Gateway 경유 wrapped BTC 루프
  - `gateway_base_btc_yield` (blueprint) — Base 체인 BTC yield
  - `wrapped_btc_lending`, `stablecoin_lending_carry` — 단순 lending 포지션 (재귀 아님)
  - `lending-loop-research` (신규 stub) — 재귀 supply/borrow 설계 placeholder
- 포트폴리오 · 할당기 레이어 (부분 존재): `destination-allocation-planner`, `destination-scoring`, `destination-truthfulness-gate`, `destination-promotion-gate` 등 — 아직 "여러 전략 동시 운용하며 리스크 분산" 을 관장하지는 않음.

### 3.3 인프라

- 서명자/실행자: [src/cli/canary-live.sh](../src/cli/canary-live.sh) + Balancer Flash Arb 컨트랙트. 현재 플래시-arb 위주.
- DEX 라우팅: Odos 화이트리스트 ([src/dex/odos.mjs](../src/dex/odos.mjs)).
- 오라클-기반 DEX 블랙리스트 (revert 방지) 이미 적용.
- Shadow/replay harness 존재. Fork execution harness 부분 존재.
- 컨트랙트 서명 주소: 운영자 보관.

### 3.4 현재 남아있는 측정값

- 대부분의 측정된 루프가 과거 USD 0.30 + 0.50% 하한 기준으로 `measured_below_policy` 로 분류됨.
- **→ 이제 0 floor 기준으로 재분류가 필요**. §4 Phase 1-B 가 이것.

---

## 4. Phase 로드맵

### Phase 1 — 재검증 (Re-validation under relaxed policy)

**목표**: 완화된 정책 하에서 현재 전략 카탈로그의 실제 실행 가능성과 과적합 여부를 다시 평가.

- **1-A. 과적합 재검사**
  - `npm run audit:overfit` 를 relaxed policy 기준으로 재실행.
  - 샘플 수 부족한 lane 표시.
  - Walk-forward / out-of-sample 분리가 강제되는지 확인 ([src/audit/overfit.mjs](../src/audit/overfit.mjs)).
  - **출력**: 각 lane 별 `passes_overfit_gate` boolean + 근거.
  - **Open question**: in-sample vs out-of-sample 기간 분리 기준이 지금 어떻게 되어있는지? 단순 최근 N 샘플 holdout 이면 편향 위험.

- **1-B. 수익 재분류**
  - 모든 `measured_below_policy` lane 을 새 policy (`minNetProfitUsd=0`) 로 재판정.
  - 가스+슬리피지 variance 측정치 필요. 현재 추정치만 있고 measured variance 가 없는 lane 은 `needs_variance_measurement` 로 분류.
  - **출력**: `data/lane-reclassification.json` (신규). 각 lane: `status_old`, `status_new`, `net_pnl_measured_usd`, `gas_slippage_variance_usd`, `clears_new_floor`.

- **1-C. 가스+슬리피지 variance 측정기**
  - 지금 단일 추정값만 있음. 실제로는 같은 루트의 여러 실행에서의 분산이 필요.
  - 제안: 최근 N개 실행(shadow + canary 포함)의 `effectiveSystemNetPnlUsd` 표준편차를 구해 2σ 를 variance 로 사용.
  - **새 모듈**: `src/risk/gas-slippage-variance.mjs`.

- **1-D. 남은 on-chain 하한 처리 결정**
  - `BalancerFlashArb.sol` 의 0.30 하한을 유지/재배포/owner-settable 중 선택.
  - 재배포 비용 · 감사 영향 평가 후 운영자 결정 필요.
  - **Open question**: 이 하한이 실제로 플래시-arb path 외의 전략에도 영향을 주는가?

**Phase 1 통과 기준**: 모든 현재 전략이 `passes_overfit_gate + clears_new_floor_when_measured` 두 boolean 으로 라벨링되고, 운영자가 재배포 결정을 명시.

---

### Phase 2 — 신규 전략 모색

**목표**: 완화된 정책 하에서 성립 가능한 새 전략을 설계 카탈로그에 올리되, 구현 순서는 §6 포트폴리오 기준에 따라 정한다.

> 이 Phase 는 "구현" 이 아니라 "설계 카탈로그 추가" 다. 각 전략은 [src/strategy/lending-loop-research.mjs](../src/strategy/lending-loop-research.mjs) 와 동일한 shape 의 placeholder 모듈로 먼저 등록.

#### 현재 운영 플랜에 끼워 넣는 방식

- **Gateway route 는 transport lane 이다**: Gateway quote/exact gas/fork evidence 는 native BTC 를 각 전략 장소로 보내고 다시 BTC 로 회수하기 위한 기반 증명이다. route 자체가 양수 alpha 를 만들지 못하면 primary 에 계속 세우지 않고 infrastructure/reevaluation lane 으로 내린다.
- **primary lane 은 증거가 가장 강한 수익 전략이 맡는다**: 현재 route alpha 가 `policyReady=0` 또는 순효과 음수이면, same-chain lending/yield 같은 전략 증적 lane 이 review primary 가 된다. 이때 route proof 는 전략의 입출금·payback settlement 조건으로만 유지한다.
- **레버리지 루프는 병렬 검증 lane**: `recursive_wrapped_btc_lending_loop` 는 완화된 정책에서 허용된 leverage 후보이므로, canary 준비와 병렬로 Phase 3 validation lane 에서 계속 증거를 쌓는다.
- **지금 당장의 다음 액션은 구현 확대가 아니라 증거 적재**: 최신 validation 기준 다음 액션은 `collect_recursive_loop_observed_receipts` 이며, signer-backed receipt 를 확보하기 전에는 planning lane 으로만 취급한다.
- **live 승격 전 필수 조건**: `recursive_observed_receipts_missing` 해소, `auto_unwind` runtime 배선, protocol adapter/binding 확인, declared HF/LTV/buffer caps 검증이 모두 선행돼야 한다.

#### 멀티체인 / 멀티프로토콜 루프의 우선순위 판단

- **결론**: 지금 당장은 `나중` 이다. 멀티체인 이동과 멀티프로토콜 노출 자체는 포트폴리오 레벨에서 계속 설계·측정하되, **하나의 unified recursive loop executor** 로 묶는 일은 현재 크리티컬 패스가 아니다.
- **지금 해야 할 것**:
  - same-chain concrete lane (`Base/Moonwell`, `Base/Morpho` 등) 에서 signer-backed receipt, auto-unwind, exact unwind cost, native BTC return path 를 먼저 증명.
  - allocator 레벨에서 per-chain / per-protocol / per-asset-family cap 과 reserve movement 를 강화.
  - cross-wrapper / stable-entry / reserve sleeve 는 별도 sleeve 또는 rebalance 문제로 취급.
- **지금 미루는 것**:
  - bridge + lending market + swap + unwind 를 한 개의 live recursive loop 안에 동시에 넣는 구조.
  - 여러 체인의 담보/부채 상태를 하나의 health-factor 개념으로 묶어 실시간 제어하는 구조.
  - 프로토콜/체인 실패와 브리지 실패를 동시에 포함하는 first-live unified loop rollout.
- **나중에 할 조건**:
  - same-chain loop 에서 signer-backed observed receipts 확보
  - auto-unwind runtime + emergency stop + native BTC 복귀 경로 검증
  - chain / protocol / oracle exposure 합산 cap enforcement 구현
  - reserve movement 와 treasury refill 이 receipt-backed feedback loop 로 연결
- **원칙**: `cross-chain movement is an allocator concern first, not a recursive loop concern first.`

#### 2-A. Claude 가 제안하는 후보군

각 항목: `{id, arrival_family, leverage?, expected_risk_bucket, why_it_fits, what_to_build, open_questions}`.

1. **Recursive wrapped-BTC lending loop (Aave/Dolomite/Avalon)**
   - leverage=yes. BTC-collateralized, stable-borrow, swap→re-supply loop.
   - risk_bucket: medium (liquidation 리스크, 하지만 BTC 담보라 peg 리스크 낮음).
   - what_to_build: Aave v3 adapter, Dolomite(Arb) adapter, Avalon (BOB) adapter, health-factor watcher, unwind executor.
   - open_questions: wrapped BTC 패밀리(WBTC vs LBTC vs cbBTC vs wBTC.OFT)별 담보 계수 · LTV · 청산 수수료 측정 필요. 어느 렌딩이 BOB 위에서 native 지원하는지 별도 조사.

2. **Stablecoin spread loop (Aave/Fluid/Euler on Base, Morpho)**
   - leverage=yes. Supply USDC, borrow USDT, swap back, loop.
   - risk_bucket: low-medium. peg 리스크가 주요 변수.
   - open_questions: stable-to-stable swap 의 실현 슬리피지가 borrow 스프레드를 갉아먹는 지점이 어디인지.

3. **BTC LST / LRT 수익 취합**
   - LBTC(Lombard), uniBTC(BedRock), eBTC(Ether.fi), solvBTC, suBTC — restaking 수익 수집 + Pendle PT/YT 로 타임-프리퍼런스 분리.
   - risk_bucket: medium-high (LST depeg, restaking slashing 리스크).
   - what_to_build: LST adapter, Pendle adapter, PT yield lock strategy, YT leverage strategy.

4. **Tokenized treasury / gold reserve sleeve (XAUT, PAXG, ONDO USDY, Backed bIB01)**
   - leverage=no. 단기간 ETF-like 수익. BTC 전량 노출의 변동성을 낮추는 역할.
   - risk_bucket: low (법률/발행자 리스크는 별도).
   - 용도: 포트폴리오의 **저변동 앵커**. §6 의 "protocol-agnostic reserve" 로 사용.
   - open_questions: XAUT/PAXG on-chain 유동성이 실제로 unwind 가능한 사이즈인가?

5. **BOB 네이티브 수익**
   - BOB Gateway 수수료 수취자 여부, BOB 체인 자체의 LP/스테이킹 인센티브, Avalon(BTC lending on BOB) 수익.
   - risk_bucket: medium (신생 체인, TVL 변동).
   - why_it_fits: 사용자가 BOB 인프라를 적극 활용하라고 명시. BOB native 가 1st-class 레일.
   - open_questions: BOB 자체 보상/에어드랍 프로그램이 현재 활성인지, 운영자가 참여 의사 있는지.

6. **Cross-wrapper triangular arb**
   - cbBTC vs WBTC vs LBTC vs tBTC 간 peg 편차를 이용한 삼각 아비. Flash loan + rebalance.
   - risk_bucket: medium. 수수료/슬리피지 매우 민감.
   - what_to_build: 지금 `btc-proxy-spreads` 를 확장. 더 많은 wrapper × 더 많은 chain.

7. **On-chain BTC perps basis**
   - GMX/Hyperliquid/Vertex/Synthetix perp v3 (on-chain only) 에서 BTC perp funding rate 수취.
   - leverage=yes. Perp short + spot long (또는 LST long) → delta-neutral funding carry.
   - risk_bucket: medium (funding flip 리스크, 거래소별 상대방 리스크가 on-chain 에도 존재).
   - open_questions: 어느 on-chain perp venue 가 TVL · 감사 · 주소 검열 측면에서 적격인가.

8. **Pendle PT locked yield**
   - PT 를 만기까지 holding 하여 고정 수익. BTC LST/스테이블 PT 가 주요.
   - risk_bucket: low-medium. 만기 전 조기 청산 시 가격 변동 리스크.
   - what_to_build: Pendle SDK adapter, PT maturity tracker, rebalance on maturity.

9. **Liquidity provision (BTC/stable, BTC/ETH, BTC/LST)**
   - Uniswap v3 집중 유동성, Aerodrome, Maverick.
   - risk_bucket: high (IL, 가격변동 직접 노출).
   - 기본은 배제. delta-hedge 가 갖춰지기 전엔 추천 안 함.

10. **Ether.fi / Eigenlayer restaking (ETH side)**
    - BTC → WBTC → ETH swap → restake 경로.
    - risk_bucket: high (slashing, depeg, 긴 unbonding).
    - 장기 앵커. 단기 전략 아님.

#### §OPEN-2-B: 다른 AI / 사람이 추가할 후보

> 다른 코딩 도구(Codex, Copilot, GPT-5 등)나 사람이 이 섹션에 후보를 추가. 추가 시 포맷:
>
> ```
> N. **Strategy name**
>    - proposer: <agent-name or human>
>    - leverage: yes/no
>    - risk_bucket: low/medium/high
>    - why_it_fits: 1–2 lines
>    - what_to_build: 구체적 모듈/어댑터
>    - open_questions: 측정/설계 미결 항목
> ```
>
> 추가 시 BOB 인프라 활용 여부와 non-CEX 조건을 반드시 만족해야 함.

---

### Phase 3 — 과적합 · 유효성 재검증 (before capital)

**목표**: Phase 2 에서 채택된 전략 후보에 대해 실제 자본을 쓰기 전 과적합 게이트 통과.

- **3-A.** 각 신규 전략에 대해 in-sample / out-of-sample 분리 강제. 정책: 최소 30% OOS 보유.
- **3-B.** 파라미터 탐색이 있었다면 탐색한 파라미터 개수 × 시도 횟수 대비 샘플 수 확인. `search_complexity / sample_count < 0.05` 아니면 reject.
- **3-C.** Synthetic shock test: 가스 +3×, 슬리피지 +5×, 오라클 가격 ±10% 쇼크 시 예상 PnL 재계산. 어느 시나리오에서도 `ruin probability > 5%` 면 reject (ruin = 전략별 per-trade cap 초과 손실).
- **3-D.** 각 전략이 의존하는 프로토콜의 ["trust tier"](#7-프로토콜-신뢰도-티어) 승급 기준 만족.

---

### Phase 4 — 포트폴리오 매니저 에이전트 (Allocator)

**목표**: 여러 전략을 동시 운용하면서 리스크 분산, 해킹/유동성 이벤트 시 자동 철수, BTC-denominated 기준 리밸런싱 을 담당하는 실행 계층.

#### 4-A. 목적 함수

단순 max(expected_return) 이 아니라:

```
maximize  Σ w_i · r_i
subject to
    Σ w_i = 1
    w_i  ≤ cap_per_strategy
    w_i  ≤ cap_per_protocol     (여러 전략이 같은 프로토콜 의존 시 합산)
    w_i  ≤ cap_per_chain
    w_i  ≤ cap_per_asset_family
    Σ w_i · σ_i ≤ target_volatility
    Σ w_i · drawdown_worst_i ≤ tolerable_drawdown
```

제안 기본값 (운영자 오버라이드):
- `cap_per_strategy = 20%`
- `cap_per_protocol = 25%` (단일 프로토콜에 25% 이상 금지)
- `cap_per_chain = 40%`
- `cap_per_asset_family = 50%` (BTC wrappers 합산, stables 합산, LST 합산)
- `target_volatility` — BTC HODL 대비 80% 수준 (완전 delta-neutral 목표 아님, BTC 계열이라 BTC 변동성을 일부 수용)
- 저변동 앵커(XAUT, ONDO USDY 등) 최소 비중 5% — 충격 시 인출 가능한 브릿지 자본.

#### 4-B. 리밸런싱 트리거

- **Scheduled**: 24h 주기 기본.
- **Event-driven**:
  - 프로토콜 ["emergency_signal"](#7-프로토콜-신뢰도-티어) 감지 → 해당 프로토콜 노출 0 으로 철수.
  - TVL 24h 감소 > 30% → 노출 절반 축소.
  - Utilization rate (렌딩) > 95% → 신규 진입 정지, 기존 포지션 unwind 대기 큐.
  - Health factor 버퍼 침범 → 즉시 unwind.
  - 오라클 편차 > 2% → 해당 오라클 의존 전략 일시 정지.
- 리밸런싱 action 은 [src/strategy/destination-allocation-planner.mjs](../src/strategy/destination-allocation-planner.mjs) 의 확장으로 구현.

#### 4-C. 실행 파이프라인 (설계)

```
inventory observer  → portfolio optimizer  → rebalance orders
       ↓                    ↑                       ↓
  on-chain reads       risk state reader      execution gate
       ↑                    ↑                       ↓
  protocol signals     allocation history      signer / executor
```

- 각 단계는 별도 프로세스. Optimizer 는 권고만 내고, execution gate 가 최종 가드.
- LLM 불개입: optimizer 는 결정론적 알고리즘 (QP solver 또는 단순 closed-form).

#### §OPEN-4-D: Optimizer 구현 선택

> Codex/Copilot 이 다음 중 어느 것을 쓸지 조사 후 채워 넣을 것:
> - 자체 구현 (simplex + cap clipping)
> - `quadprog-js` 등 외부 라이브러리 (npm, audited?)
> - Rust WASM 모듈
>
> 선택 근거와 테스트 전략 기록.

---

### Phase 5 — 실전 검증 (End-to-end dry run, BTC-only starting inventory)

**목표**: "BTC만 들고 있다" 초기 조건에서 전 시스템이 *실제로* 돌아가는지 검증. 막히는 지점(stuck points)을 나열하고 해결.

#### 5-A. 시나리오

1. 운영자 지갑에 native BTC 만 존재 (가령 0.01 BTC).
2. 에이전트가 BOB Gateway 경유 wrapped BTC 로 브리지. 어느 wrapper / 어느 chain 으로 갈지는 allocator 가 결정.
3. 착지 후 배분:
   - BTC LST (스테이킹 수익) — 포트폴리오 앵커
   - wrapped BTC recursive lending loop
   - stablecoin spread loop (일부 BTC → stable swap)
   - XAUT/PAXG reserve sleeve
4. 1주일 hold + monitor.
5. 중간에 인위적 이벤트 주입:
   - 한 프로토콜의 TVL 이 급감했다고 가정 → 자동 철수 확인.
   - 오라클 편차 이벤트 → 관련 전략 정지 확인.
   - 한 체인의 가스 3× 스파이크 → 실행 중지 확인.
6. 에이전트 명령: "모두 unwind 해서 native BTC 로 복귀" → BTC 회수까지 경로 및 시간 측정.

#### 5-B. 기대 산출물

- `data/e2e-dry-run-<date>.jsonl` — 각 의사결정 + 실행 이벤트 + 상태 스냅샷.
- "stuck point" 리스트. 예:
  - "wrapped BTC → native BTC 복귀 경로가 없는 chain X 에 포지션 들어가면 복귀에 Gateway 미지원 경로 필요."
  - "Pendle PT 만기 전 조기 철수 시 가격 충격이 7% 이상."
  - "BOB Avalon 의 unwind 유동성이 \$2k 초과 시 급락."
- 각 stuck point → backlog 티켓.

#### 5-C. 통과 기준

- 모든 시뮬레이션 이벤트에서 자동 철수 동작 확인.
- 최종 "모두 native BTC 로 복귀" 경로가 실현되고 총 손실이 선언된 `tolerable_drawdown` 이내.
- LLM 이 실행 판단에 개입한 이벤트 0 건.

---

## 5. 시스템 구성도 (논리)

```
┌───────────────────────────────┐
│       Operator (human)        │
│  - sets caps, tiers, budgets  │
│  - reviews dashboard & logs   │
└──────┬────────────────────────┘
       │ config
       ▼
┌──────────────────────────┐    ┌───────────────────────┐
│  Portfolio Optimizer     │◀──▶│  Risk State Reader    │
│  (deterministic)         │    │  - inventory, HF, TVL │
└──────┬───────────────────┘    └───────────┬───────────┘
       │ rebalance plan                     │
       ▼                                    ▼
┌──────────────────────────┐    ┌───────────────────────┐
│   Execution Gate         │    │  Protocol Signal      │
│   (risk policy enforcer) │◀──▶│  Watcher              │
└──────┬───────────────────┘    └───────────────────────┘
       │ approved orders
       ▼
┌──────────────────────────┐
│  Signer / Executor       │
│  (flash-arb contract +   │
│   strategy adapters)     │
└──────┬───────────────────┘
       │ on-chain tx
       ▼
┌──────────────────────────┐
│  Receipt Reconciler      │
│  → data/receipts.jsonl   │
└──────────────────────────┘
```

LLM (Claude / Codex / Copilot) 은 이 파이프라인의 **어느 박스 안에도 들어가지 않는다**. LLM 은 이 문서 · 코드 · 로그를 읽고 새 adapter/strategy/테스트를 *작성* 할 뿐, 실행 중 판단에 개입하지 않음.

---

## 6. 포트폴리오 분산 · 리스크 관리 상세

### 6-A. 분산 축

1. **전략 축**: per-strategy cap.
2. **프로토콜 축**: 같은 프로토콜을 여러 전략이 의존할 수 있음 (예: Aave 에 lending loop 와 stable carry 둘 다). **노출 합산 후** cap 적용.
3. **체인 축**: 한 체인이 해킹/셧다운 되면 그 위 모든 포지션이 위험.
4. **자산 패밀리 축**: WBTC family, LST family, stable family, gold family.
5. **오라클 축**: 같은 오라클(Chainlink/Pyth) 을 쓰는 전략 그룹.

### 6-B. 포지션 사이징 공식 (기본)

각 전략 i 에 대해:
```
raw_weight_i  = risk_parity_weight(σ_i, ρ_ij)
               · tier_multiplier(trust_tier_i)
               · liquidity_capacity_i / portfolio_size

w_i = min(raw_weight_i, cap_per_strategy, cap_per_protocol_share, …)
then  normalize so Σw_i = 1
```

- `risk_parity_weight`: 각 전략의 위험 기여를 같게 맞추는 고전 risk-parity. 공분산 행렬은 과거 PnL 시계열에서 추정.
- `tier_multiplier`: Tier A = 1.0, Tier B = 0.6, Tier C = 0.25 (§7).
- `liquidity_capacity_i`: unwind 가능한 실제 사이즈. TVL 의 1% 또는 30-day median daily volume 의 5% 중 작은 쪽.

### 6-C. 자동 철수 트리거

| 신호 | 액션 |
|---|---|
| 프로토콜 governance attack / exploit confirmed | 전면 unwind |
| 프로토콜 TVL 24h 감소 > 50% | 즉시 unwind |
| 프로토콜 TVL 24h 감소 > 30% | 노출 50% 축소 |
| 렌딩 utilization > 95% | 신규 진입 정지, 인출 대기열 진입 |
| 오라클 편차 > 2% (해당 프로토콜 기준) | 관련 포지션 정지 |
| Health factor < `unwindTriggerHealthFactor` | 해당 루프 unwind |
| 체인 가스 24h p95 > 5× baseline | 해당 체인 신규 실행 중단 |
| Stablecoin peg 편차 > 1% 지속 | 해당 stable 계열 포지션 축소 |

각 트리거는 [src/watch/](../src/watch/) 아래 watcher 로 구현. 현재 `gateway-update-watch.mjs` 만 존재 — 프로토콜/TVL/오라클 watcher 는 신규.

### 6-D. 인벤토리 최소 복귀 자본

- 항상 `min_native_btc_reserve` (기본 10% of portfolio) 를 native BTC 또는 즉시 unwind 가능 형태로 유지.
- 어느 한 계층이 모두 사라져도 이 reserve 로 복귀 가능.

---

## 7. 프로토콜 신뢰도 티어

| Tier | 기준 | 예시 | 최대 포트폴리오 비중 |
|---|---|---|---|
| **A** | 3+년 live, 2+ 독립 감사, 주요 사고 0, TVL > \$500M | Aave v3, Compound v3, Uniswap v3, Lido | 전략 비중 cap 그대로 |
| **B** | 1–3년 live, 1+ 감사, 주요 사고 0, TVL > \$50M | Morpho, Pendle, Dolomite, Lombard | cap × 0.6 |
| **C** | < 1년 또는 소규모 TVL 또는 감사 1회 미만 | 신생 BOB 네이티브 프로토콜, fresh LST | cap × 0.25, 총 노출 10% 상한 |
| **X** | 감사 없음 / 미확인 / 사고 이력 미해결 | — | **금지** |

티어는 분기마다 재평가. Tier 조정 시 기존 포지션 강제 축소.

---

## 8. 안전 가드레일 (절대 침해 불가)

> 이 섹션 변경은 운영자 명시 승인 필요.

1. Private key 는 서명자/실행자 프로세스에서만 보유.
2. LLM 은 실행 경로 결정에 개입하지 않음.
3. Emergency stop 파일 체크가 모든 live tx 선행 조건.
4. 무한 approval 금지. 각 approval 은 per-trade 금액 + 짧은 만료 기한.
5. 모든 leverage 전략은 declared `unwindTriggerHealthFactor` + `emergency unwind path (fork-tested)` 없으면 live 거부.
6. CEX 사용 금지.
7. 하나의 프로토콜 / 하나의 체인 / 하나의 오라클 에 대한 총 노출이 §6-A 의 cap 을 초과하지 않음.
8. 모든 전략은 native BTC 복귀 경로를 가져야 함. 한 방향 경로만 있는 전략은 live 거부.
9. Stale quote 거부.
10. 수익은 *측정값 기반* 으로만 주장. paper/estimated/realized 구분 유지.

---

## 9. 관측 · 로깅 · 감사 요구사항

- 모든 의사결정은 `data/allocator-decisions.jsonl` 에 기록. 입력 상태 → 계산된 가중치 → 실행된 주문 → 결과.
- 모든 tx 는 `data/receipts.jsonl` 과 `data/execution-journal.jsonl` 에 기록.
- 모든 트리거 이벤트는 `data/risk-events.jsonl`.
- 주간 감사 스크립트 (신규): `npm run audit:portfolio -- --week` — 주간 PnL, 드로다운, cap 위반, 전략별 기여도 리포트.

---

## 10. 다른 AI / 사람 검토자가 해 줄 일 (명시적 Ask)

> 이 섹션은 의도적으로 열어둠. 읽은 AI/사람이 아래 중 하나라도 수행하고 이 파일에 기록:

- **10-A.** §3 "현재 시스템 상태" 가 실제 코드와 일치하는지 재검증. 불일치 찾으면 인라인 수정.
- **10-B.** §4 Phase 2 에 전략 후보 추가 (§OPEN-2-B).
- **10-C.** §Phase 3 의 synthetic shock test 파라미터(3×, 5×, ±10%) 가 너무 느슨/타이트 한지 판단.
- **10-D.** §6-B 의 risk-parity 공분산 추정 방법이 적절한지 평가. 대안 (Ledoit-Wolf shrinkage, hierarchical risk parity) 검토.
- **10-E.** §7 티어 기준이 누락한 축이 있는지 (거버넌스 토큰 집중도, upgrade 권한, timelock 길이 등).
- **10-F.** §8 가드레일에서 누락된 케이스 — 특히 on-chain perp 사용 시 funding rate 조작 리스크, MEV 리스크.
- **10-G.** 이 플랜 전체가 **BTC holder 의 실제 니즈**를 반영하는지 재검토. 수익성보다 원금 보전을 더 우선해야 하는 상황이면 cap 을 더 조여야 함.
- **10-H.** 이 문서가 지나치게 ambitious 한지 (한 번에 구현 불가능한 범위인지) 판단하고, 있다면 최소 운용 가능 범위(MVP)를 제안.

검토 기록은 이 파일 맨 아래 "검토 이력" 섹션에 `<날짜> <에이전트> <섹션>: <요약>` 형식으로 append.

---

## 11. 관련 파일 (현재 코드에서 참고)

- [AGENTS.md](../AGENTS.md) — 운영 규칙 (완화 적용됨)
- [src/risk/policy.mjs](../src/risk/policy.mjs) — 런타임 정책 (schema v2)
- [src/risk/canary-guard.mjs](../src/risk/canary-guard.mjs), [src/risk/execution-gate.mjs](../src/risk/execution-gate.mjs) — 게이트
- [src/status/dashboard-status.mjs](../src/status/dashboard-status.mjs) — 상태 집계 (liveTrading 조건부)
- [src/strategy/](../src/strategy/) — 기존 전략 카탈로그
- [src/strategy/lending-loop-research.mjs](../src/strategy/lending-loop-research.mjs) — Phase 2 후보용 placeholder
- [src/audit/overfit.mjs](../src/audit/overfit.mjs) — 과적합 감사
- [src/prelive/](../src/prelive/) — 사전 검증 파이프라인
- [src/contracts/BalancerFlashArb.sol](../src/contracts/BalancerFlashArb.sol) — 실행 컨트랙트 (0.30 하한 존재)
- [docs/current-status.md](current-status.md) — 운영 브리프
- [docs/dashboard-context.md](dashboard-context.md) — 대시보드 규칙

---

## 12. 비범위 (이 문서가 다루지 않음)

- 대시보드 UI/UX 개편 — 운영자 명시: "대시보드 작업은 나중".
- CEX 통합 — 항구적 금지.
- 사용자 KYC / 법률 / 세무 처리.
- Bitcoin L1 Ordinals / Runes / L1 DeFi 직접 거래 (Gateway 를 항상 경유).

---

## 검토 이력

| 날짜 | 에이전트 | 섹션 | 요약 |
|---|---|---|---|
| 2026-04-15 | Claude Opus 4.6 | all | 최초 작성. 정책 완화 직후. |
| — | — | — | (다음 검토자 기입) |
