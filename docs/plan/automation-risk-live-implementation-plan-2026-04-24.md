# BobClaw 자동 전략 배치 및 리스크 관리 — 구현 현황과 실전 계획

> 작성일: 2026-04-24
> 근거: `AGENTS.md`, `docs/codex-playbook.md`, 실제 코드/테스트/리포트 출력

---

## 1. 현재 구현 현황 (Inventory)

### 1.1 핵심 인프라 (완료)

| 구성요소 | 파일 | 상태 | 비고 |
|---|---|---|---|
| 서명 데몬 (EVM + BTC) | `src/executor/signer/` | 완료 | keystore 경로 환경변수 참조, nonce 관리, RBF |
| 정책 엔진 | `src/executor/policy/` (12개 모듈) | 완료 | kill-switch, cap-check, HF, stale-quote, consecutive-fail, approval-hygiene, concentration-guard, liquidity-watch, tiny-live-canary |
| 자본 관리자 | `src/executor/capital/` | 완료 | per-chain target balance, auto-rebalance, gas float keeper |
| 리시트 수집기 | `src/executor/ingestor/` | 완료 | 자동 append-only audit log |
| 알리터 (Telegram) | `src/notify/telegram.mjs` | 완료 | read-only, 서명/결정 경로 미개입 |
| 대시보드 | `dashboard/` | 완료 | schema v2, strategy-tick-status, mobile-first BTC 흐름도 |

### 1.2 페이백 엔진 (완료 — 코드 단계)

| 구성요소 | 파일 | 줄수 | 상태 |
|---|---|---|---|
| 스케줄러 | `src/executor/payback/scheduler.mjs` | 1,041 | 완료: cron, decision, composite plan, step execution, disbursement record |
| 누산기 | `src/executor/payback/accumulator.mjs` | 482 | 완료: pure function, 5 KPI, expansion gate, three-way receipt |
| 설정 | `src/config/payback.mjs` | 35 | 완료: sats 단위, regime multiplier, vol multiplier, emergency pause |

**페이백 현재 상태**: `scaffolded_active_carry`
**블로커**: `planned_payback_below_minimum` — 코드가 아니라 누적 이익 부족.

### 1.3 전략 카탈로그 (구현됐으나 전부 차단)

`run-strategy-tick.mjs`에 9개 어댑터 등록됨:

1. `beefy-folding-vault`
2. `pendle-pt-lbtc-base`
3. `aerodrome-cl-base`
4. `pendle-pt-solvbtc-bbn-bsc`
5. `berachain-bend-bex-bgt`
6. `gmx-v2-perp-basis-avax`
7. `stablecoin-spread-loop`
8. `proxy-spread-expansion`
9. `tokenized-reserve-sleeve`

**공통 상태**: `liveEligible = 0`, `capsConfigured = false`
**대표 블로커**: `vault_tvl_unobserved`, `vault_net_apy_unmeasured`, `no_signer_backed_receipts`, `gateway_quote_stale_or_unknown`

### 1.4 라우트/브리지 (완료)

- BOB Gateway 11개 공식 체인 onramp/offramp — live proof 보유
- Base → BOB L2 → Bitcoin L1 native BTC settlement — **end-to-end live proven**
- Across v3 quote client + write-side planner + refill job — 최근 커밋 (c517893)
- EVM Gateway BTC-family consolidation: `quote → estimateGas → gasLimit buffer → signer intent`

### 1.5 리스크/안전 장치 (완료)

- 파일 기반 kill-switch (`$KILL_SWITCH_PATH`)
- per-strategy consecutive-fail guard (3회 → auto-pause)
- drawdown kill-switch (`maxDailyLossUsd`)
- failed-gas budget guard (`maxFailedGasCost24hUsd`)
- stale-quote rejection
- no unlimited approvals (Permit2 / time-boxed)
- auto-escalation 금지 (martingale 차단)

### 1.6 Merkl 기회 자동화 (부분 구현)

| 구성요소 | 파일 | 상태 |
|---|---|---|
| 기회 감시 CLI | `src/cli/watch-merkl-opportunities.mjs` | 존재 |
| 기회 보고 CLI | `src/cli/report-merkl-opportunities.mjs` | 존재 |
| 캐나리 대기열 보고 | `src/cli/report-merkl-canary-queue.mjs` | 존재 |
| 오토파일럿 테스트 | `test/merkl-canary-autopilot.test.mjs` | 존재 |
| Discovery Watcher 설계 | `docs/research/merkl-opportunity-automation-plan-2026-04-22.md` | 문서 완료 |
| 공격적 회전 마스터플랜 | `docs/research/merkl-aggressive-rotation-master-plan-2026-04-22.md` | 문서 완료 |
| 1차 BTC 스크리닝 | `docs/research/merkl-btc-first-pass-2026-04-22.md` | 문서 완료 |

