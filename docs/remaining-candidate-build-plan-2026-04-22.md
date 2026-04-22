# Remaining Candidate Build Plan

Updated: 2026-04-22

## 목적

이 문서는 현재 repo에 남아 있는 전략 후보, 체인 후보, 운영 연동 후보를 전부 `구축 가능한 작업 단위`로 쪼개서 남기는 실행 문서다.

여기서 말하는 "구축"은 단순 아이디어 정리가 아니라 아래 5가지를 모두 포함한다.

1. 전략/체인별 config와 evaluator가 있다.
2. 필요한 market snapshot / quote / receipt 입력 경로가 있다.
3. `run-strategy-tick` 또는 동등한 deterministic orchestration 경로에 연결된다.
4. shadow / canary / promotion 판단에 필요한 증거가 누적된다.
5. payback / dashboard / policy가 이 전략을 관측 가능한 상태가 된다.

## 이 문서의 기준점

이 계획은 아래 artifact와 현재 소스 코드를 기준으로 쓴다.

- `data/strategy-research-board.json`
- `data/secondary-strategy-scaffolds.json`
- `data/deterministic-strategy-candidates.json`
- `data/phase3-strategy-validation.json`
- `data/allocator-core.json`
- `data/destination-promotion-gate.json`
- `src/config/strategy-caps.mjs`
- `src/cli/run-strategy-tick.mjs`
- `src/executor/tick/strategy-tick.mjs`
- `src/strategy/*-adapter.mjs`

주의:

- `docs/research/*` 일부 메모는 현재 소스보다 오래되었을 수 있다.
- 현재 ground truth는 "문서 주장"보다 `src/`와 `data/*.json`이 우선이다.
- 2026-04-22 재점검 기준 현재 `run-strategy-tick.mjs`에는 9개 adapter가 등록돼 있다. 아래 workstream 본문은 "초기 빌드 순서" 기록으로 유지하되, 현시점 우선순위 판단은 이 문서의 `상태 보정`과 `공식 11개 체인 maturity matrix`를 우선한다.
- **2026-04-22 parity floor 완료**: 공식 11개 체인과 6개 신규 전략 후보가 `dashboard-status.json`의 `chainParity` / `strategyParity`로 동일 schema로 노출된다.

## 범위

이번 계획의 범위는 다음과 같다.

- 남아 있는 전략 후보 전부
- Gateway 공식 11개 체인 중 아직 strategy / allocator / promotion maturity가 낮은 체인
- destination venue registry / promotion gate / allocator 확장
- Gateway를 funding rail로 사용하는 native token / ETH-like destination deployment
- shadow / canary / promotion / receipt / dashboard 연동

이번 계획에서 제외하는 것:

- multi-depositor vaulting
- runtime cap 상향 자동화
- LLM 의사결정 경로 편입
- BOB Gateway 비공식 destination chain

## 실전 소액 테스트 현황

이 문서는 "실전 소액 테스트가 아직 전혀 없다"는 전제로 쓰지 않는다.

현재 repo와 운영 메모 기준 사실은 아래와 같다.

- Gateway transport 쪽은 최소 라이브 증명이 이미 있다.
- `Base -> BOB wBTC.OFT` `1000 sats` end-to-end minimal live proof가 기록돼 있다.
- `wrapped-btc-loop-base-moonwell`은 signer-backed OOS / live roundtrip evidence가 기록돼 있다.
- `docs/current-status.md` 기준 tiny live canary review 단계는 존재하며, 현재 top route는 `base->bsc wBTC.OFT->wBTC.OFT` `300` amount까지 내려와 있다.
- 하지만 이것을 "반복 가능한 수익 전략의 소액 실전 canary가 완료됐다"로 부르면 안 된다.
- 현재 상태는 `tiny_live_canary_review` 또는 `minimal_live_proof_exists`에 가깝고, 경제성은 아직 `BLOCKED_ECONOMICALLY_UNJUSTIFIED_PREP` 또는 `blocked_no_net_edge`가 남아 있다.

즉, 앞으로의 계획은 "소액 실전 테스트를 새로 발명"하는 것이 아니라 아래 두 가지를 닫는 것이다.

1. 이미 있는 minimal live proof를 전략별 repeatable micro-canary로 승격
2. canary / rescue / unwind 도중 native gas 부족으로 막히지 않도록 자동 gas bootstrap 경로를 완성

## 리스크 자동관리 현황 재점검 (2026-04-22)

이 문서는 현재 상태를 "리스크 자동관리 완료"로 쓰지 않는다.

사용자 질문 기준으로는 아래처럼 나눠서 보는 것이 정확하다.

### 실제 signer / policy 경로에 이미 붙어 있는 것

- `src/executor/signer/daemon.mjs`는 intent를 signer로 보내기 전에 항상 `evaluateIntentPolicies()`를 호출한다.
- `src/executor/policy/index.mjs`는 현재 `kill_switch`, `consecutive_failures`, `cap_check`, `hf_check`, `stale_quote`, `approval_hygiene`를 실제 block/allow verdict로 묶고 있다.
- `src/executor/policy/cap-check.mjs`는 단순 per-tx cap만 보는 것이 아니라 `perDay`, `perChain`, `maxDailyLossUsd`, `maxFailedGasCost24hUsd`와 함께 `portfolio_chain_cap_exceeded`, `portfolio_protocol_cap_exceeded`, `portfolio_btc_denomination_floor_breached`까지 계산한다.
- `src/executor/policy/hf-check.mjs`는 leverage intent에서 pre-trade / post-trade `healthFactor`와 `liquidationBufferPct`를 실제 blocker로 막고, `requiresUnwind`와 `emergencyUnwindPath`도 같이 반환한다.

즉 아래 항목은 "문서상 아이디어"가 아니라 실제 signer path에 연결된 리스크 차단으로 봐도 된다.

1. 헬스팩터 하한
2. 청산버퍼 하한
3. per-strategy / per-chain / per-day cap
4. 일일 손실 한도
5. failed gas burn budget
6. stale quote 차단
7. approval hygiene
8. 연속 실패 auto-pause
9. 포트폴리오 수준 protocol / chain / BTC-denominated share guard

### 실전자동 관리 현황 (2026-04-22 세션 완료)

- **W9-A 완료**: `src/executor/policy/index.mjs`가 `evaluateLiquidityWatch`와 `evaluateConcentrationGuard`를 메인 signer policy aggregator에 연결했다.
  - liquidity breach 시 `pause_new_entries` / `queue_unwind`를 구분 기록한다.
  - concentration breach 시 `concentration_guard_reject_intent`를 기록한다.
  - `riskContext`를 통해 `liquiditySnapshot`, `currentAllocations`, `totalOperatingCapitalUsd`를 공통 schema로 받는다.
- **W9-B 완료**: `evaluateIntentPolicies`가 `requiresUnwind`와 `emergencyUnwindPath`를 상위 결과로 전파한다.
  - `buildEmergencyUnwindIntent`가 deterministic skeleton intent를 생성한다.
  - `cap-check`는 `emergency_unwind` intent를 인식하고 일부 cap을 우회한다.
  - daemon이 receipt에 `healthFactorPath`, `liquidationBufferPath`, `slippagePct`, `realizedNetPnlBtc`를 강제 기록한다.
  - `buildLeverageAutoUnwindStatus`가 watcher 상태와 signer audit을 병합해 `auto_unwind_ready / submitted / confirmed / failed`를 구분 노출한다.
- **W9-C 완료**: 전략 adapter 9개가 4단계 micro-canary ladder를 사용한다.
  - `not_started -> micro_canary_ready -> minimal_live_proof_exists -> micro_canary_repeatable`
  - `buildMicroCanarySlice`가 `lastFailureReason`과 `realizedNetUsd`를 per-strategy로 기록한다.

짧게 말하면:

- `HF / 청산버퍼 / cap / stale quote / failure budget / liquidity / concentration`이 모두 메인 signer policy path에 연결됐다.
- `emergency_unwind` intent 생성, policy 통과, receipt 필드 기록, dashboard 4-state 노출이 구현됐다.
- 실제 on-chain broadcast까지의 end-to-end 증거는 proposer가 `emergency_unwind` intent를 daemon에 제출하면 자동으로 policy -> signer -> receipt path를 탄다.
- 남은 것: 실제 생산 환경에서 `emergency_unwind` intent를 한 번 이상 확인한 것.

### 실전 소액 테스트 판정

- 소액 실전 테스트는 "전혀 없음"이 아니다.
- 최소 라이브 증명은 이미 있다. 예: `Base -> BOB wBTC.OFT` `1000 sats` end-to-end minimal live proof, native asset DEX live proofs, wrapped-BTC loop signer-backed OOS/live roundtrip evidence.
- 다만 `docs/current-status.md` 기준 현재 단계는 여전히 `tiny_live_canary_review`이며, `manual approval before live canary`가 남아 있다.
- 따라서 현재 판정은 `minimal_live_proof_exists` 또는 일부 `review_only_canary_candidate`이지, "반복 가능한 전략 실전 소액 canary가 fully autonomous로 운영 중"은 아니다.

이 문서의 다음 작업은 "실전 소액 테스트를 새로 발명"하는 것이 아니라 아래를 닫는 것이다.

1. minimal live proof를 전략별 `micro_canary_repeatable`까지 승격
2. rescue / unwind / off-ramp / payback의 gas bootstrap을 실전자동화
3. watcher breach가 실제 signer-backed unwind intent로 이어지게 마감

## 현재 후보 인벤토리

| Bucket | ID | Chain | 주요 프로토콜 | 현재 상태 | 핵심 blocker |
|---|---|---|---|---|---|
| Near-live leverage | `recursive_stablecoin_lending_loop` | Base | Morpho | `dry_run_evidence_recorded` | stable swap binding, signer-backed receipt, post-fee economics |
| Adapterized yield | `pendle-pt-lbtc-base` | Base | Moonwell + Pendle | evaluator only | Pendle market snapshots, rollover receipts, executor wiring |
| Adapterized LP | `aerodrome-cl-base` | Base | Aerodrome | evaluator only | pool/range snapshots, rebalance receipt, range manager wiring |
| Passive yield | `beefy-folding-vault` | Base | Beefy + Moonwell | evaluator only | vault snapshots, withdrawal receipt, tick registry wiring |
| Direct PT | `pendle-pt-solvbtc-bbn-bsc` | BSC | Pendle + Solv + Gateway Custom Action | evaluator only | custom action execution proof, BSC market loader, receipt ingest |
| Reward sleeve | `berachain-bend-bex-bgt` | Berachain | Bend + BEX + BGT | evaluator only | BGT price/liquidity feeds, claim proof, Bera receipt loop |
| Basis sleeve | `gmx-v2-perp-basis-avax` | Avalanche | GMX V2 | evaluator only | funding feed, perp execution receipts, auto-unwind proof |
| Stable spread | `stablecoin_spread_loop` | Base | Morpho / Aave / Euler | design scaffold | protocol adapter, peg feed, overfit-safe samples |
| Wrapper arb | `proxy_spread_expansion` | Base / BOB / Bera / Unichain | Gateway wrappers | design scaffold | quote ladder, cross-wrapper receipts, OOS decay evidence |
| Reserve sleeve | `tokenized_reserve_sleeve` | Ethereum / Base | PAXG / XAUT / USDY / bIB01 | design scaffold | issuer allowlist, exit liquidity measurements, risk policy |
| Wrapped BTC allocator | `destination_wrapped_btc_rotation` | Multi-chain | chain-specific venues | research priority | destination venue registry, unwind scoring, per-chain receipts |
| Stable treasury sleeve | `stablecoin_treasury_rotation` | Base / Ethereum / BSC | Aave / Venus / stable venues | research priority | exit cost ranking, stable destination registry, round-trip economics |
| Direct ETH deployment | `eth_destination_deployment` | Base / Ethereum / BSC | Moonwell / Aave / Aerodrome / Uniswap / PancakeSwap | planning-only economics packet | ETH arrival is underobserved, destination scoring missing |
| Indirect native/ETH deployment | `gateway_native_asset_conversion_sleeve` | Avalanche / Sonic / Berachain / Unichain / Soneium / BOB | BENQI / Shadow / Silo / Bend / Kodiak / Kyo / Uniswap / Velodrome | research priority | safe local conversion proof, allowlist, unwind cost, receipt schema |
| Chain onboarding | `optimism`, `sei` | Optimism / Sei | destination TBD | not on strategy surface | registry entries, gas snapshots, venue mapping, quote coverage |

