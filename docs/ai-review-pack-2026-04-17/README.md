# BOB Claw 객관적 시스템 설명서

작성일: 2026-04-17  
기준 산출물 시각: 주로 2026-04-17 00:57 UTC 전후 생성 리포트 사용  
문서 목적: 다른 AI가 BOB Claw의 현재 구조, 검증 상태, 전략 상태, 소액 라이브 실행 기록, 남아 있는 블로커를 주관적 해석 없이 파악할 수 있도록 현재 저장소 산출물을 한 문서로 묶는다.

## 1. 시스템 정의

BOB Claw는 현재 시점에서 다음 세 층이 결합된 시스템이다.

1. `BTC / wrapped BTC / stablecoin / ETH-family` 경로를 측정하는 멀티체인 라우트 계측 시스템
2. 전략별 증거를 수집하고 정책 게이트를 통과시킬 때만 실행을 허용하는 정책 기반 실행 시스템
3. 실거래, 섀도우, 드라이런, 분석 상태를 분리해 관리하는 unattended executor 구조

이 시스템은 단순한 단일 arbitrage bot이 아니다. 현재 저장소 기준으로는 다음 특성이 확인된다.

- 멀티체인 Gateway 경로 재고와 점수화
- 전략 카탈로그 및 전략별 실행 표면 분리
- 정책 엔진과 서명 데몬 분리
- 자본 재배치와 가스 플로트 유지 로직 보유
- 실거래 영수증/정산 증빙을 별도 산출물로 보관
- 대시보드는 읽기 전용 상태 노출만 담당

## 2. 현재 공식 상태 요약

### 2.1 기준 리포트

- `npm run report:strategy-catalog -- --json`
- `npm run report:strategy-execution-surfaces -- --json`
- `npm run report:strategy-snapshot -- --json`
- `npm run report:capital-audit -- --json`
- `dashboard/public/dashboard-status.json`

### 2.2 현재 상태 스냅샷

| 항목 | 현재 값 |
| --- | --- |
| 전체 심각도 | `blocked` |
| `liveTrading` | `BLOCKED` |
| `shadowTrading` | `ALLOWED` |
| 현재 prelive stage | `shadow_replay` |
| 활성 canary route | `avalanche->bera wBTC.OFT->wBTC.OFT` |
| canary amount | `10000` sats |
| canary trade readiness | `insufficient_data` |
| 전체 Gateway route 수 | `113` |
| 활성 chain 수 | `10` |
| BOB touching route 수 | `19` |
| 구현된 전략 수 | `8` |
| 실행 가능한 전략 수 | `8` |
| 현재 live eligible 전략 수 | `0` |

### 2.3 현재 canary 입력 상태

`dashboard/public/dashboard-status.json` 기준:

- `gatewayQuote`: `stale`
- `exactGas`: `stale`
- `srcGas`: `stale`
- `marketSnapshot`: `stale`
- `dexQuote`: `blocked`
- `dexQuote.failureReason`: `odos_chain_not_supported`
- 전체 live 블로커: `audit_blocks_live`, `stale_gas_snapshots`

즉 현재 시스템은 섀도우/리서치 관측은 허용하지만, 공식 live 승격 상태는 아니다.

## 3. 아키텍처

## 3.1 실행 아키텍처 구성요소

저장소의 실행 구조는 다음과 같이 분리되어 있다.

| 구성요소 | 역할 | 주요 경로 |
| --- | --- | --- |
| Proposer | 전략 모듈이 trade intent 생성 | `src/strategy/`, `src/executor/helpers/` |
| Policy Engine | intent를 순수 함수 정책으로 검증 | `src/executor/policy/` |
| Signer Daemon | 정책 통과 intent만 서명/브로드캐스트 | `src/executor/signer/daemon.mjs` |
| EVM Signer | EVM 키 파일 경로를 통해 서명 | `src/executor/signer/evm-local-signer.mjs` |
| BTC Signer | BTC 키 파일 경로를 통해 PSBT 서명 | `src/executor/signer/btc-local-signer.mjs` |
| Capital Manager | 체인별 목표 잔고/재배치 계획 생성 | `src/executor/capital/rebalancer.mjs` |
| Gas Float Keeper | 체인별 최소 native gas 잔고 유지 | `src/executor/capital/gas-float-keeper.mjs` |
| Receipt Ingestor | 브로드캐스트 결과를 자동 ingest | `src/executor/ingestor/receipt-auto-ingest.mjs` |
| Watchdog | 데몬 heartbeat 기록 및 감시 | `src/executor/watchdog/` |
| Signer Audit Log | append-only 감사 로그 | `src/executor/signer/audit-log.mjs`, `logs/signer-audit.jsonl` |