**Merkl 1차 스크리닝 결과**: Morpho Ethereum (WBTC 담보 / EURC 차입)만 `연구 후보` 통과. 나머지는 low TVL, managed vault, incentive mirage, LP executor 부재로 보류.

---

## 2. 남은 일과 개선점 (Gaps)

### 2.1 전략 실행 표면 (Strategy Execution Surface)

| 레인 | 현재 상태 | 주요 블로커 |
|---|---|---|
| BTC Gateway loops | `measured_below_policy` | route alpha 없음, positive edge 미확인 |
| BTC proxy spreads | `measured_below_policy` | thin/noisy coverage |
| BTC stable entry/exit | `measured_below_policy` | — |
| BTC triangular/flash | `measured_below_policy` | — |
| ETH-family Gateway | `thin_coverage` | multichain measured surface 없음 |
| ETH/stable mixed loops | `thin_coverage` | — |
| Wrapped-BTC lending loop | `operator_hold` | 운영자 판단: 경제성 불충분 |
| Lending-protocol looping | `operator_hold` | 동일 |

**핵심 문제**: 어떤 전략도 `liveEligible > 0`이 아님.
**의미**: 정책 엔진·서명 데몬·페이백 파이프라인은 모두 가동 가능하지만, **실제로 실행할 수 있는 전략 후보가 없다**.

### 2.2 캐나리/라이브 게이트

- `liveTrading: ALLOWED` (게이트 수준)
- `liveEligibleCount: None` (후보 부재)
- `shadowTrading: ALLOWED`
- 9개 strategy adapter 중 0개가 tiny-live-canary threshold 통과

### 2.3 테스트

| 항목 | 상태 |
|---|---|
| 테스트 프레임워크 | Node.js built-in test runner |
| 전체 테스트 파일 수 | 21개 `.test.mjs` |
| 알려진 실패 | `wrapped-btc-loop-live.test.mjs:152` (pre-existing) |
| 회귀 실패 | `strategy-snapshot.test.mjs:151`, `treasury-policy.test.mjs:26` (500 ≠ 1_000_000, cap 변경 미반영) |

### 2.4 페이백 엔진

- 코드는 완료됐으나 **실제 페이백 disbursement 없음**
- 누적 gross profit이 `minPaybackSats` (50,000 sats) 미만
- round-trip efficiency >90% 달성 기록 8회 consecutive 필요 → 현재 0회
- expansion gate (Base 이외 체인 확장) 닫힘

### 2.5 리스크 관리 개선점

| 영역 | 현재 | 개선 필요 |
|---|---|---|
| Concentration guard | 구현됨 | 실제 `currentAllocations` 주입 시점 명확화 필요 |
| Liquidity watch | 구현됨 | 실시간 on-chain 데이터 소스 연결 확인 필요 |
| Health factor 자동 unwind | 구현됨 | lending-loop 재진입 시 시뮬레이션 receipt 검증 필요 |
| Cap 변경 workflow | committed diff only | PR 템플릿/체크리스트 자동화 미흡 |

---

## 3. 실전까지의 구현 계획 (Roadmap)

### 단계 1: 즉시 고치기 (이번 주)

1. **회귀 테스트 복구**
   - `strategy-snapshot.test.mjs:151` 500 vs 1_000_000 — cap 변경 사항 테스트에 반영
   - `treasury-policy.test.mjs:26` 동일
   - `wrapped-btc-loop-live.test.mjs:152` pre-existing 실패 문서화 또는 모의 데이터 수정

2. **Merkl Discovery Watcher 가동**
   - `npm run watch:merkl-opportunities` 주기적 실행 확인
   - `data/merkl-opportunities-latest.json` 생성 확인
   - diff 이벤트 → `data/merkl-opportunity-events.jsonl` append-only 기록

3. **Merkl Normalizer + Prefilter 스캐폴드 → 코드화**
   - `src/strategy/merkl-opportunity-normalizer.mjs` (공통 schema 변환)
   - `src/strategy/merkl-opportunity-prefilter.mjs` (BTC-first, deterministic unwind, chain range, TVL floor)
   - `src/cli/report-merkl-canary-queue.mjs`와 연결하여 후보를 기존 strategy catalog 등록 흐름에 주입

### 단계 2: 첫 번째 live-eligible 전략 만들기 (2~3주)

**목표**: `liveEligibleCount ≥ 1`