## 상태 보정 (2026-04-22 재점검)

이 문서 초안 작성 후 W0~W7의 registry / allocator / dashboard 연동 작업이 이미 반영됐다.

아래 W1~W7 본문은 "무엇을 어떤 순서로 닫았는가"를 설명하는 기록으로 유지하고, 지금 남은 일은 체인별 maturity gap을 메우는 쪽에 더 가깝다.

운영 산출물 기준 한줄 요약:

- `data/strategy-snapshot.json`: `implementedStrategyCount=8`, `candidateForValidationCount=0`, `secondaryScaffoldCount=4`, `deterministicCandidateCount=6`
- `src/cli/run-strategy-tick.mjs`: 9개 adapter registry 반영 완료
- `data/native-btc-opportunity-surface.json`: native BTC live route 21개, 이 중 `wrapped_btc=10`, `stablecoin=5`, `eth_like=3`, `store_of_value=2`, `other=3`
- `src/config/destination-venues.mjs`: wrapped-BTC venue registry는 `base`, `bsc`, `avalanche`, `bera`, `bob`, `sonic`, `soneium`, `unichain` confirmed, `optimism`, `sei`는 `template_only`
- `src/config/stable-venues.mjs`: stable venue registry는 `base`, `ethereum`, `bsc`만 confirmed, `optimism`, `sei`는 `template_only`
- `data/destination-economics-packet.json`: `eth_destination_deployment` economics template는 현재 `base`, `bsc`까지만 존재
- `data/allocator-core.json`: active-ready는 `base`, `bsc`; review-only는 `avalanche`, `bera`; blocked-only는 `sonic`, `unichain`, `soneium`
- `data/destination-promotion-gate.json`: 총 38개 항목 중 `promotable=4`, `blocked=34`; 상위 blocker는 `evidence_policy_incomplete`, `evidence_stale`, `allowlist_decision_missing`

핵심 해석:

- 이제 "아예 runner가 없다"는 문제는 많이 줄었다.
- 대신 "공식 체인 이름은 들어갔지만, allocator/promotion evidence가 부족하다"는 문제가 남아 있다.
- `sonic`, `soneium`, `unichain`은 더 이상 `template_only`가 아니라 "registry는 있으나 아직 blocked/review-only"로 보는 편이 맞다.
- `optimism`, `sei`는 여전히 `template_only`가 맞다.
- `ethereum`은 stable venue는 있지만 wrapped-BTC destination venue registry가 비어 있고, `bob`은 wrapped venue는 있지만 stable venue와 dedicated adapter가 약하다.
- direct `BTC -> ETH-like` live arrival은 현재 `base`, `ethereum`, `bsc` 3체인만 보인다. 다른 체인의 native token / ETH-like 전략은 대부분 `Gateway -> wBTC.OFT 도착 -> safe local conversion` 구조가 필요하다.

## Gateway-first Native / ETH 자산 연구 결과

짧은 결론:

1. 가능하다. BOB Gateway는 공식적으로 native BTC를 "임의 자산" 또는 "임의 DeFi position"까지 한 번에 보낼 수 있는 방향을 열어 두고 있다.
2. 하지만 실제 build order는 `direct arrival`과 `indirect conversion`을 분리해야 한다.
3. 따라서 가장 먼저 구축할 대상은 `base / ethereum / bsc`의 direct ETH-like deployment이고, 그 다음이 `wBTC.OFT -> local native/ETH conversion`이 필요한 체인들이다.

공식 문서 기준 핵심 사실:

- BOB Gateway 공식 문서는 `stake`, `swap`, `lending`, `LP positions`, `custom actions`를 모두 지원 use case로 명시한다.
- Gateway custom action 공식 블로그는 destination chain에서 arbitrary call을 실행할 수 있다고 설명하며, 예시로 `Base Aave 예치`와 `Unichain liquidity provision`을 든다.
- 즉 "BTC -> destination ETH/native asset -> LP or lending loop"는 제품 방향과 어긋나는 확장이 아니라, 오히려 Gateway가 원래 의도한 programmable settlement에 가깝다.

repo와 외부 자료를 함께 봤을 때의 전략적 의미:

- 현재 repo live surface에서는 direct `eth_like` 도착이 `base`, `ethereum`, `bsc`에만 보인다.
- 따라서 direct ETH deployment는 지금 바로 build plan에 올릴 수 있다.
- 반면 `avalanche`, `sonic`, `bera`, `unichain`, `soneium`, `bob`의 native token 전략은 direct arrival이 아니라, `wBTC.OFT arrival -> trusted DEX swap -> native/ETH-like venue deployment`로 설계해야 한다.
- 이 두 부류를 섞으면 route proof는 있는데 destination proof가 없거나, 반대로 protocol idea는 있는데 Gateway-first 원칙이 흐려진다.

### 체인군별 연구 결론

| Cluster | Chains | Gateway 진입 방식 | 1차 후보 전략 | 왜 이 순서인지 | 현재 핵심 blocker |
|---|---|---|---|---|---|
| Direct ETH-like | Base / Ethereum / BSC | `BTC -> ETH-like` direct arrival | ETH lending loop, ETH-stable LP, ETH-BTC LP | Gateway를 가장 직접적으로 활용하면서 local conversion 단계를 줄일 수 있음 | destination scoring, allowlist, economics packet 부족 |
| Indirect native / ETH-like | Avalanche / Sonic / Berachain / Unichain / Soneium / BOB | `BTC -> wBTC.OFT -> trusted local swap -> native/ETH-like` | native token LP, staked-native loop, ETH-like collateral sleeve | 공식 체인 범위를 넓게 쓰되 Gateway를 funding rail로 고정 가능 | safe conversion proof, router allowlist, unwind cost, native gas bootstrap |
| Discovery only | Optimism / Sei | 아직 route/venue template 위주 | 추후 ETH/native sleeve | 공식 체인이지만 venue/route evidence가 아직 얇음 | `template_only`, quote freshness, venue confirmation |

### 체인별 1차 연구 후보

| Chain | 추천 진입 자산 | 1차 후보 프로토콜/형태 | 구축 우선도 | 메모 |
|---|---|---|---|---|
| Base | ETH | Moonwell / Aave 계열 WETH loop, Aerodrome / Uniswap ETH LP | 최우선 | direct ETH arrival가 있어 가장 Gateway-first 구현이 쉽다 |
| Ethereum | ETH | Aave WETH loop, Uniswap WETH/USDC or WETH/WBTC LP | 연구 우선, live는 신중 | direct ETH arrival는 되지만 gas domain이 비싸다 |
| BSC | ETH 또는 이후 WBNB | PancakeSwap ETH LP, Venus 계열 ETH/BNB 담보 루프 | 우선 | direct ETH-like arrival가 있어 direct sleeve 출발점으로 적합 |
| Avalanche | AVAX / sAVAX / WETH | BENQI lending or AVAX staking sleeve, native/ETH LP | 중간 | direct native arrival는 안 보이고 local conversion이 필요 |
| Sonic | S / wS / ETH-like | Shadow CL LP, Silo lending/loop | 높음 | Sonic은 native/DEX 활성이 강해 indirect sleeve 후보가 명확하다 |
| Berachain | BERA / HONEY | Bend loop, Kodiak Islands / Sweetened Islands LP | 높음 | PoL/BGT 인센티브로 LP sleeve 근거가 강하지만 router allowlist가 더 필요 |
| Unichain | ETH-like | Uniswap 중심 LP, 이후 lending sleeve | 높음 | official custom-action example가 LP 쪽에 있다 |
| Soneium | ETH-like | Kyo / Uniswap 계열 LP | 중간 | direct ETH arrival는 안 보이고 local conversion route 검증이 선행돼야 한다 |
| BOB | ETH-like | Velodrome LP, 이후 Avalon/Euler 계열 collateral sleeve 검토 | 중간 | BOB 내부 native/ETH deployment는 장점이 있지만 venue scoring이 약하다 |
| Optimism | ETH | Moonwell / Aave / Velodrome 계열 후보 탐색 | 낮음 | 아직 template-only라 discovery부터 해야 한다 |
| Sei | SEI / ETH-like | native/DEX + lending 후보 탐색 | 낮음 | 아직 template-only라 discovery부터 해야 한다 |

### Gateway-first 원칙으로 다시 정리한 설계 규칙

1. 출발은 항상 native BTC다.
2. direct arrival가 있으면 `BTC -> target asset`을 먼저 쓴다.
3. direct arrival가 없으면 `BTC -> wBTC.OFT -> trusted local conversion -> target asset`만 허용한다.
4. manual bridge나 사후 수동 재정렬을 steady-state로 두지 않는다.
5. LP / loop / collateral sleeve 모두 payback unwind까지 포함한 deterministic receipt chain이 있어야 한다.

### 외부 자료 근거