## 3.2 키 보관과 서명 경계

코드와 운영 규칙 기준으로 다음이 확인된다.

- EVM signer는 `BURNER_EVM_KEY_PATH` 또는 하위 호환 alias `BURNER_PRIVATE_KEY_PATH`에서만 키 파일을 읽는다.
- BTC signer는 `BURNER_BTC_KEY_PATH`에서만 키 파일을 읽는다.
- 키 값 자체는 저장소 구성요소에 하드코딩되지 않는다.
- 대시보드는 키를 보관하지 않으며, 서명 권한도 없다.
- `dashboard-status.json`의 `exposurePolicy`는 `containsPrivateKeys=false`, `containsWalletSigning=false`, `containsExecutionPermission=false`를 기록한다.

## 3.3 정책 엔진

`src/executor/policy/index.mjs` 기준 intent 평가는 다음 5개 정책을 결합한다.

1. kill-switch 확인
2. cap check
3. health factor check
4. stale quote check
5. approval hygiene check

blocker가 하나라도 있으면 정책 verdict는 `BLOCK`이다.

## 3.4 감사 로그

`src/executor/signer/audit-log.mjs` 기준 모든 sign/broadcast/error는 append-only JSONL로 기록된다.

기록 필드:

- `timestamp`
- `strategyId`
- `chain`
- `intentId`
- `intentHash`
- `policyVerdict`
- `lifecycle`
- `broadcast`
- `realized`
- `error`

## 4. 리스크 통제와 실행 안전장치

운영 규칙과 현재 코드 기준으로 확인되는 핵심 통제는 다음과 같다.

- per-strategy cap은 코드에 존재하며 env가 아니라 `src/config/strategy-caps.mjs`에 선언된다.
- cap 없는 전략 intent는 signer가 허용하지 않도록 설계되어 있다.
- `autoExecute: true`인 전략만 unattended 실행 후보가 된다.
- kill-switch는 파일 기반이며 tx 전마다 체크된다.
- unlimited approval는 금지되어 있고, per-tx approval 패턴을 사용한다.
- 레버리지 전략은 `healthFactorMin`, `liquidationBufferPct`, `emergencyUnwindPath`가 필요하다.
- stale quote는 전략별 `intentTtlMs`로 거절된다.
- max failed gas cost 24h 예산이 존재한다.
- max daily loss cap이 존재한다.
- 연속 실패 3회 시 auto-pause가 운영 규칙으로 정의되어 있다.
- drawdown kill-switch가 운영 규칙으로 정의되어 있다.
- LLM은 코드 작성/설계에는 관여할 수 있지만 서명 결정 경로에는 들어가지 않는다.

## 4.1 예시 전략 cap

`src/config/strategy-caps.mjs` 기준 일부 주요 실행 helper cap 예시는 다음과 같다.

| strategyId | autoExecute | perTxUsd | perDayUsd | maxDailyLossUsd | 비고 |
| --- | --- | ---: | ---: | ---: | --- |
| `gateway-btc-onramp` | true | 75 | 300 | 20 | BTC -> Gateway 진입 |
| `gateway-btc-offramp` | true | 50 | 200 | 20 | wrapped BTC -> native BTC 정산 |
| `native-dex-experiment` | true | 15 | 75 | 10 | native -> wrapped -> token |
| `token-dex-experiment` | true | 15 | 75 | 10 | ERC20 -> ERC20 |
| `proxy-spread-experiment` | true | 25 | 100 | 12 | BTC wrapper spread 실험 |
| `wrapped-btc-loop-base-moonwell` | true | 300 | 600 | 50 | leverage config 포함 |

`wrapped-btc-loop-base-moonwell`은 leverage 항목으로 다음을 가진다.