**후보 1: Morpho Ethereum WBTC/EURC**
- Merkl 1차 스크리닝 유일 통과 후보
- deterministic lending-loop 구조 → 현재 policy engine과 직접 맞음
- 필요 작업:
  1. Morpho Ethereum contract binding / ABI wrapper
  2. `healthFactorMin`, `liquidationBufferPct` 측정 receipt 수집
  3. stablecoin unwind route (EURC → USDC → wBTC.OFT) 측정
  4. tiny live canary: dust 수준 진입 → entry receipt → 24h 후 exit receipt
  5. caps 설정 (`perTxUsd`, `perDayUsd`, `maxDailyLossUsd`) → committed diff
  6. strategy catalog에 등록 → `autoExecute: true` 선언

**후보 2: 기존 wrapped-BTC loop (operator_hold 해제 시)**
- 운영자가 `operator_hold`를 명시적으로 해제하는 committed diff 필요
- 현재 Base 잔고 `wBTC.OFT=0.00039244`, `ETH=0.005268731623361094` → 충분하지 않음
- Avalanche/Sonic consolidation 통해 Base로 추가 자금 이동 후 재검토

**선택 기준**: Morpho Ethereum이 더 빠를 가능성 높음 (새로운 binding이지만, lending-loop는 이미 `recursive-lending-loop-dry-run` 구조가 있음).

### 단계 3: 페이백 첫 disbursement (단계 2 완료 후)

**조건**: gross profit ≥ 50,000 sats, net payback ≥ min, round-trip cost ≤ 10%

1. **Accumulator 신뢰도 검증**
   - `snapshot(auditLogLines, receiptStore, config)` 회귀 테스트 보강
   - 빈 로그 → 0 값
   - 단일 payback record → KPI 정확성
   - 12개월 롤링 window → BYR/CG/TBR 계산 검증

2. **Scheduler end-to-end dry-run**
   - `runPaybackSchedulerTick({ execute: false })` → composite plan 생성 확인
   - `buildCompositePaybackPlan` → swap + bridge + offramp 3단계 quote 확인
   - `estimateCompositeCostSats` → offramp cost가 `plannedPaybackSats × 0.1` 이하인지

3. **첫 실제 실행**
   - `execute: true`로 주간 tick 실행
   - three-way receipt 확보: source tx hash → Gateway order id → Bitcoin txid
   - `buildPaybackDisbursementRecord` → audit log append
   - Dashboard KPI 업데이트 확인

### 단계 4: 다중 전략 운용 확장 (단계 3 이후)

1. **Merkl 기반 회전**
   - campaign `endTimestamp` 임박 시 자동 `stay / rotate / unwind` 판단
   - `merkl-opportunity-prefilter`에서 `campaignEndsAt` 기반 진입 차단
   - 새 기회 발견 시 tiny canary 자동 생성 + catalog 등록 시도

2. **체인 확장**
   - Base payback efficiency >90% 8회 consecutive 달성 확인
   - expansion gate 열리면 Avalanche, Sonic 등으로 profit-reserve 다변화

3. **자동화 레벨 업**
   - `run-strategy-catalog-dispatch`를 cron으로 주기 실행
   - `run-shadow-cycle`과 `runPaybackSchedulerLoop`를 동시에 daemon 실행
   - Watchdog heartbeat + Telegram alert 연결

---

## 4. 리스크 관리 강화 계획

### 4.1 실행 전 반드시 확인할 항목 (Pre-flight)

| 항목 | 확인 방법 | 책임자 |
|---|---|---|
| caps 선언 | `src/config/strategy-caps.mjs`에 per-tx/per-day/maxDailyLoss 명시 | committed diff |
| unwind path | dry-run receipt + entry→exit 전체 시뮬레이션 | 코드/정책 |
| health factor | on-chain 조회 + pre/post trade 시뮬레이션 | `hf-check.mjs` |
| kill-switch | `touch $KILL_SWITCH_PATH` → 즉시 halt 테스트 | 수동 |
| approval hygiene | Permit2 or time-boxed, `approval-hygiene.mjs` 통과 | 자동 |
| payback formula | `baseRatio × regimeMultiplier × volMultiplier` 수동 계산 대조 | 테스트 |

### 4.2 새로 추가하면 좋을 정책 모듈

| 모듈 | 목적 | 우선순위 |
|---|---|---|
| `drawdown-kill.mjs` | 24h realized PnL < `maxDailyLossUsd` 시 strategy halt | 중간 (cap-check 내에 일부 있음) |
| `protocol-exploit-watch.mjs` | `protocolExploitList` 대상 프로토콜 이상 감지 시 payback scheduler halt | 중간 |
| `mayer-multiple-oracle.mjs` | regime multiplier 결정을 위한 Mayer Multiple 200d MA 조회 | 낮음 (현재는 외부 주입 가정) |