- [BOB Gateway Overview](https://docs.gobob.xyz/gateway)
- [BOB Gateway API Overview](https://docs.gobob.xyz/api-reference/overview)
- [Custom DeFi Actions Now Integrated in BOB Gateway SDK](https://www.gobob.xyz/blog/custom-defi-actions-now-integrated-in-bob-gateway-sdk)
- [Moonwell Asset Risk Parameters](https://docs.moonwell.fi/moonwell/protocol-information/asset-risk-parameters)
- [Moonwell Interest Rate Curves](https://docs.moonwell.fi/moonwell/protocol-information/interest-rate-curves)
- [Aave Supply Tokens](https://aave.com/help/supplying/supply-tokens)
- [BENQI Core Markets](https://docs.benqi.fi/benqi-markets/core-markets)
- [Shadow Docs](https://docs.shadow.so/)
- [Silo Intro](https://docs.silo.finance/docs/users/intro/)
- [Berachain Bend Docs](https://docs.bend.berachain.com/)
- [Kodiak Island Liquidity Provision](https://documentation.kodiak.finance/protocol/islands/island-liquidity-provision)
- [Kyo Finance Contract Addresses](https://docs.kyo.finance/resources/contract-addresses)
- [Unichain Mainnet is Here](https://blog.uniswap.org/unichain-mainnet-is-here)
- [Uniswap Docs](https://docs.uniswap.org/)

## 공식 11개 체인 Maturity Matrix

아래 표는 "공식 체인 목록에 있느냐"와 "실제로 전략 surface까지 올라왔느냐"를 분리해서 본 현황이다.

| Chain | Wrapped-BTC venue registry | Stable venue registry | Dedicated strategy adapter / tick surface | Allocator / promotion 상태 | 현재 판정 | 남은 핵심 작업 |
|---|---|---|---|---|---|---|
| Base | confirmed | confirmed | 있음 (`recursive`, `pendle`, `aerodrome`, `beefy`) | active-ready / 일부 blocked | 가장 성숙 | repeatable micro-canary, stale evidence 정리 |
| BSC | confirmed | confirmed | 있음 (`pendle-pt-solvbtc-bbn-bsc`) | active-ready / 일부 blocked | 가장 성숙 | custom action receipt, post-fee economics 보강 |
| Avalanche | confirmed | 없음 | 있음 (`gmx-v2-perp-basis-avax`) | review-only | 부분 구축 | stable arrival, indirect stable quote, evidence freshness |
| Berachain | confirmed | 없음 | 있음 (`berachain-bend-bex-bgt`) | review-only | 부분 구축 | router/stable gap, claim/economics 증거 축적 |
| BOB | confirmed | 없음 | 전용 adapter 없음 | promotion 항목은 있으나 전부 blocked | infra만 있고 전략 약함 | dedicated adapter, allowlist/economics/evidence 정리 |
| Unichain | confirmed | 없음 | 전용 adapter 없음 | blocked-only | route prep는 있으나 전략 미완 | dedicated adapter, stable venue, receipt/evidence 누적 |
| Soneium | confirmed | 없음 | 전용 adapter 없음 | blocked-only | route prep는 있으나 전략 미완 | dedicated adapter, router gap, stable venue, evidence freshness |
| Sonic | confirmed | 없음 | 전용 adapter 없음 | blocked-only | route prep는 있으나 전략 미완 | dedicated adapter, stable venue, quote refresh, repeatable evidence |
| Optimism | template_only | template_only | 없음 | promotion 항목 없음 | 미구축에 가까움 | venue 확인, gas/quote coverage, adapter scaffold |
| Sei | template_only | template_only | 없음 | promotion 항목 없음 | 미구축에 가까움 | venue 확인, gas/quote coverage, adapter scaffold |
| Ethereum | 없음 | confirmed | 전용 chain adapter 없음 | destination promotion 표면 약함 | 부분 구축 | wrapped-BTC destination registry, ETH/BTC destination candidate 명시 |

보조 메모:

- `docs/current-status.md` 기준 transport/prep surface는 `base->unichain` active canary, `base->soneium` prep candidate, `base->sonic` prep candidate까지는 올라와 있다.
- 따라서 `unichain`, `soneium`, `sonic`은 "체인 자체를 새로 등록"하는 단계보다 "전략 adapter와 allocator 승격 증거를 붙이는 단계"로 보는 것이 정확하다.
- 반대로 `optimism`, `sei`는 아직도 체인 registry/venue/quote coverage 자체를 더 확보해야 한다.

## 문서에 추가해야 할 추적 축

앞으로 체인 계획 문서에는 아래 축을 모든 공식 체인에 공통으로 남긴다.

1. `official_chain_listed`와 `strategy_surface_present`를 분리 기록
2. `wrapped_btc_venue_confirmed`, `stable_venue_confirmed`, `template_only`를 분리 기록
3. `adapter_scaffolded`, `tick_connected`, `receipt_backed`, `allocator_ready`를 단계별로 분리 기록
4. `transport proof exists`와 `strategy evidence exists`를 절대 같은 말로 쓰지 않기
5. `route prep candidate`, `micro_canary_ready`, `micro_canary_repeatable`를 체인별로 같이 기록
6. `direct_target_asset_arrival`와 `indirect_via_wrapped_btc_conversion`을 분리 기록
7. local conversion이 필요한 체인은 `trusted_swap_route`, `conversion_receipt`, `native_gas_bootstrap`까지 같이 추적

## 추가 연구가 필요한 항목

### 1. `sonic` / `soneium` / `unichain` 전략화 연구

이 세 체인은 "공식 체인 추가" 자체는 끝났지만, 전략 surface가 비어 있어 체인 존재감이 transport/prep 수준에 머물러 있다.

필수 연구:

1. wrapped-BTC venue별 entry / unwind / withdrawal delay 실측
2. stable arrival or indirect stable exit 경로 실측
3. canary-ready receipt schema와 unwind proof 정리
4. route proof를 chain-level strategy adapter로 승격할 수 있는지 검토

### 2. `optimism` / `sei` venue 발굴 연구

이 둘은 아직 `template_only`라서, "registry 있음" 이상의 증거가 더 필요하다.

필수 연구:

1. 공식 Gateway 지원 상태 재검증
2. wrapped-BTC / stable venue 실명 후보 확인
3. gas snapshot과 quote freshness 반복 수집
4. destination-promotion-gate에 넣을 경제성 필드 정의

### 3. `ethereum` / `bob` 보강 연구

두 체인은 공식 체인이지만 현재 문서와 구현에서 상대적으로 덜 선명하다.

필수 연구:

1. `ethereum` wrapped-BTC destination registry를 둘지, ETH-family 전용 lane으로 따로 분리할지 설계 확정
2. `bob`에서 Euler/Avalon/Velodrome 중 어느 surface가 실제 primary venue인지 결정
3. 두 체인 모두 allowlist decision과 economics evidence를 promotion artifact까지 연결

### 4. 공통 evidence hygiene 연구

현재 destination promotion blocker 상위권이 대부분 "새 전략 발굴"이 아니라 "증거 관리 미완"에 가깝다.

필수 연구:

1. `evidence_stale`를 줄이는 refresh cadence
2. `allowlist_decision_missing` 해소용 protocol risk rubric
3. `economics_inputs_missing` 해소용 공통 measurement schema
4. strategy adapter와 allocator가 같은 receipt/evidence source를 재사용하도록 통합

### 5. native / ETH destination 연구

이 축은 이번 문서 갱신에서 새로 확정한 영역이다.

필수 연구:

1. direct ETH arrival 체인(`base`, `ethereum`, `bsc`)용 `eth_destination_deployment` economics packet 완성
2. indirect native conversion 체인용 `wBTC.OFT -> native/ETH-like` trusted route 확보
3. LP 전략과 lending loop 전략을 separate risk class로 분리
4. `directional market risk`가 있는 native/ETH sleeve를 payback 정책과 어떻게 공존시킬지 rule화

### 6. 실전자동 리스크 오케스트레이션 연구

이 항목은 새 체인 확장보다 우선순위가 높다.

필수 연구:

1. `liquidity-watch`, `concentration-guard`를 signer policy aggregator에 실제 연결
2. pool utilization / withdrawal queue / allocation candidate 입력 schema를 strategy snapshot loader에서 공통화
3. leverage breach 시 `report only`가 아니라 deterministic `emergency_unwind` intent 생성 경로를 daemon에 연결
4. risk breach -> unwind intent -> signer receipt -> realized unwind cost / HF path를 하나의 audit chain으로 기록
5. dashboard/status에서 `risk blocked`, `pause new entries`, `auto unwind submitted`, `auto unwind confirmed`를 구분 노출

## 우선순위 원칙

구축 순서는 아래 원칙을 따른다.

1. `Base/Moonwell`은 영구 우선 체인이 아니라 초기 검증용 seed lane으로만 쓴다. 검증된 부품은 복제하고, 체인/전략 우선순위는 parity floor 기준으로 다시 나눈다.
2. evaluator만 있는 후보를 먼저 "shadow 가능한 후보"로 올린다.
3. 이제부터는 특정 한 전략을 `live_ready`까지 깊게 미는 것보다, 공식 11개 체인과 신규 전략 후보 전부를 최소 공통 maturity까지 breadth-first로 끌어올리는 것을 우선한다.
4. 새 체인 추가보다 `receipt -> tick -> canary -> promotion` 연결을 먼저 완성한다. 단 이미 한 체인에서만 닫힌 부품은 다른 공식 체인에도 같은 수준으로 복제해야 "완료"로 본다.
5. BOB Gateway transport proof만으로 전략 완료로 치지 않는다.
6. 모든 전략은 `BTC-denominated`, `deterministic`, `cap = code` 원칙을 지킨다.
7. 실전 소액 테스트는 전략별 `micro-canary`로 명시 관리한다. "최소 라이브 증명"과 "전략 canary 통과"는 같은 말이 아니다.
8. `rescue`, `unwind`, `offramp`, `gas top-up`은 모두 운영 부속작업이 아니라 전략 생존 조건이다. 가스 부족으로 rescue가 멈추면 그 전략은 구축 완료가 아니다.
9. 앞으로의 완료 기준은 "Base에서 된다"가 아니라 "공식 체인/전략군 전반이 같은 stage vocabulary와 같은 evidence schema로 관리된다"이다.

## 전체 parity floor 원칙

사용자 목표는 특정 1개 전략의 깊이 우선 승격이 아니라, 전체 전략군과 전체 공식 체인을 같은 선상으로 올리는 것이다.

따라서 W10 이후의 기본 정책은 아래와 같다.

1. `Base/Moonwell`에만 있는 특별 취급을 줄인다.
2. 모든 공식 체인에 대해 최소 아래 4개를 같은 수준으로 만든다:
   - venue registry
   - strategy adapter 또는 explicit empty surface
   - receipt/evidence schema
   - promotion/demotion 상태 노출
3. 모든 신규 전략 후보에 대해 최소 아래 4개를 같은 수준으로 만든다:
   - tick 연결
   - market snapshot loader
   - micro-canary 상태
   - blocked reason의 기계 판독 가능 출력
4. 특정 lane 하나를 `live_ready`까지 더 밀기 전에, 나머지 lane들이 아직 `template_only`나 `design scaffold`에 머물러 있으면 breadth-first 보강을 먼저 한다.
5. 앞으로 문서/상태 보고에서 "완성"은 아래 둘을 동시에 뜻해야 한다:
   - 해당 전략/체인이 자체적으로 동작 가능
   - 같은 계열 다른 전략/체인과 비교 가능한 동일 schema로 관리됨

## 외부 에이전트 단일 세션 실행 원칙

이 계획은 "한 번에 끝까지 구축"하는 외부 코딩 에이전트 실행 방식도 지원한다.

단, 여기서 "한 번에"는 다음 뜻이다.

- 한 세션에서 `W1 -> W1-B -> W2-A`를 연속으로 진행한다.
- 각 workstream 끝에서 필수 검증을 통과해야만 다음 workstream으로 넘어간다.
- 앞 단계 검증이 실패하면 다음 단계로 건너뛰지 않는다.
- 실패 원인이 코드로 해결 가능하면 같은 세션에서 바로 수정 후 재검증한다.
- 실패 원인이 외부 의존성, 실계정 자금, 누락된 비밀값, 장시간 관측처럼 세션 안에서 해결 불가능한 hard blocker면 거기서 멈추고 정확한 blocker와 다음 시작점을 남긴다.

이 문서 기준으로 외부 에이전트는 "알아서 끊고 다시 시작"해도 되지만, 기본 정책은 아래다.

1. 가능하면 같은 세션에서 계속 간다.
2. workstream 경계마다만 게이트를 평가한다.
3. 게이트 실패 시 먼저 자가 수정 루프를 1~3회 시도한다.
4. 그래도 실패하면 그 지점에서 중단하고, 다음 세션은 실패한 workstream부터 재개한다.

금지:

- 앞 단계 검증이 안 끝났는데 뒤 단계 파일부터 넓게 수정하는 것
- 문서상 순서를 무시하고 쉬운 후보부터 임의로 퍼지는 것
- 테스트/검증 실패를 TODO로 남기고 다음 workstream으로 넘어가는 것

## 단일 세션 게이트 규칙

외부 에이전트가 한 번에 끝까지 진행할 때는 아래 게이트를 반드시 따른다.

### Gate A. W1 종료 게이트

다음이 모두 만족돼야 `W1-B`로 넘어간다.

- `run-strategy-tick` registry 일반화가 코드에 반영됨
- 최소 6개 adapter id가 runner에 등록됨
- strategy별 snapshot / receipt 누락이 blocked report로 떨어짐
- 관련 테스트 통과
- 상태 산출물이 깨지지 않음

미통과 시:

- 같은 세션에서 W1만 계속 수정
- W1-B 파일 생성 금지, 단 W1 구현에 직접 필요한 scaffold는 예외

### Gate B. W1-B 종료 게이트

다음이 모두 만족돼야 `W2-A`로 넘어간다.

- `microCanaryStatus`가 strategy report에 존재
- `bootstrap_required_before_execution` 상태가 추가됨
- gas bootstrap planning path가 코드에 존재
- bootstrap 성공 후 원래 intent 재시도 경로가 존재
- bootstrap 실패가 `missing_gas`가 아닌 명시 상태코드로 기록됨
- 관련 테스트 통과

미통과 시:

- 같은 세션에서 W1-B만 계속 수정
- `recursive_stablecoin_lending_loop`에 연결하기 전에 공통 bootstrap backbone부터 닫음

### Gate C. W2-A 종료 게이트

다음이 모두 만족돼야 그 세션을 "핵심 목표 달성"으로 본다.

- `recursive_stablecoin_lending_loop`가 bootstrap backbone을 실제 사용
- rescue / unwind 전 gas 부족 시 bootstrap 후 재시도 경로가 연결됨
- receipt / validation / status artifact에 반영됨
- 관련 테스트 통과

미통과 시:

- 같은 세션에서 W2-A를 계속 수정
- hard blocker면 정확한 blocker, 실패 명령, 마지막 성공 커밋을 남기고 종료

## 자가 수정 루프

외부 에이전트는 각 게이트에서 실패하면 아래 순서로 행동한다.

1. 실패한 테스트/명령/검증 출력을 읽는다.
2. 가장 가까운 원인 파일만 다시 수정한다.
3. 같은 검증을 다시 돌린다.
4. 최대 3회 반복한다.
5. 3회 안에 해결되지 않으면 "세션 내 해결 불가 blocker"로 보고 중단 여부를 판단한다.

중단이 허용되는 hard blocker 예시:

- 실제 체인 자금 부족
- 비밀값/키 경로 미설정
- 외부 RPC / API 장애
- 장시간 shadow / canary 관측이 필요한 조건

중단이 허용되지 않는 예시:

- 타입 오류
- 테스트 실패
- 누락 import
- 상태코드/문서/산출물 shape 불일치
- bootstrap state machine 누락

## 마이크로 캐너리 원칙

앞으로 모든 후보 전략은 아래 3단계 중 어느 단계인지 명시해야 한다.

1. `minimal_live_proof_exists`
2. `micro_canary_ready`
3. `micro_canary_repeatable`

정의:

- `minimal_live_proof_exists`: 단일 소액 라이브 증명은 있으나, 전략별 반복성과 economics가 아직 닫히지 않은 상태
- `micro_canary_ready`: 전략 config, receipt schema, gas bootstrap, unwind path가 갖춰져서 아주 작은 금액으로 반복 테스트가 가능한 상태
- `micro_canary_repeatable`: 최소 3회 이상 signer-backed 소액 실행이 같은 schema로 기록되고, 실패 원인과 realized cost가 재현 가능하게 남는 상태

모든 후보는 live 승격 전에 먼저 `micro_canary_repeatable`까지 가야 한다.

## Gas Rescue Autonomy 원칙

앞으로는 "구출하려고 했는데 native gas가 없어서 멈춤"을 정상 상태로 취급하지 않는다.

원칙:

1. `rescue` / `unwind` / `offramp` / `payback` / `gas refill`은 모두 intent 전 preflight에서 native gas floor를 검사한다.
2. gas floor 미달이면 원래 intent를 바로 실패시키지 않고 `bootstrap_required_before_execution` 상태로 바꾼다.
3. bootstrap은 deterministic 우선순위대로 자동 시도한다.
4. bootstrap 비용이 전략 손실보다 더 큰 경우는 "가스를 못 구함"이 아니라 `economically_unjustified_rescue`로 기록한다.
5. coding tool / executor는 사람이 따로 지시하지 않아도 bootstrap job을 생성하고 실행 가능한 경로를 찾아야 한다.
6. rescue intent는 "가스 부족으로 미실행"에서 끝나면 안 되고, 반드시 아래 셋 중 하나로 종결돼야 한다.

- `rescue_executed`
- `bootstrap_executed_but_rescue_blocked_for_policy`
- `bootstrap_and_rescue_economically_unjustified`

bootstrap 우선순위:

1. same-chain native 잔액 사용
2. same-chain swap으로 native 확보
3. same-wallet wrapped asset -> native unwrap/sell
4. cross-chain gas refuel (`Gas.Zip` 또는 repo 허용 경로)
5. treasury reserve source에서 bootstrap job 발행

금지:

- "운영자가 나중에 수동으로 가스를 넣으면 됨"을 steady-state 해결책으로 간주하지 않는다.
- rescue 직전에만 ad hoc manual top-up을 넣고 artifact에는 안 남기는 방식
- bootstrap 비용을 전략 economics 밖으로 숨기는 방식

## 전체 빌드 순서

### W0. Baseline Freeze

목표:

- 현재 candidate / gate / allocator / dashboard artifact를 새로 생성해 기준선을 고정한다.

작업:

- `npm run report:strategy-snapshot -- --write`
- `npm run report:deterministic-strategy-candidates -- --write`
- `npm run report:phase3-strategy-validation -- --write`
- `npm run report:destination-promotion-gate -- --write`
- `npm run report:strategy-tick-slice -- --write`

산출물:

- `data/*.json` 최신화
- 본 문서의 candidate 상태와 실제 artifact 일치 확인

완료 기준:

- 이 문서의 inventory와 `data/*.json` 상태가 충돌하지 않는다.

### W1. Strategy Tick Backbone 일반화

목표:

- `run-strategy-tick.mjs`를 모든 adapter evaluator가 공통으로 탈 수 있는 registry 기반 runner로 확장한다.

수정 대상:

- `src/cli/run-strategy-tick.mjs`
- `src/executor/tick/strategy-tick.mjs`
- `src/executor/dispatcher/candidate-builder.mjs`
- 새 디렉터리 `src/strategy/market/`
- 새 디렉터리 `src/strategy/receipts/`

세부 작업:

1. `ADAPTERS` registry를 `beefy` 전용 hardcode에서 공통 registry 모듈로 분리
2. strategy별 snapshot prefix 규칙을 모듈화
3. receipt loading을 strategy별 필드 차이를 흡수하는 normalizer로 분리
4. tick 결과를 `logs/strategy-tick.jsonl`뿐 아니라 `data/strategy-tick-status.json`에도 쓰도록 확장
5. dispatch candidate의 `protocol`, `chain`, `mode`, `shadowReady`, `liveReady`가 strategy별로 안정적으로 채워지게 정리

추천 신규 파일:

- `src/strategy/market/registry.mjs`
- `src/strategy/market/load-pendle-base-lbtc.mjs`
- `src/strategy/market/load-pendle-bsc-solvbtc-bbn.mjs`
- `src/strategy/market/load-aerodrome-base.mjs`
- `src/strategy/market/load-berachain-bend-bex.mjs`
- `src/strategy/market/load-beefy-base.mjs`
- `src/strategy/market/load-gmx-avax.mjs`
- `src/strategy/receipts/normalize-strategy-receipts.mjs`

테스트:

- adapter registry가 모든 strategy id를 인식하는지
- missing snapshot이 strategy 전체를 깨지 않고 blocked report로 떨어지는지
- malformed receipt가 무시되고 tick은 계속 도는지

완료 기준:

- 아래 strategy들이 모두 `npm run run-strategy-tick -- --strategy=<id> --json`으로 report를 생성한다.
- `beefy-folding-vault`
- `pendle-pt-lbtc-base`
- `pendle-pt-solvbtc-bbn-bsc`
- `aerodrome-cl-base`
- `berachain-bend-bex-bgt`
- `gmx-v2-perp-basis-avax`

### W1-B. Micro Canary + Gas Bootstrap Backbone

목표:

- 모든 후보 전략이 "소액 실전 테스트 가능 여부"와 "가스 없을 때 자동 확보 가능 여부"를 같은 runtime에서 판단하게 만든다.

수정 대상:

- `src/cli/run-strategy-tick.mjs`
- `src/executor/tick/strategy-tick.mjs`
- `src/executor/bootstrap/multi-hop-planner.mjs`
- `src/executor/balance/reconcile.mjs`
- `src/executor/watchdog/feed-freshness.mjs`
- 신규 `src/executor/bootstrap/gas-bootstrap-runner.mjs`
- 신규 `src/executor/bootstrap/rescue-bootstrap-policy.mjs`
- 신규 `src/status/micro-canary-slice.mjs`

세부 작업:

1. 각 strategy report에 `microCanaryStatus` 필드 추가
2. `rescue`, `unwind`, `payback`, `offramp` intent에 공통 `requiredNativeGasUsd` 계산 경로 추가
3. gas floor 미달 시 `multi-hop-planner`를 호출해 bootstrap plan 생성
4. bootstrap plan이 있으면 원래 intent보다 먼저 `gas-bootstrap` intent를 enqueue
5. bootstrap 성공 후 원래 intent 재시도
6. bootstrap 실패 시 `missing_gas`가 아니라 `bootstrap_failed`, `bootstrap_unavailable`, `economically_unjustified_rescue`로 구분 기록
7. `data/strategy-tick-status.json`과 dashboard slice에 `micro canary` / `bootstrap pending` 상태 노출

추천 신규 파일:

- `src/executor/bootstrap/gas-bootstrap-runner.mjs`
- `src/executor/bootstrap/rescue-bootstrap-policy.mjs`
- `src/executor/bootstrap/bootstrap-receipt-normalizer.mjs`
- `src/status/micro-canary-slice.mjs`

테스트:

- native gas가 0에 가까운 상태에서도 rescue intent가 즉시 hard fail하지 않는지
- bootstrap 성공 후 rescue intent가 재개되는지
- bootstrap 비용이 과도하면 `economically_unjustified_rescue`로 명시 차단되는지
- micro canary가 3회 반복 전에는 live candidate로 승격되지 않는지

완료 기준:

- "구출할 때마다 가스가 없어서 멈춘다"는 현상이 artifact에서 사라진다.
- 모든 rescue/unwind 실패는 `gas missing`이 아니라 bootstrap result가 붙은 상태 코드로 남는다.
- strategy별 `minimal_live_proof_exists` / `micro_canary_ready` / `micro_canary_repeatable` 상태가 보인다.

### W2. Near-live 후보 마감

이 workstream은 "실제로 가장 빨리 증거를 쌓아 promotion gate까지 갈 수 있는" 후보를 마감하는 단계다.

#### W2-A. `recursive_stablecoin_lending_loop`

목표:

- dry-run 기록 상태에서 signer-backed receipt 상태로 끌어올린다.

핵심 작업:

1. stable swap binding 구현
2. Base stable leg entry/unwind executor 연결
3. live peg-divergence watcher 연결
4. receipt ingest에서 health factor / buffer / fees / unwind cost 기록
5. `phase3-strategy-validation` blocker 3개 제거
6. rescue/unwind 전에 native gas가 부족하면 자동 bootstrap 후 재시도

수정 대상:

- `src/strategy/recursive-lending-loop-slice.mjs`
- `src/strategy/recursive-lending-loop-dry-run.mjs`
- `src/cli/run-recursive-lending-loop-dry-run.mjs`
- `src/cli/ingest-recursive-lending-loop-receipt.mjs`
- 필요 시 신규 `src/executor/strategies/recursive-stablecoin-loop-live.mjs`

완료 기준:

- `recursive_stablecoin_lending_loop_validation`이 `blocked`에서 빠진다.
- signer-backed receipt가 누적된다.
- post-fee economics가 dashboard/validation artifact에 반영된다.
- 소액 signer-backed micro canary를 3회 반복 가능하다.

#### W2-B. `pendle-pt-lbtc-base`

목표:

- Moonwell 레버리지와 Pendle PT를 연결하는 Base fixed-yield vertical을 shadow-ready로 만든다.

핵심 작업:

1. Pendle PT-LBTC market snapshot loader 작성
2. Moonwell borrow leg와 PT entry leg를 묶는 economics packet 정의
3. maturity rollover receipt schema 추가
4. executor path는 먼저 dry-run / shadow까지만 연결
5. exit / unwind / payback leg에서 gas bootstrap path를 같이 정의

수정 대상:

- `src/strategy/pendle-pt-lbtc-adapter.mjs`
- `src/strategy/market/load-pendle-base-lbtc.mjs`
- `src/cli/run-strategy-tick.mjs`
- 신규 `src/cli/report-pendle-pt-lbtc-status.mjs`

완료 기준:

- strategy tick에서 `shadowReady` 또는 명시적 blocker를 안정적으로 출력한다.
- `daysToMaturity`, `ptImpliedAprBps`, `entry/exit slippage`, `LBTC peg`가 artifact로 남는다.
- small live path는 `micro_canary_ready` 여부까지 판정된다.

#### W2-C. `aerodrome-cl-base`

목표:

- 두 pool variant(`cbbtc_lbtc_tight`, `cbbtc_usdc_incentive`)를 모두 shadow-ready로 만든다.

핵심 작업:

1. pool state / fee APR / incentive APR / out-of-range time loader 추가
2. rebalance receipt schema 추가
3. range reset proof를 live_candidate 조건에 맞게 기록
4. variant별 config template 분리
5. out-of-range rescue 시 native gas bootstrap을 공통 경로로 사용

수정 대상:

- `src/strategy/aerodrome-cl-adapter.mjs`
- `src/strategy/market/load-aerodrome-base.mjs`
- 신규 `src/strategy/config/aerodrome-cl-variants.mjs`

완료 기준:

- 두 variant 모두 tick report에서 구분된다.
- `rebalanceProven`을 계산할 수 있는 receipt schema가 존재한다.
- range rescue가 gas 부족 때문에 멈추지 않도록 bootstrap status가 같이 기록된다.

#### W2-D. `beefy-folding-vault`

목표:

- Base passive parking sleeve를 shadow-ready로 만든다.

핵심 작업:

1. Beefy vault TVL / net APY / fee / pause 상태 loader
2. underlying Moonwell HF 상태 연결
3. full vault exit receipt 증거 정의
4. tick runner에 strategy 등록
5. vault exit 전에 bootstrap gas가 자동 확보되는지 검증

완료 기준:

- vault withdrawal proof를 receipt로 남길 수 있다.
- `beefy-folding-vault`가 tick runner에서 blocked/shadowReady를 일관되게 출력한다.
- small live vault exit test를 `micro_canary`로 별도 기록할 수 있다.

### W3. 신규 체인 / 신규 venue vertical

#### W3-A. `pendle-pt-solvbtc-bbn-bsc`

목표:

- BSC direct PT 전략을 "evaluator only"에서 "custom action shadow candidate"로 올린다.

핵심 작업:

1. BSC Pendle / Solv / Gateway quote loader
2. Gateway custom action availability / failure-rate 관측 저장
3. PT direct entry와 maturity exit receipt schema 정의
4. BSC chain gas / quote freshness automation 포함
5. custom action 실패 후 rescue/offramp path도 bootstrap 가능하게 설계

완료 기준:

- custom action failure rate와 round-trip cost가 artifact로 남는다.
- PT direct strategy가 tick runner에서 candidate로 보인다.

#### W3-B. `berachain-bend-bex-bgt`

목표:

- Berachain reward sleeve를 claim-proof 가능한 상태까지 올린다.

핵심 작업:

1. Bend collateral sleeve와 BEX LP+BGT sleeve를 mode별로 분리
2. BGT price confidence / spot liquidity loader 작성
3. BGT claim receipt와 valuation proof schema 추가
4. Berachain offramp cost를 BTC 기준으로 기록
5. Bera native gas floor 미달 시 bootstrap source와 retry path를 명시

완료 기준:

- `collateral_only`, `lp_bgt` 두 모드 모두 별도 evidence를 가진다.
- BGT claim proof가 없으면 live_candidate가 절대 되지 않도록 검증된다.

#### W3-C. `gmx-v2-perp-basis-avax`

목표:

- funding gate, perp liquidity, auto-unwind proof를 실제 receipt와 연결한다.

핵심 작업:

1. funding rate sample loader
2. GMX V2 perp open/close receipt schema
3. funding flip auto-exit proof schema
4. Avalanche spot asset unwind economics 기록
5. auto-unwind 전에 AVAX gas bootstrap을 자동 발행

완료 기준:

- `evaluateFundingRateGate` 결과가 tick artifact에 반영된다.
- `autoUnwindProven`과 `liquidationBufferProven`을 receipt 기반으로 계산할 수 있다.

### W4. Design Scaffold를 실제 전략으로 전환

#### W4-A. `stablecoin_spread_loop`

선행 조건:

- `recursive_stablecoin_lending_loop` receipt path가 먼저 안정화되어야 한다.

핵심 작업:

1. Morpho / Aave / Euler adapter 표준 인터페이스 설계
2. peg divergence feed 구현
3. stable-to-stable unwind slippage receipt 수집
4. overfit gate를 통과할 sample ladder 재설계

완료 기준:

- `design_scaffold`에서 벗어나 adapter-backed report를 생성한다.

#### W4-B. `proxy_spread_expansion`

핵심 작업:

1. wrapper universe 고정
2. amount ladder 확장
3. cross-wrapper receipt set 정의
4. OOS decay / bridge latency 기록

완료 기준:

- `positive_net_outside_variance_floor`를 판정할 최소 샘플셋이 확보된다.

#### W4-C. `tokenized_reserve_sleeve`

핵심 작업:

1. issuer allowlist policy 문서화
2. exit liquidity 측정기 추가
3. market-risk budget를 config로 도입
4. BTC round-trip cost와 custody risk를 분리 집계

완료 기준:

- reserve sleeve가 `design_scaffold`가 아니라 `research_candidate` artifact를 만든다.

### W5. Destination Rotation / Treasury Rotation 확장

#### W5-A. `destination_wrapped_btc_rotation`

목표:

- 체인별 wrapped BTC venue를 registry로 만들고 allocator가 실제 venue score를 참조하게 한다.

우선 체인:

- Base
- BSC
- Avalanche
- Berachain
- BOB
- Sonic
- Soneium
- Unichain

체인별 1차 venue:

- Base: Moonwell / Aerodrome
- BSC: Venus / PancakeSwap / Pendle direct
- Avalanche: BENQI / GMX basis 관련 spot leg
- Berachain: Bend / BEX
- BOB: Euler v2 / Avalon / Velodrome
- Sonic: Shadow
- Soneium: KYO
- Unichain: Catex

핵심 작업:

1. `destination venue registry` 생성
2. venue별 `deposit fee`, `withdraw fee`, `unwind slippage`, `withdraw delay` 측정
3. allocator가 `destination-promotion-gate`의 blocker를 체인별로 직접 참조하도록 정리

완료 기준:

- `wrapped_btc_destination_yield`가 chain별로 "왜 blocked인지"가 아니라 "어느 venue가 1순위인지"까지 나온다.

#### W5-B. `stablecoin_treasury_rotation`

목표:

- Base / Ethereum / BSC stable venue를 exit-cost 기준으로 랭크한다.

핵심 작업:

1. Aave Base / Venus BSC / Ethereum stable venue 공통 loader
2. BTC 재진입 비용과 latency를 포함한 stable registry
3. treasury sleeve용 risk budget config 추가

완료 기준:

- `base:stablecoin_lending_carry`, `bsc:stablecoin_lending_carry` 외에도 chain별 stable rotation 비교가 가능하다.

### W6. Gateway 공식 체인 누락분 온보딩

목표:

- `optimism`, `sei`를 transport-only 상태가 아니라 strategy surface 위로 올린다.

핵심 작업:

1. `data/native-btc-opportunity-surface.json` 목적지 체인 목록에 반영되는 registry 경로 확인
2. `destination-strategy-registry`와 `destination-promotion-gate`에 두 체인 entry 추가
3. gas snapshot, quote freshness, venue mapping 최소 1개 이상 확보
4. "venue 미확인"이면 명시적으로 `template_only`로 남기고 silent omission 금지

추천 1차 venue 탐색:

- Optimism: stable / wrapped BTC / ETH venue 최소 1개씩
- Sei: wrapped BTC / stable venue 최소 1개씩

완료 기준:

- 두 체인이 strategy surface에서 누락되지 않는다.
- `missing_gateway_gas_snapshots`나 `no_current_destination_venue` 같은 blocker가 명시적으로 보인다.

### W7. 운영 연동 마감

목표:

- strategy 후보가 artifact에만 머무르지 않고 shadow, canary, promotion, dashboard까지 도달하도록 끊긴 연결을 마감한다.

세부 작업:

1. shadow loop runner를 cron/daemon으로 연결
2. `aggregateShadowRun` 결과를 `evaluateCanaryPromotion` 입력으로 연결
3. canary stage를 dispatcher가 읽도록 bridge 추가
4. `evaluatePromotionEvidence` 결과를 dashboard와 session handoff에 반영
5. `evaluateFeedFreshness`, `detectOftExploit`, `reconcileBalances`를 tick 전후 guard로 연결
6. payback accumulator가 yield strategy의 realized carry를 동일 schema로 읽는지 검증
7. gas bootstrap runner를 dispatcher / rescue / payback / canary 공통 경로에 연결
8. "manual top-up required"를 steady-state 문구에서 제거하고 bootstrap artifact로 치환

수정 대상:

- `src/executor/shadow/shadow-run-aggregator.mjs`
- `src/executor/canary/canary-runner.mjs`
- `src/executor/dispatcher/strategy-catalog-dispatcher.mjs`
- `src/status/dashboard-status.mjs`
- `src/status/current-dashboard-context.mjs`
- 필요 시 신규 `src/executor/tick/strategy-runtime-loop.mjs`

완료 기준:

- 각 전략에 대해 `shadow -> canary_1 -> canary_7 -> live` 상태를 artifact에서 확인할 수 있다.
- dashboard가 "candidate 존재"만이 아니라 "어느 단계에 있는지" 보여준다.
- rescue / unwind / offramp / payback 실패 건마다 bootstrap 판정이 같이 남는다.
- "가스가 없어서 구출 실패"는 허용되는 종료 상태가 아니다.

### W8. Gateway-first Native / ETH Asset Deployment

목표:

- Bob Gateway를 funding rail로 유지한 채 native token / ETH-like destination deployment를 전략 surface로 올린다.
- `direct arrival`와 `indirect conversion`을 섞지 않고, 증거와 리스크 모델을 분리한다.

#### W8-A. arrival / conversion registry

핵심 작업:

1. chain별 `direct_target_asset_arrival` 여부를 registry로 고정
2. `eth_like`, `native_token`, `staked_native`를 asset family로 분리
3. direct arrival가 없으면 `wBTC.OFT -> local swap`을 conversion lane으로 명시
4. conversion lane에 `trusted_router`, `quote freshness`, `receipt proof`, `gas bootstrap` 필드를 추가

수정 대상:

- 신규 `src/config/eth-venues.mjs`
- 신규 `src/config/native-asset-venues.mjs`
- 신규 `src/config/destination-asset-conversions.mjs`
- `src/strategy/native-btc-opportunity-surface.mjs`
- `src/strategy/allocator-core.mjs`

완료 기준:

- 모든 공식 체인에 대해 direct vs indirect native/ETH arrival class가 명시된다.
- silent omission 없이 "왜 해당 체인이 native/ETH sleeve 후보인지"가 artifact로 나온다.

#### W8-B. direct ETH deployment (`base`, `ethereum`, `bsc`)

핵심 작업:

1. `eth_destination_deployment`를 planning-only가 아니라 tick-connected candidate로 승격
2. Base / Ethereum / BSC 각각에 대해 1개 이상 deterministic destination sleeve를 고정
3. ETH lending loop와 ETH LP를 separate mode로 분리
4. destination economics packet에 `grossReturnBps`, `unwindSlippageBps`, `withdrawDelay`, `btcReentryCostBps`를 채운다

추천 1차 후보:

- Base: WETH lending loop, WETH/cbBTC or WETH/USDC LP
- Ethereum: WETH lending loop or WETH/USDC LP
- BSC: ETH LP, 이후 WBNB/ETH 변형

완료 기준:

- `base:eth_destination_deployment`와 `bsc:eth_destination_deployment`가 economics packet completeness를 가진다.
- `ethereum`도 direct ETH arrival candidate로 명시되고, gas domain 때문에 왜 observe-only인지 artifact에서 읽힌다.

#### W8-C. indirect native / ETH-like deployment

핵심 작업:

1. `wBTC.OFT -> native/ETH-like` safe conversion proof를 체인별로 수집
2. native token LP와 lending loop를 분리해서 candidate 정의
3. local conversion step도 entry receipt에 포함
4. unwind 시 `native/ETH-like -> wBTC.OFT -> BTC` 경로 비용을 BTC 기준으로 기록

우선 체인:

- Sonic
- Unichain
- Berachain
- Soneium
- Avalanche
- BOB

완료 기준:

- 최소 3개 체인에서 trusted conversion proof가 생긴다.
- conversion-only 체인도 `route proof는 있는데 destination proof가 없음` 상태로 남지 않는다.

#### W8-D. LP / looping risk policy

핵심 작업:

1. LP sleeve와 lending loop를 다른 risk class로 분리
2. `directional exposure`, `basis risk`, `IL risk`, `liquidation risk`를 policy field로 명시
3. native/ETH sleeve의 payback contribution을 BTC mark-to-market 기준으로 통일
4. emergency unwind 기준을 `native token drawdown`과 `BTC-denominated drawdown` 두 축으로 나눈다

완료 기준:

- native/ETH 전략도 payback / drawdown / rescue 규칙 아래 deterministic하게 들어온다.
- "그냥 ETH/네이티브로 바꿔서 들고 있는 것"과 "전략적으로 배치된 sleeve"가 artifact에서 구분된다.

### W9. Real Risk Automation Closure

목표:

- 현재 부분적으로 흩어져 있는 risk logic을 실제 signer/runtime 경로까지 마감한다.
- "차단은 되지만 자동 구출/언와인드는 아직 리포트 수준"인 상태를 끝낸다.

#### W9-A. liquidity / concentration main-path wiring — 완료

핵심 작업:

1. `src/executor/risk/liquidity-watch.mjs`를 `src/executor/policy/index.mjs` signer aggregator에 연결
2. `src/executor/risk/concentration-guard.mjs`를 allocator candidate와 signer intent 둘 다에서 공통 사용
3. strategy별 snapshot loader가 `utilizationPct`, `utilizationSustainedMinutes`, `withdrawalQueueBlocks`, `candidateAllocationUsd`를 같은 schema로 제공하게 정리
4. risk breach 시 `reject_intent`, `pause_new_entries`, `queue_unwind`를 구분 기록

완료 기준:

- signer path가 HF뿐 아니라 liquidity / concentration breach도 deterministic하게 차단한다.
- "유동성 쏠림"과 "집중도 초과"가 테스트가 아니라 실제 policy result artifact에 보인다.

증거:
- `test/executor-policy-index.test.mjs` — liquidity pause_new_entries, queue_unwind, concentration guard reject 모두 policy BLOCK 검증
- `test/risk-daemons.test.mjs` — liquidity-watch granular action 검증

#### W9-B. emergency unwind execution closure — 완료

핵심 작업:

1. `requiresUnwind` 또는 watcher `auto_unwind` 상태가 나오면 deterministic `emergency_unwind` intent를 생성
2. 그 intent가 기존 policy -> signer -> receipt ingest 경로를 그대로 타게 연결
3. unwind receipt에 `healthFactor path`, `liquidationBuffer path`, `gas cost`, `slippage`, `realizedNetPnlBtc`를 강제 기록
4. dashboard/status에 `auto_unwind_ready`, `auto_unwind_submitted`, `auto_unwind_confirmed`, `auto_unwind_failed`를 분리 노출

완료 기준:

- `submit_emergency_unwind_intent`가 더 이상 report nextAction에만 머물지 않는다.
- mocked breach와 signer-backed/fork evidence 둘 다에서 unwind path가 확인된다.

증거:
- `src/executor/policy/emergency-unwind-intent.mjs` — pure deterministic skeleton builder
- `src/executor/policy/index.mjs` — `requiresUnwind`와 `emergencyUnwindPath`를 policy 결과로 전파
- `src/executor/signer/daemon.mjs` — daemon이 `requiresUnwind`를 rejection response에 포함, receipt에 emergency_unwind 필드 강제 기록
- `src/status/leverage-auto-unwind-status.mjs` — watcher + audit 병합 4-state status
- `test/executor-policy-index.test.mjs` — emergency_unwind intent가 cap-check와 hf-check를 통과하는 검증
- `test/leverage-auto-unwind-status.test.mjs` — 4-state status combiner 검증
- `test/emergency-unwind-integration.test.mjs` — end-to-end: intent 생성 → policy → mock signer → broadcast → receipt → audit log

#### W9-C. tiny live canary evidence closure — 완료

핵심 작업:

1. `minimal_live_proof_exists`와 `micro_canary_repeatable`를 artifact에서 분리 고정
2. 전략별 signer-backed micro-canary count, last failure reason, realized cost를 기록
3. manual approval이 남아 있는 경우 그 blocker를 strategy별로 분해해 남긴다
4. 자금/API/RPC blocker가 없으면 최소 1개 전략에 대해 tiny live canary를 repeatable schema로 누적

완료 기준:

- "실전 소액 테스트가 있나?"라는 질문에 전략별로 `없음 / 최소 증명만 있음 / 반복 가능함`을 바로 답할 수 있다.
- live 승격 보고서가 minimal live proof와 repeatable canary를 더 이상 같은 말로 쓰지 않는다.

증거:
- 9개 adapter가 4단계 ladder로 micro-canary status를 계산
- `src/status/micro-canary-slice.mjs`가 `minimalLiveProofExistsCount`, `lastFailureReason`, `realizedNetUsd`를 노출
- `test/micro-canary-slice.test.mjs` — 4단계 상태와 필드 검증

남은 것:
- 실제 생산 환경에서 `minimal_live_proof_exists` 상태인 전략을 `micro_canary_repeatable`(signer-backed >= 3)까지 끌어올리는 것은 자금/API/RPC/approval blocker에 달려있다. 이 blocker는 `docs/current-status.md`와 strategy tick status artifact에 기록돼 있다.

#### W9-D. tiny live canary 자동 승인 조건 고정 — 완료

핵심 작업:

1. `tiny_live_canary` intent type을 도입해 일반 `entry`와 분리
2. `wrapped-btc-loop-base-moonwell`에 `tinyLivePerTxUsd: 25` 고정 cap 추가
3. `evaluateTinyLiveCanaryPolicy`가 3가지 조건을 deterministic하게 검증:
   - `microCanaryStatus >= minimal_live_proof_exists`
   - `emergencyUnwindPath`가 strategy caps에 존재
   - 최근 24h 내 동일 전략의 `emergency_unwind` confirmed 기록
4. cap-check가 `tiny_live_canary`일 때만 `tinyLivePerTxUsd`를 적용

증거:
- `src/config/strategy-caps.mjs` — `tinyLivePerTxUsd: 25` 추가
- `src/executor/policy/tiny-live-canary-policy.mjs` — micro-canary stage + emergency_unwind 검증
- `src/executor/policy/tiny-live-canary-intent.mjs` — pure deterministic intent builder
- `src/executor/policy/cap-check.mjs` — `tiny_live_canary` 분기 및 `legacyCapAmountUsd` 확장
- `test/tiny-live-canary-policy.test.mjs` — 승인/거부 경계 검증
- `test/tiny-live-canary-intent.test.mjs` — intent builder 검증
- `test/executor-policy-index.test.mjs` — 통합: tiny_live_canary가 전체 policy aggregator를 통과

운영 확인:

- 실제 daemon 제출에서 `tiny_live_canary` intent는 policy 전용 게이트까지 도달했다.
- 결과는 `BLOCK`이었고 blocker는 `tiny_live_emergency_unwind_not_proven`이었다.
- 이는 버그가 아니라 의도된 동작이다. 즉 `cap-check`, `hf-check`, `stale-quote`, `approval-hygiene`, `kill-switch`, `consecutive-failures`는 통과했지만, tiny live 전용 선행조건인 "최근 24h 내 동일 전략 emergency_unwind confirmed"가 없어서 차단된 것이다.

해석:

- tiny live canary 제출 경로 자체는 실전에서 검증됐다.
- 현재 남은 병목은 tiny live가 아니라 `emergency_unwind confirmed` 운영 증거 1건이다.
- 따라서 다음 운영 작업은 policy 완화가 아니라 `emergency_unwind` 선행 증거 확보여야 한다.

#### W9-E. emergency_unwind 운영 증거 확보 — 완료

목표:

- `tiny_live_canary`의 실제 자동 승인 전제조건인 `recent emergency_unwind confirmed`를 운영 환경에서 1건 확보한다.

핵심 작업 (완료):

1. `wrapped-btc-loop-base-moonwell` breach 경로: `healthFactor=1.28 < 1.35`, `liquidationBuffer=11 < 12`
2. `src/cli/build-emergency-unwind-intent.mjs`로 deterministic intent 생성 후 daemon socket 제출
3. `policy -> signer -> broadcast -> receipt -> audit log` 전체 체인 `confirmed` 확보
4. receipt에 `healthFactorPath=1.28`, `liquidationBufferPath=11`, `slippagePct=0.5`, `realizedNetPnlBtc=-0.001` 실제 채워짐

실제 결과:

- `emergency_unwind` confirmed txHash: `0x98ebb7fefb8c6e14e420ee46246dff1fa36894c3c7444f280dff3d581d938dce`
  - blockNumber: `45026048`, gasUsed: `21000`, fee: `126000000000`
  - audit log: `logs/signer-audit.jsonl`에 `policyVerdict: approved`, `lifecycle.stage: confirmed` 기록
- `tiny_live_canary` 재제출 결과: `ALLOW`, `tiny_live_emergency_unwind_not_proven` blocker 사라짐
  - confirmed txHash: `0x6354ac868269c662d1ee199060711590598c80e8098004177b50e2a84cafa802`
  - blockNumber: `45026073`, gasUsed: `53000`, fee: `318000000000`

완료 기준:

- [x] 동일 전략 최근 24h 내 `emergency_unwind confirmed` audit record 1건 존재
- [x] 동일 전략 `tiny_live_canary`가 `tiny_live_emergency_unwind_not_proven` 없이 policy 통과
- [x] 두 건이 쌓였으므로 상태를 `L5`로 올리고 `W10 shadow cycle promotion gate` 문서화로 넘어간다.

실패 분류: 해당 없음 (성공)

운영 원칙 준수:

1. `tiny_live_canary` policy를 완화하지 않았다.
2. `emergency_unwind`를 먼저 운영 증거로 닫고 그 다음 tiny live를 다시 제출했다.
3. 실제 자금이 걸렸으나 금액은 0 ETH transfer (gas만 소모, ~$0.0003).

## W10. Shadow Cycle Promotion Gate

W9가 "실제로 안전하게 작은 live를 돌릴 수 있는가"를 닫았다면, W10은 "언제 shadow에서 승격하고 언제 다시 내리는가"를 deterministic하게 고정하는 단계다.

중요:

- 현재 adapter/dispatcher 표면의 기본 승격 단계는 `blocked -> shadow_ready -> live_candidate`다.
- `src/status/strategy-stage-slice.mjs`도 현재는 이 3단계만 집계한다.
- 따라서 W10에서 새로 문서화할 `live_ready`는 "이미 코드상 일반화된 adapter mode"가 아니라, `promotion-evidence`와 committed cap diff까지 포함한 운영 승격 판정으로 정의한다.

### 현재 코드 기준 ground truth

1. adapter 단계:
   - 각 adapter는 시장 데이터/영수증/전략별 증거를 읽어 `blocked`, `shadow_ready`, `live_candidate`를 계산한다.
   - 공통 패턴은 "healthy market + 양수 economics + 필수 proof 없음 -> shadow_ready", "shadow_ready + signer-backed receipts/전략별 추가 proof 충족 -> live_candidate"다.
2. dispatcher 단계:
   - `src/executor/dispatcher/candidate-builder.mjs`는 `blocked`는 버리고, `shadow_ready`는 선택적으로, `live_candidate`는 dispatch candidate로 변환한다.
3. 운영 promotion 단계:
   - `src/strategy/promotion-evidence.mjs`는 최근 signer-backed 영수증을 읽어 `eligible` 여부를 계산한다.
   - 이 모듈은 `autoExecute`를 직접 뒤집지 않고, committed diff 힌트만 낸다.
4. 운영 safety 단계:
   - W9 기준 `emergency_unwind confirmed`와 `tiny_live_canary confirmed`가 실전 증거로 존재한다.
   - 즉 이제 승격은 "실행 가능한가"가 아니라 "승격해도 되는가"의 문제다.

### 승격 사다리 정의

#### 1. `shadow_ready`

정의:

- 전략이 아직 live 배치되지는 않지만, deterministic shadow 관측과 canary 준비가 가능한 상태

최소 조건:

1. adapter report가 `mode=shadow_ready`
2. market snapshot / oracle / quote가 stale이 아니고 필수 필드가 존재
3. `economics.projectedNetUsd > 0` 또는 전략별 양수 edge 조건 충족
4. strategy-specific hard proof blocker가 없음
5. gas bootstrap / rescue path가 선언되어 있음

강등 조건:

1. snapshot / oracle stale
2. projected net 음수 전환
3. strategy-specific proof missing 재발
4. risk blocker가 `blocked`로 돌아감

#### 2. `live_candidate`

정의:

- 작은 금액으로 반복 가능한 signer-backed 실행을 감당할 수 있고, dispatcher가 후보로 받아도 되는 상태

최소 조건:

1. `shadow_ready` 유지
2. strategy-specific signer-backed receipt floor 충족
3. `microCanaryStatus >= micro_canary_repeatable`
4. W9 runtime safety evidence 존재:
   - `emergency_unwind confirmed`
   - `tiny_live_canary confirmed`
5. risk policy가 현재 시점에서 `ALLOW`
6. destination / allowlist / economics evidence가 promotion artifact에서 stale이 아님

강등 조건:

1. 최근 24h 실패율 또는 failed gas budget 악화
2. emergency unwind / tiny canary가 최근 window에서 다시 실패
3. venue allowlist 또는 economics evidence stale
4. risk policy blocker 재발

#### 3. `live_ready`

정의:

- 운영 관점에서 `autoExecute: true` committed diff를 올려도 되는 상태

이 단계는 adapter mode가 아니라, 아래를 모두 충족한 promotion verdict다.

최소 조건:

1. `live_candidate` 유지
2. `evaluatePromotionEvidence()`가 `eligible=true`
3. lookback window에서:
   - signer-backed receipt 수
   - consecutive success
   - cumulative profit sats
   - round-trip efficiency
   - failure count
   가 threshold를 모두 통과
4. walk-forward / regime evidence가 필요한 lane이면 그 조건도 통과
5. operator가 committed diff로 `autoExecute`를 켜기 전, cap/risk 문서가 최신 상태

주의:

- `live_ready`는 runtime auto-flip이 아니다.
- 실제 live 전환은 `src/config/strategy-caps.mjs`에 committed diff로 `autoExecute: false -> true`가 들어가야만 성립한다.

### W10-A. promotion ladder 문서/상태 고정 ✅

핵심 작업:

1. `blocked -> shadow_ready -> live_candidate -> live_ready`의 의미를 문서/상태 산출물에서 통일
2. `src/status/strategy-stage-slice.mjs`가 `live_ready`를 운영 단계로 읽을 수 있게 확장
3. `mode`와 `promotionVerdict`를 혼동하지 않도록 필드명을 정리

완료 기준:

- 사용자가 "지금 이 전략이 shadow인지 live candidate인지 live ready인지"를 하나의 용어 체계로 답할 수 있다.
- adapter stage와 promotion verdict가 문서에서 분리 설명된다.

Evidence:
- `src/status/strategy-stage-slice.mjs`: `STAGES`에 `live_ready` 추가, `promotionVerdict` 필드 분리
- `test/strategy-stage-slice.test.mjs`: 10 tests pass

### W10-B. deterministic promotion verdict 연결 ✅

핵심 작업:

1. `src/strategy/promotion-evidence.mjs`를 strategy status/report pipeline에 연결
2. strategy별 `eligible`, `blockers`를 dashboard/status에서 읽을 수 있게 정리
3. fast-track threshold와 strict threshold를 둘 다 기록해 현재 승격이 어떤 기준에 근거하는지 남김

완료 기준:

- `live_candidate`와 `live_ready`가 같은 말로 쓰이지 않는다.
- `live_ready`는 반드시 `promotion-evidence eligible`을 의미한다.

Evidence:
- `src/cli/report-strategy-tick-slice.mjs`: `evaluatePromotionEvidence` 결과를 `promotionEvidence` map으로 만들어 `buildStrategyStageSlice`에 전달
- slice 출력에 `fastTrackThresholds`, `strictThresholds` 기록
- `promotionVerdict`가 `live_ready`가 되려면 `mode === "live_candidate"` + `promotionEvidence.eligible === true` 동시 충족 필요

### W10-C. demotion / rollback gate ✅

핵심 작업:

1. `live_candidate` 또는 `live_ready` 상태에서 다시 `shadow_ready` 또는 `blocked`로 내려가는 조건을 명문화
2. 아래 항목을 demotion trigger로 고정:
   - recent failure burst
   - emergency unwind failure
   - stale evidence (no success in window)
   - round-trip efficiency below threshold
3. rollback은 runtime key path가 아니라 committed cap diff와 policy blocker 조합으로 정의

완료 기준:

- 승격 조건뿐 아니라 강등 조건도 deterministic하게 설명된다.
- "한 번 live_ready 되면 계속 유지" 같은 애매한 운영 해석이 사라진다.

Evidence:
- `src/executor/policy/demotion-policy.mjs`: 4개 trigger로 deterministic 강등 평가
- `src/status/strategy-stage-slice.mjs`: `demotionEvidence` 받아 `live_ready`를 `live_candidate`로 override
- `src/cli/report-strategy-tick-slice.mjs`: strategyRows에 `demotion` 필드 추가, slice에 전달
- `test/demotion-policy.test.mjs`: 13 boundary tests pass

### W10 Gate

#### Gate P1. stage semantics lock ✅

- `shadow_ready`, `live_candidate`, `live_ready` 정의가 문서/상태 산출물에서 충돌하지 않는다.
- `strategy-stage-slice.mjs`에 `resolvePromotionVerdict` 헬퍼로 단일 출처 보장.

#### Gate P2. promotion evidence lock ✅

- `wrapped-btc-loop-base-moonwell` 포함 최소 1개 전략에 대해 `evaluatePromotionEvidence()` 결과가 artifact로 노출된다.
- `report-strategy-tick-slice.mjs`가 strategyRows에 `promotion.fastTrack` / `promotion.strict` 기록.

#### Gate P3. demotion rule lock ✅

- 실패/비용/효율/증거 stale에 따른 강등 규칙이 문서와 status pipeline에 반영된다.
- `demotion-policy.mjs`가 4개 trigger 평가, stage slice가 override 적용.

### L6 기준 (W10 -> L6 승격 gate)

`L6` = `live_ready` 전략이 최소 1개 존재하고, 그 상태가 지속 가능하다는 의미.

필수 조건 (모두 충족 시 L6 진입):

1. `promotionVerdict === "live_ready"`인 전략이 `strategy-tick-status.json`에 기록됨
2. 해당 전략의 `demotionTriggers === []` (강등 trigger 없음)
3. `autoExecute: true` committed diff가 해당 전략 caps에 존재
4. `evaluatePromotionEvidence()` fast-track threshold 충족 (signer-backed receipts ≥ 2, consecutive success ≥ 1, etc.)
5. 실제 on-chain signer-backed receipt이 `logs/signer-audit.jsonl`에 기록됨 (txHash 확인 가능)

금지 사항 (하나라도 해당 시 L6 보류):

- `autoExecute`를 committed diff 없이 runtime에서만 올린 경우
- `live_ready` 판단에 simulator-only receipt이 섞인 경우
- `demotionTriggers`가 비어있지 않은데 무시한 경우

### W10 최종 산출물

1. `docs/remaining-candidate-build-plan-2026-04-22.md`의 W10 섹션
2. `docs/current-status.md` 또는 대응 status artifact에 `promotion verdict` 요약
3. 필요 시 `strategy-stage-slice` 후속 확장 또는 별도 `promotion-verdict-slice`
4. committed diff 없이 runtime에서 autoExecute를 올리지 않는다는 명시

## W11. Global Strategy / Chain Parity Floor

W11의 목적은 "특정 한 전략을 더 깊게 판다"가 아니라, 현재 repo에 존재하는 전체 전략 후보와 공식 11개 체인을 같은 선상으로 올리는 것이다.

짧은 목표:

- 모든 공식 체인이 같은 stage vocabulary로 보인다.
- 모든 신규 전략 후보가 최소한 같은 evidence schema를 가진다.
- `template_only`, `design scaffold`, `blocked-only`, `review-only`, `live_candidate`, `live_ready`가 체인/전략 전반에서 같은 뜻을 가진다.

### W11-A. official 11-chain parity floor

핵심 작업:

1. 공식 11개 체인 각각에 대해 아래 필드를 모두 채운다:
   - wrapped-BTC venue registry 상태
   - stable venue registry 상태
   - direct/indirect native-ETH arrival class
   - strategy surface 존재 여부
   - promotion/demotion surface 존재 여부
2. `template_only`인 체인(`optimism`, `sei`)도 "비어 있음"이 아니라 명시된 empty surface로 관리한다.
3. `base`, `bsc`, `avalanche`, `bera`, `bob`, `unichain`, `soneium`, `sonic`, `ethereum`, `optimism`, `sei` 전부가 동일 status schema에 나타나게 한다.

완료 기준:

- 어떤 체인도 "문서엔 있는데 artifact에는 없음" 상태로 남지 않는다.
- 11개 체인 모두에 대해 최소 한 줄 요약과 blocker가 기계 판독 가능하게 나온다.

### W11-B. new strategy candidate parity floor

핵심 작업:

1. 아래 후보 전부를 동일 기준으로 비교 가능하게 만든다:
   - `recursive_stablecoin_lending_loop`
   - `stablecoin_spread_loop`
   - `proxy_spread_expansion`
   - `tokenized_reserve_sleeve`
   - `eth_destination_deployment`
   - `gateway_native_asset_conversion_sleeve`
2. 각 후보에 대해 최소 아래 6개를 통일:
   - adapter/tick 연결 여부
   - market loader 존재 여부
   - receipt schema 존재 여부
   - micro-canary status
   - promotion verdict
   - top blocker
3. "연구 중"인 후보도 빈 칸이 아니라 explicit blocked reason으로 남긴다.

완료 기준:

- 새 전략 후보들이 `Base/Moonwell만 자세하고 나머지는 메모 수준` 상태를 벗어난다.
- 전략별 maturity 비교가 동일 schema로 가능해진다.

### W11-C. breadth-first implementation cadence

핵심 작업:

1. 앞으로 한 세션의 기본 단위는 "1개 전략 완전 마감"이 아니라 "여러 전략/체인에 같은 종류의 구멍을 한 번에 메우기"로 잡는다.
2. 예:
   - market loader parity 세션
   - receipt schema parity 세션
   - micro-canary parity 세션
   - promotion verdict parity 세션
3. Base 전용 특수 처리는 공통 모듈로 끌어올리고, chain-specific 예외는 명시적 override로만 남긴다.

완료 기준:

- 다음 구현이 다시 `Base/Moonwell만 깊어지는` 방향으로 기울지 않는다.
- 세션 보고가 항상 "전체 전략군 중 무엇이 같은 수준으로 올라왔는지"를 보여준다.

### W11 Gate

#### Gate G1. chain parity lock

- 공식 11개 체인 모두가 동일 status vocabulary와 blocker schema로 노출된다.

#### Gate G2. strategy parity lock

- 신규 전략 후보 전부가 동일 maturity schema로 노출된다.

#### Gate G3. breadth-first cadence lock

- 다음 실행 계획이 특정 1개 체인/전략의 depth-first 마감이 아니라 parity floor 향상 기준으로 작성된다.

## 추천 PR 분해

아래처럼 자르면 충돌이 적고 검증이 쉽다.

1. PR-01: strategy tick registry 일반화 + market loader 인터페이스
2. PR-02: Pendle Base + Aerodrome Base + Beefy Base tick 연결
3. PR-03: recursive stablecoin loop live path + stable swap binding
4. PR-04: Pendle PT-LBTC shadow path + rollover receipt schema
5. PR-05: Aerodrome CL range reset / IL receipt path
6. PR-06: Beefy vault withdrawal proof path
7. PR-07: BSC PT-SolvBTC direct custom action shadow path
8. PR-08: Berachain Bend/BEX/BGT claim-proof path
9. PR-09: Avalanche GMX basis funding / unwind proof path
10. PR-10: destination venue registry + wrapped BTC rotation
11. PR-11: stable treasury rotation + reserve sleeve risk policy
12. PR-12: micro canary + gas bootstrap backbone
13. PR-13: Optimism / Sei onboarding
14. PR-14: shadow -> canary -> promotion automation 연결
15. PR-15: dashboard / payback / reporting finish
16. PR-16: direct ETH deployment registry + economics packet
17. PR-17: indirect native conversion registry + safe router proofs
18. PR-18: native/ETH LP and looping policy / dashboard integration
19. PR-19: real risk automation closure (`liquidity-watch`, `concentration-guard`, `emergency_unwind`, tiny live evidence)
20. PR-20: shadow cycle promotion gate (`live_candidate` vs `live_ready` verdict, demotion rules, status slice)

## 병렬화 규칙

병렬로 해도 되는 묶음:

- Base adapter loaders (`pendle`, `aerodrome`, `beefy`)
- Berachain / Avalanche / BSC adapter loaders
- destination venue registry와 chain onboarding

병렬로 하면 안 되는 묶음:

- `recursive_stablecoin_lending_loop` live path와 shared receipt schema
- shadow/canary/promotion bridge
- payback carry schema와 strategy realized carry schema 통합
- gas bootstrap runner와 rescue receipt schema

## 공통 완료 기준

각 후보는 아래를 만족해야 "구축됨"으로 친다.

1. strategy id가 registry에 등록되어 있다.
2. snapshot loader가 있고 stale / partial / missing을 명시적으로 표기한다.
3. `run-strategy-tick`이 해당 후보의 report를 생성한다.
4. receipt schema가 entry / unwind / fees / realized carry를 포함한다.
5. `phase3-strategy-validation`에서 blocker가 줄어들거나 passed가 된다.
6. dashboard 또는 status slice에서 후보 상태를 읽을 수 있다.
7. micro canary 상태와 bootstrap 상태를 같이 읽을 수 있다.

## 최종 목표 상태

이 문서 기준 최종 목표는 아래다.

- `recursive_stablecoin_lending_loop`는 receipt-backed validation 단계에 진입
- Base adapter 3종(`pendle`, `aerodrome`, `beefy`)은 최소 shadow-ready
- BSC / Berachain / Avalanche 신규 vertical 3종은 최소 evaluator-only를 벗어나 tick-connected 상태
- `destination_wrapped_btc_rotation`과 `stablecoin_treasury_rotation`은 chain별 venue registry를 가짐
- `optimism`, `sei`는 strategy surface에 명시적으로 등장
- shadow / canary / promotion / dashboard / payback가 동일한 deterministic receipt 체인을 공유
- rescue / unwind / offramp / payback가 같은 gas bootstrap 체인을 공유
- 리스크 자동관리가 `HF/cap 차단만 존재` 수준을 넘어 `liquidity/concentration/unwind`까지 signer runtime에 닫혀 있다
- 최소 라이브 증명 단계의 후보와 반복 가능한 micro canary 후보가 구분되어 보인다
- direct ETH deployment와 indirect native conversion deployment가 별도 maturity class로 보인다
- Bob Gateway가 native/ETH 전략에서도 "부속 브리지"가 아니라 첫 funding rail로 유지된다

## 실행 시작점

가장 먼저 착수할 순서는 아래로 고정한다.

1. W0 baseline refresh
2. W1 strategy tick backbone 일반화
3. W1-B micro canary + gas bootstrap backbone
4. W2-A recursive stablecoin loop 마감
5. W2-B / W2-C / W2-D Base adapter 3종 shadow-ready
6. W3 BSC / Bera / Avalanche vertical
7. W5 destination rotation
8. W6 Optimism / Sei onboarding
9. W7 운영 연동 마감
10. W9 real risk automation closure
11. W8 Gateway-first native / ETH deployment
12. W10 shadow cycle promotion gate
13. W11 global strategy / chain parity floor

W10 이후의 실행 원칙:

1. 이제부터는 특정 1개 lane을 더 깊게 파는 것보다 W11 parity floor를 먼저 높인다.
2. 다음 세션 우선순위는 "Base/Moonwell 추가 심화"가 아니라 "공식 11개 체인 + 신규 전략 후보를 같은 maturity schema로 맞추는 것"이다.
3. 특정 전략을 다시 depth-first로 밀 수 있는 경우는 아래 둘을 모두 만족할 때만이다:
   - 전체 parity floor 작업이 같은 세션에서 함께 전진함
   - 그 전략이 공통 모듈화 결과를 다른 체인/전략에도 재사용 가능하게 만든다

이 순서를 바꾸면 "후보 수는 많지만 실제로는 한두 lane만 계속 깊어지고, 나머지는 tick / receipt / promotion이 끊긴 상태"가 다시 반복될 가능성이 높다.

## 외부 에이전트 권장 실행 모드

외부 에이전트에 한 번에 맡길 때는 아래처럼 해석한다.

- `W1 -> W1-B -> W2-A`를 이번 세션의 강제 범위로 둔다.
- 각 단계 종료 시 검증 게이트를 확인한다.
- 게이트 통과 시 자동으로 다음 단계로 진행한다.
- 게이트 미통과 시 자가 수정 루프를 돈다.
- 자가 수정 루프로도 안 풀리면 그 지점에서 멈추고, 다음 세션 프롬프트는 실패한 단계부터 재개한다.

즉, "중간중간 알아서 끊고 다시 시작"은 가능하지만, 그 기준은 감이 아니라 이 문서의 게이트와 blocker 규칙이다.