- `healthFactorMin = 1.35`
- `liquidationBufferPct = 12`
- `emergencyUnwindPath = ["repay borrow asset", "withdraw collateral", "bridge or swap back to settlement path"]`

## 5. 현재 측정/검증 파이프라인

현재 시스템은 아래 순서로 데이터를 축적한다.

1. Gateway route inventory 수집
2. quote 수집
3. gas estimate 및 market snapshot 수집
4. score 계산
5. shadow observation 축적
6. current-route prelive pass 계산
7. evidence campaign / simulation / fork 준비
8. 정책 통과 시 signer 실행
9. destination-side proof 또는 BTC balance delta로 정산 검증

## 5.1 누적 데이터 카운트

`dashboard/public/dashboard-status.json` 기준:

| 항목 | 수량 |
| --- | ---: |
| route records | 68 |
| quotes | 438 |
| quote failures | 15 |
| gas snapshots | 274 |
| gas failures | 10 |
| price snapshots | 42 |
| DEX quotes | 596 |
| DEX failures | 255 |
| gateway gas estimates | 23 |
| gateway gas estimate failures | 19 |
| estimator wallet readiness samples | 115 |
| estimator wallet readiness failures | 27 |
| shadow observations | 3115 |
| prelive simulation runs | 1 |
| prelive fork plans | 0 |
| prelive fork submissions | 0 |
| prelive fork receipts | 0 |
| execution journal events | 34 |
| shadow refresh batches | 20 |
| connected refresh runs | 10 |
| current route prelive passes | 10 |
| prelive evidence campaigns | 12 |

## 5.2 전략 카탈로그 디스패치

`data/strategy-dispatch-summary.json` 기준:

- 최근 실행 batch는 `selectedCount=8`, `succeededCount=8`, `blockedCount=0`, `failedCount=0`
- 요약상 8개 카탈로그 lane 모두 dispatcher에서 실행되지만, 현재 `liveEligibleCount=0` 이므로 live 강행이 아니라 shadow / analysis / dry-run으로 내려간다.

## 6. 구현된 전략 8개와 현재 상태

### 6.1 전략 상태 분포

`report:strategy-catalog` 기준 분포:

- `analysis_only`: 3
- `thin_coverage`: 1
- `measured_below_policy`: 2
- `unobserved`: 2

### 6.2 BTC 계열 전략

| id | 라벨 | 현재 상태 | 현재 근거 |
| --- | --- | --- | --- |
| `gateway_wrapped_btc_loops` | Gateway wrapped-BTC loops | `analysis_only` | `measuredClosedLoopCount=0`, `profitableClosedLoopCount=0`, best measured route는 `base wBTC.OFT -> ethereum WBTC`, 현재 이유는 `measured_no_edge` |
| `btc_proxy_spreads` | BTC proxy spread arbitrage | `thin_coverage` | `opportunityCount=19`, `policyReadyCount=0`, `overfitAssessment=high_overfit_risk`, best rebalance opportunity는 `WBTC/wBTC.OFT` |
| `stablecoin_entry_exit_loops` | Stablecoin entry/exit loops | `measured_below_policy` | `matchedLoopCount=0`, `closedLoopCount=0`, 이유는 `amount_mismatch` |
| `triangular_flash_btc` | BTC triangular / flash arbitrage | `measured_below_policy` | `sampleCount=1`, best route는 `USDC→tBTC→cbBTC→USDC`, `bestNetPct=-0.0851`, 최신 verdict는 `latest_flash_negative` |

### 6.3 ETH 계열 전략

| id | 라벨 | 현재 상태 | 현재 근거 |
| --- | --- | --- | --- |
| `eth_family_gateway` | Direct ETH-family Gateway branch | `unobserved` | `gatewayRouteCount=32`이지만 실제 `routeCount=0`, `measuredClosedLoopCount=0` |
| `eth_mixed_stable_loops` | Mixed ETH/stable loops | `unobserved` | `entryCount=0`, `exitCount=0`, `exactAssetPairCount=0` |
| `eth_dex_spread_mixed` | ETH DEX spread / mixed triangle branch | `analysis_only` | `sampleCount=1`, best route는 `USDC→cbBTC→WETH→USDC`, `bestNetPct=-0.0507` |
| `eth_mixed_flash` | ETH mixed flash-loan branch | `analysis_only` | 위 mixed triangle 샘플을 공유하며 `liveAdmission=blocked_pending_contract_review` |