---

## 5. 현재 단계 평가

**현재 단계: L4 (Testnet/fork/mechanical execution)** — 일부 L5 (tiny live canary) 요소 있음

### 이번에 확인한 것
- 페이백 엔진 코드 완성 (L7에 필요한 infrastructure는 거의 다 있음)
- 9개 strategy adapter 구현됐으나 전부 blocked
- Merkl 기회 자동화 문서·스캐폴드·일부 CLI 존재
- 정책 엔진 12개 모듈 전부 가동 가능
- 테스트 2개 회귀 실패 (cap 변경 미반영)

### 왜 아직 L5/L6/L7이 아닌지
1. **liveEligible 전략 0개**: 어떤 레인도 positive measured edge + signer-backed receipt를 동시에 만족하지 않음
2. **페이백 disbursement 0회**: 코드는 있으나 누적 profit이 minimum 미만
3. **Merkl normalizer/prefilter 미구현**: 문서는 있으나 runtime 코드가 아직 `src/strategy/`에 없음

### 다음 체크리스트
- [ ] 회귀 테스트 2개 고치고 green 유지
- [ ] Merkl watcher 출력 파일 확인 + normalizer/prefilter `.mjs` 구현
- [ ] Morpho Ethereum WBTC/EURC binding + tiny canary 계획 수립
- [ ] `report:payback-status` 실행 → accumulator pending sats 확인
- [ ] `npm run report:strategy-catalog -- --json`에서 `liveEligibleCount` 변화 추적

---

## 6. Merkl 자동화 실전 구현 순서 (상세)

### 6.1 Discovery Watcher → 실제 가동

```bash
# 현재 존재하는 명령
npm run watch:merkl-opportunities
npm run report:merkl-opportunities
npm run report:merkl-canary-queue
```

**할 일**:
1. `src/watch/merkl-opportunity-watch.mjs` (또는 기존 CLI)가 `data/merkl-opportunities-latest.json`을 갱신하는지 확인
2. diff 비교 → `data/merkl-opportunity-events.jsonl` append-only
3. cron 또는 `runPaybackSchedulerLoop`와 유사한 폴링 루프로 통합

### 6.2 Normalizer → Prefilter → Catalog Injection

**새 파일**:
- `src/strategy/merkl-opportunity-normalizer.mjs`
- `src/strategy/merkl-opportunity-prefilter.mjs`

**흐름**:
```
Merkl API raw → normalizer (common schema) → prefilter
  → (통과) → strategy catalog candidate → admission checklist
  → (탈락) → watchlist/archive with reason code
```

**Prefilter 규칙 (deterministic)**:
- `isBtcCollateral || isBtcDirect` — true 아니면 탈락
- `chain in GATEWAY_11 || chain in EXPANSION_CANDIDATES` — 아니면 탈락
- `tvlUsd >= MIN_TVL_FLOOR` (family별 상수, config에 선언)
- `campaignEndsAt - now >= MIN_REMAINING_DAYS` (기본 7일)
- `rewardTokenType !== 'POINT'` — POINT면 탈락
- `requiresLpManager === false` — managed vault면 탈락
- `unwindPathKnown === true` — repo에 binding 없으면 탈락

### 6.3 Campaign End 감시 + 회전

**새 파일**:
- `src/strategy/merkl-campaign-rotation-gate.mjs`

**책임**:
- `endTimestamp` 임박 (예: < 48h) 알림
- 현재 포지션이 해당 campaign에 노출돼 있는지 확인
- 회전 대상 후보 prefilter 통과 목록에서 선정
- `unwind intent` → policy → signer → receipt
- `re-entry intent` (새 campaign) → tiny canary → receipt 축적 → promotion

---

## 7. 결론

BobClaw는 **인프라와 정책 엔진이 L7(완전 무인 운용) 수준에 가깝게 완성**됐지만, **실제로 돈을 벌 수 있는 전략 레인이 0개**라 아직 L4~L5 사이에 머물러 있다.

가장 빠른 실전 진입 경로는:
1. Merkl discovery watcher 가동 → Morpho Ethereum 후보 확보
2. lending-loop binding + tiny canary → 첫 receipt
3. caps 설정 + `autoExecute: true` → 첫 live-eligible 전략
4. 수익 누적 → 페이백 첫 disbursement
5. 이후 Merkl 회전 자동화로 다각화

**즉시 시작할 수 있는 작업**: Merkl normalizer/prefilter 코드화 + Morpho binding 조사.
