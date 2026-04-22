# One-Push Pre-live Parity Plan

Updated: 2026-04-22

## 목적

이 문서는 현재 `L5` 상태에서 **실전 직전(pre-live just before autoExecute flip)** 까지 한 번에 밀기 위한 단일 실행 문서다.

핵심 목표는 두 가지다.

1. 특정 1개 전략을 더 깊게 파는 것이 아니라, **공식 11개 체인 + 신규 전략 후보 전부를 같은 maturity floor**로 올린다.
2. 그 결과가 **dashboard/public/dashboard-status.json** 하나로 읽히도록 정리한다.

즉 이 문서는 "코드 몇 개 더 붙이기"가 아니라 아래를 한 세션에서 끝내기 위한 문서다.

1. parity floor 정리
2. status/report/dashboard 반영
3. 실전 직전 freeze artifact 생성
4. live 전환 직전의 명확한 stop line 고정

## 이번 문서의 stop line

이 계획은 **실전 직전까지**가 범위다.

여기서 멈춘다:

- `autoExecute: false -> true` 실제 승격 diff는 작성 초안까지만
- signer daemon 실제 제출 없음
- on-chain tiny canary / live execution 없음
- payback 실전 disbursement 없음

즉 끝 상태는:

- 모든 공식 체인/전략 후보가 동일 schema로 보이고
- dashboard가 그 상태를 읽고
- operator가 마지막 승인 diff만 하면 되는 상태

## current ground truth

현재 repo 기준 사실:

1. W9 리스크 자동관리와 W10 promotion/demotion gate는 구현 완료다.
2. 공식 11개 체인 전체 parity가 `dashboard-status.json`의 `strategy.chainParity`로 노출된다.
3. 신규 전략 후보 6개가 `strategy.strategyParity`로 동일 maturity schema로 노출된다.
4. dashboard는 `dashboard-status.json` 하나만 읽는다 (`strategy-tick-status.json` fetch 제거 완료).
5. AGENTS / dashboard-context 기준 최종 읽기 경로는 `dashboard/public/dashboard-status.json` 하나로 정리 완료.

## 최종 목표 상태

이 문서가 끝났을 때의 목표:

1. 공식 11개 체인 모두가 dashboard/status에 같은 vocabulary로 보인다.
2. 신규 전략 후보 전부가 같은 maturity schema로 보인다.
3. `strategy-tick-status.json`에만 있던 전략 승격 정보가 `dashboard-status.json`에도 안전하게 반영된다.
4. dashboard UI는 `dashboard-status.json` 하나만 읽어도 전략/체인 parity 상태를 보여준다.
5. 각 전략은 최소 아래를 가진다:
   - stage
   - promotion verdict
   - demotion state
   - micro-canary state
   - top blocker
   - last evidence freshness
6. live 직전 operator decision pack이 생성된다.

## 공통 원칙

1. breadth-first parity 우선. Base/Moonwell만 더 깊게 파지 않는다.
2. 공식 11개 체인과 신규 전략 후보를 같은 schema로 비교 가능하게 만든다.
3. dashboard는 read-only다.
4. browser는 최종적으로 `dashboard/public/dashboard-status.json` 하나만 읽게 한다.
5. raw JSONL이나 signer/executor 내부 세부를 브라우저에 직접 노출하지 않는다.
6. 실전 전환은 committed diff와 operator 승인 전에는 하지 않는다.

## 실행 범위

이번 one-push 범위에 포함:

- official 11-chain parity floor
- new strategy candidate parity floor
- promotion/demotion/micro-canary/dashboard integration
- operator-facing decision pack
- pre-live freeze artifact

이번 one-push 범위에서 제외:

- 실 live execution
- autoExecute flip 실제 반영
- strategy alpha를 억지로 양수로 만드는 것
- manual review를 runtime bypass로 대체하는 것

## Workstream Map

### P0. Baseline Freeze

목표:

- 현재 artifact를 새로 생성해 기준선을 고정한다.

필수 명령:

```bash
npm run report:strategy-snapshot -- --write
npm run report:deterministic-strategy-candidates -- --write
npm run report:destination-promotion-gate -- --write
npm run report:strategy-tick-slice -- --write
npm run status:dashboard
```

완료 기준:

- `data/`와 `dashboard/public/` 산출물이 현재 코드와 충돌하지 않는다.

### P1. Official 11-chain Parity Floor

목표:

- 공식 11개 체인이 모두 동일 status vocabulary로 보이게 만든다.

필수 작업:

1. 각 체인마다 아래 필드를 status pipeline에 넣는다.
   - chain id
   - wrapped-BTC venue 상태
   - stable venue 상태
   - native/ETH arrival class
   - strategy surface presence
   - current maturity
   - top blocker
2. `optimism`, `sei`처럼 `template_only`인 체인도 explicit empty surface로 남긴다.
3. `base`, `ethereum`, `bsc`, `avalanche`, `bera`, `bob`, `unichain`, `soneium`, `sei`, `optimism`, `sonic` 모두가 dashboard-safe slice에 나타나게 한다.

수정 후보:

- `src/config/destination-venues.mjs`
- `src/config/stable-venues.mjs`
- `src/config/eth-venues.mjs`
- `src/config/native-asset-venues.mjs`
- `src/status/dashboard-status.mjs`
- 필요 시 신규 `src/status/chain-parity-slice.mjs`

완료 기준:

- 11개 체인 모두에 대해 `missing`이 아니라 explicit status와 blocker가 나온다.

### P2. New Strategy Candidate Parity Floor

목표:

- 신규 전략 후보 전부가 같은 maturity schema로 노출되게 만든다.

대상 후보:

- `recursive_stablecoin_lending_loop`
- `stablecoin_spread_loop`
- `proxy_spread_expansion`
- `tokenized_reserve_sleeve`
- `eth_destination_deployment`
- `gateway_native_asset_conversion_sleeve`

필수 작업:

1. 각 후보마다 아래 필드를 채운다.
   - strategy id
   - chain set
   - adapter/tick 연결 여부
   - market loader 여부
   - receipt schema 여부
   - micro-canary status
   - promotion verdict
   - demotion summary
   - top blocker
2. 아직 구현이 덜 된 후보는 `null`이나 빈칸 대신 explicit blocker를 넣는다.
3. 같은 전략군끼리 표현이 다르지 않게 필드명/단계를 통일한다.

수정 후보:

- `src/cli/report-strategy-tick-slice.mjs`
- `src/status/strategy-stage-slice.mjs`
- `src/status/micro-canary-slice.mjs`
- 필요 시 신규 `src/status/strategy-parity-slice.mjs`

완료 기준:

- 신규 후보 전부가 같은 형태의 카드/행으로 비교 가능하다.

### P3. Dashboard Contract Consolidation

목표:

- dashboard가 `dashboard-status.json` 하나만 읽어도 전략 parity 상태를 보여주게 만든다.

중요:

- 현재 `dashboard/public/data.jsx`는 `strategy-tick-status.json`도 직접 읽는다.
- 이번 workstream에서는 그 의존성을 없애고 `dashboard-status.json`으로 접는다.

필수 작업:

1. `dashboard-status.json`에 아래 전략 parity 필드를 추가/정리한다.
   - `strategy.strategyParity`
   - `strategy.chainParity`
   - `strategy.promotionSummary`
   - `strategy.microCanarySummary`
2. `dashboard/public/data.jsx`가 `strategy-tick-status.json`을 직접 fetch하지 않게 바꾼다.
3. `dashboard/public/app.js` 또는 JSX 렌더 경로가 새 slice를 읽도록 맞춘다.
4. `test/dashboard-status.test.mjs`와 관련 UI contract test를 갱신한다.

수정 후보:

- `src/status/dashboard-status.mjs`
- `dashboard/public/data.jsx`
- `dashboard/public/app.js`
- `dashboard/public/index.html`
- `test/dashboard-status.test.mjs`

완료 기준:

- 브라우저가 `dashboard/public/dashboard-status.json` 하나만 읽는다.
- dashboard에 공식 11개 체인 parity와 신규 전략 parity가 plain-language로 노출된다.

### P4. Promotion / Demotion / Micro-canary Freeze

목표:

- 전략 승격 관련 정보가 dashboard/status에 최종 형태로 정착되게 만든다.

필수 작업:

1. 각 전략에 대해 아래를 dashboard-safe field로 만든다.
   - `mode`
   - `promotionVerdict`
   - `demotion`
   - `demotionTriggers`
   - `microCanaryStatus`
   - `topBlocker`
   - `lastTickAt`
2. `live_candidate`와 `live_ready`를 절대 같은 말로 쓰지 않게 copy도 조정한다.
3. `ready_for_live_flip` 같은 operator-facing plain-language label을 추가할지 검토한다.

수정 후보:

- `src/status/strategy-stage-slice.mjs`
- `src/status/dashboard-status.mjs`
- `dashboard/public/data.jsx`

완료 기준:

- dashboard와 status artifact에서 현재 전략이 어떤 단계인지 plain-language로 바로 읽힌다.

### P5. Pre-live Decision Pack

목표:

- operator가 마지막 live diff 전 검토할 decision pack을 자동 생성한다.

필수 작업:

1. 아래 artifact를 한 번에 새로 생성하는 command chain을 고정한다.
   - strategy snapshot
   - deterministic candidates
   - destination promotion gate
   - strategy tick slice
   - dashboard status
   - current status
2. `docs/current-status.md`에 parity floor 관점의 headline을 추가한다.
3. `L6` 직전 조건과 금지 사항을 이 decision pack에서 바로 읽을 수 있게 한다.

권장 명령:

```bash
npm run report:strategy-snapshot -- --write
npm run report:deterministic-strategy-candidates -- --write
npm run report:destination-promotion-gate -- --write
npm run report:strategy-tick-slice -- --write
npm run status:dashboard
```

완료 기준:

- operator가 code diff 없이 현재 전체 parity와 pre-live readiness를 한 번에 읽을 수 있다.

### P6. Stop Line Before Live

목표:

- 실전 직전에서 멈추는 선을 코드/문서로 분명히 남긴다.

필수 작업:

1. 아래는 하지 않는다.
   - `autoExecute` 실제 flip
   - signer daemon submission
   - live execution
2. 대신 아래만 남긴다.
   - `promotionVerdict=live_ready` 가능 전략 목록
   - operator가 적용할 committed diff 초안
   - 남은 blocker
   - dashboard reflected state

완료 기준:

- "이제 operator가 마지막 승인만 하면 된다"는 상태가 된다.

## Single-session Gates

### Gate S0. Baseline Lock

- P0 산출물 생성 성공
- dashboard/status contract test 깨지지 않음

### Gate S1. Chain Parity Lock

- 11개 체인 모두 explicit status + blocker 노출

### Gate S2. Strategy Parity Lock

- 신규 전략 후보 전부 explicit maturity schema 노출

### Gate S3. Dashboard Contract Lock

- dashboard는 `dashboard-status.json`만 읽음
- `strategy-tick-status.json` browser fetch 제거

### Gate S4. Promotion Surface Lock

- `mode`, `promotionVerdict`, `demotion`, `microCanaryStatus`, `topBlocker`가 dashboard/status에 다 노출

### Gate S5. Pre-live Freeze Lock

- decision pack 생성 완료
- live 직전 stop line 문서화 완료
- 실제 live 전환은 하지 않음

## Hard blockers

아래는 세션 중단 허용 blocker다.

1. dashboard contract 충돌이 큰 범위로 퍼져 한 세션 내 해결이 불가능한 경우
2. 특정 체인/전략에 대한 source artifact가 repo에 전혀 없어 empty surface 이상으로 못 올리는 경우
3. generated artifact regeneration이 반복적으로 깨지고 원인이 외부 의존성인 경우

아래는 중단 불가 blocker다.

1. import 누락
2. slice shape mismatch
3. dashboard fetch path 충돌
4. test failure
5. field naming inconsistency

## 대시보드 반영 원칙

1. dashboard는 표보다 지도/흐름 중심 UX를 유지한다.
2. 내부 모듈명은 copy로 노출하지 않는다.
3. blocker는 plain-language로 번역한다.
4. "관찰 중", "증거 축적 중", "승격 검토 가능", "자동 승격 아님" 같은 표현을 쓴다.
5. `liveTrading=ALLOWED`여도 dashboard는 실행 권한을 가진 것처럼 보이면 안 된다.

## 최종 산출물

이번 one-push가 끝나면 최소 아래가 있어야 한다.

1. 코드
   - parity slice / dashboard status consolidation
2. 문서
   - current status
   - build plan 반영
3. 산출물
   - `data/dashboard-status.json`
   - `dashboard/public/dashboard-status.json`
   - strategy snapshot / tick slice / promotion gate 결과
4. 테스트
   - dashboard contract
   - status slice
   - parity-related unit tests

## Claude Code 단일 세션 실행 원칙

1. 가능하면 한 세션에서 P0 -> P6까지 연속으로 진행한다.
2. 각 Gate에서 실패하면 1~3회 자가 수정 루프를 먼저 돈다.
3. hard blocker가 아니면 다음 단계로 넘어가지 않는다.
4. breadth-first parity를 우선하고, 특정 1개 전략/체인만 깊게 파지 않는다.
5. 실전 execution이나 autoExecute flip은 하지 않는다.