### 6.4 현재 실행 표면

`report:strategy-execution-surfaces` 기준:

- 총 전략 수: 8
- 실행 가능한 전략 수: 8
- `liveEligibleCount=0`
- `missingExecutorCount=0`
- capability bucket은 전부 `dry_run_or_shadow_only`
- 선택된 실행 모드 분포:
  - `shadow`: 3
  - `analysis`: 3
  - `dry_run`: 2

즉 "실행기 자체가 아예 없는 전략" 문제는 현재 보고서 기준으로 없다. 하지만 "live eligibility"는 모든 전략에서 아직 0이다.

## 7. 전략별 상세 메모

## 7.1 Stablecoin entry/exit loops

`report:stable-loop-executor -- --json` 기준:

- 상태: `quote_refresh_required`
- laneStatus: `measured_inside_variance_floor`
- exact match count: `0`
- closed loop count: `0`
- positive closed loop count: `0`
- selected loop의 `amountGapPct = 44.49590536851684`
- selected loop의 `loopNetEdgeUsd = 137.779`
- 하지만 `gasSlippageVarianceUsd = 254746.35471`
- readiness:
  - `readyForExecutorDryRun = true`
  - `readyForLive = false`

즉 apparent edge 숫자가 존재해도 현재 폐루프가 닫히지 않았고 amount ladder mismatch가 크기 때문에, live 근거로 쓰이지 않는다.

## 7.2 Recursive wrapped-BTC lending loop

`report:recursive-lending-loop -- --json` 기준:

기본 설계:

- strategy id: `recursive_wrapped_btc_lending_loop`
- chain: `base`
- protocol: `moonwell`
- collateral: `cbBTC`
- borrow asset: `USDC`
- `perTradeCapUsd = 300`
- `targetHealthFactor = 1.65`
- `healthFactorMin = 1.35`
- `liquidationBufferPct = 12`
- `unwindTriggerHealthFactor = 1.3`
- `maxLoopIterations = 4`
- `maxLtvPct = 62`
- stage: `design_scaffold`

현재 상태:

- `executionSupport.status = repo_auto_build_supported`
- `dryRunSummary.runCount = 5`
- `dryRunSummary.passedCount = 5`
- `readyForDryRun = true`
- `readyForLive = false`

예상 진입 계획:

- initial collateral USD: `300`
- projected health factor: `1.8787`
- projected liquidation buffer: `34.6102%`
- looped exposure multiple: `1.6486`
- total collateral USD: `494.58`
- total debt USD: `194.81`

PnL 표현:

- `paper.annualNetCarryUsd = 5.6144`
- `estimated.valueUsd = 5.6144` with `sampleCount=5`
- `realized.valueUsd = 5.6144` with `sampleCount=5`

여기서 `realized`는 이 리포트 정의상 `simulated_dry_run_receipts`이며, live carry가 아니다.

## 7.3 Yield / allocator planning layer

`report:strategy-snapshot -- --json` 기준 planning layer 요약:

- pivot count: `5`
- top pivot: `gateway_base_btc_yield`
- top pivot 상태: `pre_execution_blueprint`
- yield shadow book 상태: `pre_execution_only`
- top paper profile: `research_pilot`
  - required capital: `105`
  - paper daily base scenario USD: `0.013699`
  - paper 30d base scenario USD: `0.410959`
- allocator candidate count: `5`
- active allocation count: `0`
- top planning candidate: `wrapped-btc-loop-base-moonwell`

## 8. 리서치 보드와 보조 전략 스캐폴드

## 8.1 현재 리서치 보드

`report:strategy-research-board -- --json` 기준:

- candidate count: `6`
- 상태 분포:
  - `candidate_for_design`: 2
  - `research_priority`: 2
  - `deferred`: 1
  - `research_backlog`: 1

주요 후보:

| id | 상태 | 핵심 내용 |
| --- | --- | --- |
| `recursive_wrapped_btc_lending_loop` | `candidate_for_design` | wrapped BTC leverage loop, runtime cap + watcher + unwind receipt 필요 |
| `destination_wrapped_btc_rotation` | `research_priority` | wrapped BTC 목적지 회전/배치 |
| `recursive_stablecoin_lending_loop` | `candidate_for_design` | stablecoin leverage loop |
| `stablecoin_treasury_rotation` | `research_priority` | BTC -> stable treasury sleeve |
| `gateway_proxy_spread_rebalance_recheck` | `deferred` | wrapper coverage와 overfit-safe sample 필요 |
| `macro_asset_rotation` | `research_backlog` | ETH / macro asset destination rotation |

## 8.2 Secondary strategy scaffolds

`report:secondary-strategy-scaffolds -- --json` 기준:

- scaffold count: `4`
- leverage count: `2`
- 상태 분포:
  - `research_blocked`: 1
  - `design_scaffold`: 3

현재 스캐폴드:

| id | category | leverage | 상태 |
| --- | --- | ---: | --- |
| `stablecoin_spread_loop` | yield | true | `research_blocked` |
| `proxy_spread_expansion` | arbitrage | false | `design_scaffold` |
| `tokenized_reserve_sleeve` | macro_rotation | false | `design_scaffold` |
| `onchain_btc_perp_basis` | yield | true | `design_scaffold` |

## 9. 소액 라이브 실전 기록

이 절은 저장소의 실행 로그와 감사 리포트에서 직접 확인되는 실전 기록만 적는다.

## 9.1 Gateway wrapped-BTC cross-chain delivery proof

주요 산출물:

- `data/gateway-btc-consolidation-executions.jsonl`
- `data/gateway-btc-consolidation-plan-latest.json`
- `data/capital-audit.json`

주요 전달 성공 기록:

| 관측 시각 (UTC) | route | source tx | amount | settlement | destination proof |
| --- | --- | --- | ---: | --- | --- |
| 2026-04-16T04:28:08.958Z | Base `wBTC.OFT -> BOB wBTC.OFT` | `0x47357ec6143433a97414a2d4d923d6fbe3204338fd8b61fcc6923d8fa00ddcc9` | 1000 sats | `delivered` | `erc20_balance_delta`, observed `1000` / required `1000` |
| 2026-04-16T06:08:02.118Z | Base `wBTC.OFT -> BOB wBTC.OFT` | `0x7f0ce235d68c08ac26da5b4c1624616d5713e4915cc6446cd10b7a3cf05504a6` | 4000 sats | `delivered` | observed `4000` / required `4000` |
| 2026-04-16T06:29:43.037Z | BOB `wBTC.OFT -> Avalanche wBTC.OFT` | `0x2017bcaa09869fa19ef32ffe256dae745014d9fbcfa6348be4e29a1a6019c497` | 5000 sats | `delivered` | observed `5000` / required `5000` |
| 2026-04-16T06:34:22.912Z | Base `wBTC.OFT -> BOB wBTC.OFT` | `0x1de854fd4620377d3c7ad069ef0656d6447235c0bd2846c2b74757db72248674` | 5000 sats | `delivered` | observed `5000` / required `5000` |
| 2026-04-16T06:35:25.532Z | BOB `wBTC.OFT -> Sonic wBTC.OFT` | `0x4c2d4bcfd9287f4500cdc067eadd254e0c3742df484fb735905391251e31f464` | 5000 sats | `delivered` | observed `5000` / required `5000` |
| 2026-04-16T19:22:23.575Z | Base `wBTC.OFT -> BSC wBTC.OFT` | see execution log | 1000 sats | `delivered` | observed `1000` / required `1000` |
| 2026-04-16T19:23:34.969Z | Base `wBTC.OFT -> Bera wBTC.OFT` | see execution log | 1000 sats | `delivered` | observed `1000` / required `1000` |
| 2026-04-16T21:02:22.755Z | Base `wBTC.OFT -> Soneium wBTC.OFT` | see execution log | 1000 sats | `delivered` | observed `1000` / required `1000` |
| 2026-04-16T21:03:01.615Z | Base `wBTC.OFT -> Unichain wBTC.OFT` | see execution log | 1000 sats | `delivered` | observed `1000` / required `1000` |

같은 산출물에는 `soneium` / `unichain`에 대한 `signer_rejected` 시도도 기록되어 있다. 즉 실전 기록은 성공과 거절을 모두 남긴다.

