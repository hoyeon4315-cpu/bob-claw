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
- 현재 `run-strategy-tick.mjs`는 이미 존재하지만 등록 adapter가 `beefy-folding-vault` 하나뿐이라, 본 계획에서는 이를 "backbone 초안 존재" 상태로 본다.

## 범위

이번 계획의 범위는 다음과 같다.

- 남아 있는 전략 후보 전부
- 아직 strategy surface에 안 올라온 Gateway 공식 체인 (`optimism`, `sei`)
- destination venue registry / promotion gate / allocator 확장
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
| Chain onboarding | `optimism`, `sei` | Optimism / Sei | destination TBD | not on strategy surface | registry entries, gas snapshots, venue mapping, quote coverage |

## 우선순위 원칙

구축 순서는 아래 원칙을 따른다.

1. `Base/Moonwell`에서 검증된 부품을 최대한 재사용한다.
2. evaluator만 있는 후보를 먼저 "shadow 가능한 후보"로 올린다.
3. 새 체인 추가보다 `receipt -> tick -> canary -> promotion` 연결을 먼저 완성한다.
4. BOB Gateway transport proof만으로 전략 완료로 치지 않는다.
5. 모든 전략은 `BTC-denominated`, `deterministic`, `cap = code` 원칙을 지킨다.
6. 실전 소액 테스트는 전략별 `micro-canary`로 명시 관리한다. "최소 라이브 증명"과 "전략 canary 통과"는 같은 말이 아니다.
7. `rescue`, `unwind`, `offramp`, `gas top-up`은 모두 운영 부속작업이 아니라 전략 생존 조건이다. 가스 부족으로 rescue가 멈추면 그 전략은 구축 완료가 아니다.

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
- 최소 라이브 증명 단계의 후보와 반복 가능한 micro canary 후보가 구분되어 보인다

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

이 순서를 바꾸면 "후보 수는 많지만 실제로는 tick / receipt / promotion이 끊긴 상태"가 다시 반복될 가능성이 높다.