## 9.2 Gateway wrapped-BTC -> native BTC off-ramp proof

주요 산출물:

- `data/gateway-btc-offramp-executions.jsonl`
- `data/gateway-btc-offramp-plan-latest.json`
- `data/capital-audit.json`

자본 감사 리포트 기준 주요 delivered 기록:

| observedAt (UTC) | srcChain | source tx | recipient BTC address | source amount | expected sats | observed sats | matched BTC txid |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-04-16T06:20:15.395Z | Base | `0x125e4a547538d7908b87f1630d84b0261fe6a39c9bd6a50c2899d06952071ae3` | `bc1qpkdq...` | 5000 | 4549 | 4549 | `46fa83bcfb8c9ff2a9d77e04ddf92a19ccb03b7b2a614b4818985ccbe36c78b9` |
| 2026-04-16T06:32:14.606Z | Avalanche | `0xcbb1ee322e40508414aabcb4c60a383fb978bba3fc7928d73b2dd6cfa5b95b21` | `bc1qpkdq...` | 5000 | 4330 | 4330 | `2dacd28e0a2a7153b42c2596367424a4e7eb316a87f2d2359aaae8162bdd884d` |
| 2026-04-16T06:39:16.619Z | Sonic | `0xb4349802173ad6e66f091a85e8977242895e85796f92421184c7cdd6270a2f08` | `bc1qpkdq...` | 5000 | 4330 | 4330 | `7094d300e7828082a41335c1827022ff235c40e39ab62dd9fbe77fdfa806790f` |
| 2026-04-16T22:37:58.512Z | Base | `0x880e10aea73512a4f0bd4494621d979bd5dd972e3d3da5b8d8762c7c4130dcb6` | `bc1p809t...` | 1800000000000000 units | 5187 | 5187 | `cafbffe9842d2aa0d95b6ae54dea29ec6418920f95188d697968b6a1fc9b3ab5` |

최신 `gateway-btc-offramp-plan-latest.json`의 `execution.destinationProof`는 다음을 기록한다.

- proof source: `bitcoin_address_balance_delta`
- initial balance: `0`
- settled balance: `5187`
- observed delta: `5187`
- required delta: `5187`
- attempts: `7`

## 9.3 Native asset DEX live proofs

주요 산출물:

- `data/native-dex-experiment-executions.jsonl`

기록된 delivered 실행:

| chain | wrap tx | approve tx | swap tx | router | output | observed delta | required delta |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| Base | `0xcb5137f64c5060b56fb93ac507703dc97a94314faecde5e264dbbde2ecc02913` | `0xeb9593efc35986526d74a68a46349845a30cb33e69e072b4a1d3ef34afd87b34` | `0x397ffcf5e984b3e4e9804c2297cae0637e5fe3736514744e733bbe115c9086a4` | `0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05` | USDC | 235835 | 234656 |
| Sonic | `0x6788f121acf64547e96dd21eb76158a68c37cfb3ad8e196a8267f4689d19a89e` | `0xa8534a5a79500049a459bdca706325909fefa122f6066359f0ab3a05ccfc880d` | `0x94781c91291adec169ddcd284d307060af2b9192eafe01476a7c4961a2cdac31` | `0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05` | USDC | 44439 | 44216 |
| Avalanche | `0xc9302e84b72a886af806556b11fe57a2597fa370e81cdba09b95d629b840706c` | `0xcdb7813abdd1fecf39a5197dfa7d0c38cdd6d918d2da863cdc7c794b359921a6` | `0x42cd9de4c90adb55b408fecb3733407882e46a67ceb856f43853d0cdf7cef6d2` | `0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05` | USDC | 95126 | 94650 |

모든 row는 `settlementStatus=delivered`, `proofSource=erc20_balance_delta`이다.

## 9.4 Token DEX live proofs

주요 산출물:

- `data/token-dex-experiment-executions.jsonl`

기록된 delivered 실행:

| chain | input | output | approve tx | swap tx | router | observed delta | required delta |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| Base | `wBTC.OFT` | `cbBTC` | `0x21ebee953d94e1ab5fc5c869e246b5d2f7fac5b92b0fba6c0619df09078b23a9` | `0x59b33b1bbe7b0f7faad0a9e9888cb8fade3579d73b342fe5d98c6f9fcaade395` | `0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05` | 9974 | 9937 |
| Base | `wBTC.OFT` | `USDC` | `0x0c1e9f999a8d8445a34af90096aff2305f11cc8ccec49e7e8f53756656e30848` | `0x0f8fc0b9f7079015f77bef48c2d14cdfcc4d833e7e054d495a9bc7c7f38d7ed3` | `0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05` | 3737610 | 3718921 |
| Base | `wBTC.OFT` | `USDC` | `0x6d66e087734e54051a93643d97cc2c808aa290cd82e210d2b607d616e18b7fad` | `0x6da319416a1661dc143f2b5ded291c926173134265e34861d28cce997b896396` | `0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05` | 2989679 | 2975874 |

## 9.5 Wrapped-BTC lending loop signer-backed roundtrip

주요 산출물:

- `data/wrapped-btc-loop-live-success-latest.json`

기록 요약:

- strategy id: `wrapped-btc-loop-base-moonwell`
- scenario id: `healthy_baseline`
- proof kind: `signer_backed_roundtrip`
- proof status: `signer_backed_roundtrip_recorded`
- `perTradeCapUsdOverride = 7`
- entry tx 수: `8`
- unwind tx 수: `4`
- `actualLoopFeesUsd = null`
- `actualUnwindCostUsd = null`
- `realizedNetCarryUsd = null`
- `oosReceiptStatus = extended_receipt_context_pending`

entry tx hashes:

- `0x02cd8d9ad99b027b5b034d30cd21040f07c5ed2fdb4261a9a96401cb884c0729`
- `0x9667252ca1981c420f20c7038d77a3eebe8557f79f2a41257870034c10b5502a`
- `0x017500266d9a48df4aa98c84b52338846e05d1d778512643f5459b085ef808dc`
- `0x038eaee50f21f3a01cbcfcd81d0a82ca3f74b31b4a1967e3a5f8c3021cebb590`
- `0x0cee88c032ad1adff9beb9e366b069d1ec746855aef901244ba6d3b4be30b87a`
- `0x312a36bfe735f97fd7c6be29016b6ef858678c7f19e9f647a030b29418cd4018`
- `0x23b71a75d9fa10f6651dbf9f31f683148cfd29ffe2ce537c4e63e1a2b66a7886`
- `0x13315791ef4c75bc7c87a037b57182e1ea29d25f98a5c482838eb6d350f133c8`

unwind tx hashes:

- `0x7d98ffa55cf7b2f231e337a52102efc141483cf45bc0c0110cd35f0a4805f08a`
- `0x6d12d4c0b9eb8d2d3b97471979e274af27a6eef99f384bda1dd7ab66fd9e9674`
- `0x28cf4c9f51889cc26c70ee56f6811a200ae7a55b4852e4549051a6e338fa3def`
- `0x41dc57831334ec7b8d4ead2d5e2dec91ec94109d95677d80a29770070015e4ec`

이 기록은 signer-backed roundtrip이 존재함을 보여주지만, 비용/순이익 필드는 아직 null이다.

## 10. 자본 감사 상태

`npm run report:capital-audit -- --json` 기준 최신 리포트는 `generatedAt=2026-04-17T00:57:28.915Z`, 상태는 `incomplete_traceability`이다.

요약 수치:

| 항목 | 값 |
| --- | ---: |
| broadcast count | 126 |
| broadcast with receipt count | 62 |
| helper matched count | 22 |
| unmatched broadcast count | 104 |
| bitcoin matched settlement count | 4 |
| bitcoin unmatched tx count | 1 |
| total gas USD | 0.11699679088898034 |
| total observed BTC sats | 18396 |
| current native BTC sats | 5187 |
| current combined USD | 45.70532186288273 |
| treasury snapshot count | 14 |
| treasury start USD | 25.016652970991096 |
| treasury end USD | 41.84297299523273 |
| treasury delta USD | 16.82632002424163 |
| combined delta USD | 20.68866889189163 |
| issue count | 183 |

이 리포트는 소액 라이브 활동의 traceability를 한 곳에 모으지만, 동시에 helper trace가 아직 모든 브로드캐스트에 붙지 않았음을 명시한다.

대표 issue 유형:

- `broadcast_missing_helper_trace`
- `bitcoin_tx_unmatched_to_offramp`
- `gateway_quote_residual_unexplained`

따라서 자본 감사 리포트 자체가 현재의 온체인 활동을 "완전 정산 완료"가 아니라 "실행 기록은 있으나 traceability가 완전하지 않음"으로 분류한다.

## 11. 현재 블로커 요약

현재 저장소 산출물에 반복적으로 나타나는 블로커는 다음과 같다.

- `liveTrading=BLOCKED`
- 활성 canary route 입력 stale
- 활성 canary의 DEX quote blocked (`odos_chain_not_supported`)
- wrapped-BTC loop 계열은 `measured_no_edge`
- proxy spread 계열은 `high_overfit_risk`
- stablecoin loop는 `amount_mismatch`
- flash 계열은 `latest_flash_negative`
- ETH direct / mixed stable 계열은 아직 measured closed loop가 없음
- recursive lending loop는 설계/드라이런 단계이며 live 승격 전
- capital audit는 `incomplete_traceability`

## 12. 이 시스템이 현재 무엇까지 입증했는가

현재 저장소 산출물만 기준으로 확인 가능한 입증 범위는 다음과 같다.

1. Gateway route inventory, quote, gas, score, shadow, prelive 계산 파이프라인이 존재한다.
2. 정책 엔진과 signer daemon이 분리되어 있고, signer는 정책 verdict 후에만 동작한다.
3. per-strategy cap, stale quote, approval hygiene, health factor, kill-switch가 코드에 반영되어 있다.
4. wrapped-BTC cross-chain delivery는 destination-side ERC20 balance delta로 여러 체인에서 입증되었다.
5. wrapped-BTC -> native BTC off-ramp는 Base / Avalanche / Sonic에서 BTC address balance delta로 입증되었다.
6. native gas token -> wrapped native -> USDC DEX live proof가 Base / Avalanche / Sonic에 존재한다.
7. token-to-token DEX live proof가 Base에서 존재한다.
8. wrapped-BTC lending loop는 signer-backed roundtrip 기록과 dry-run 기반 설계/수치 모델이 존재한다.

반대로 현재 산출물이 아직 입증하지 않은 것도 명확하다.

1. 구현된 8개 전략 중 현재 live eligible인 전략은 없다.
2. 활성 canary는 아직 stale input과 blocked DEX quote 상태다.
3. ETH 계열은 직접적인 measured positive closed loop가 없다.
4. stable loop는 exact closed loop가 아직 없다.
5. capital audit는 아직 `incomplete_traceability`다.

## 13. 참고 산출물 목록

다른 AI가 추가 분석할 때 우선 확인할 만한 파일 목록:

- 현재 상태
  - `docs/current-status.md`
  - `dashboard/public/dashboard-status.json`
  - `data/dashboard-status.json`
- 전략 상태
  - `npm run report:strategy-catalog -- --json`
  - `data/strategy-execution-surfaces.json`
  - `data/strategy-snapshot.json`
  - `data/strategy-pivot-plan.json`
- 전략 상세
  - `npm run report:stable-loop-executor -- --json`
  - `npm run report:recursive-lending-loop -- --json`
  - `data/secondary-strategy-scaffolds.json`
  - `data/strategy-research-board.json`
- 실전 실행 기록
  - `data/gateway-btc-consolidation-executions.jsonl`
  - `data/gateway-btc-offramp-executions.jsonl`
  - `data/native-dex-experiment-executions.jsonl`
  - `data/token-dex-experiment-executions.jsonl`
  - `data/wrapped-btc-loop-live-success-latest.json`
  - `data/execution-journal.jsonl`
  - `logs/signer-audit.jsonl`
- 감사/추적성
  - `data/capital-audit.json`
  - `npm run report:capital-audit -- --json`

## 14. 문서 작성 기준

이 문서는 다음 원칙으로 작성했다.

- 저장소 현재 산출물과 코드 경로를 기준으로 서술
- 전략/실행/라이브 증빙/블로커를 분리해서 기록
- 추정, 권고, 낙관/비관 평가를 넣지 않음
- 실거래 성공은 destination-side proof 또는 BTC balance delta가 있는 경우에만 기록
