# Merkl 기반 공격적 기회 회전 시스템 마스터 플랜 (2026-04-22)

목적: BOB Gateway 전체 활성화가 늦어지는 동안에도, Merkl 류의 incentive surface를 자동 감시하고, BTC-first 원칙을 유지한 채 공격적으로 수익 기회를 포착하는 시스템을 구축한다.

이 문서는 사람, Claude Code, Codex, Copilot 같은 다른 코딩 도구가 바로 이어서 작업할 수 있도록 전체 범위, 설계 원칙, 구현 순서, 검증 기준을 빠짐없이 적는다.

## 0. 운영 입장

운영자 의도는 분명하다.

- 너무 보수적으로 시간을 낭비하지 않는다.
- 드라이런을 수익 검증의 핵심 근거로 삼지 않는다.
- 소액 실전 canary를 primary truth로 둔다.
- 다만 "공격적"은 "즉흥적"이 아니라 `빠르게 관측하고 빠르게 진입하되, 규칙으로 제한된 공격성`을 의미한다.

이 문서는 그 전제를 따른다.

## 1. 무엇을 자동화할 것인가

자동화 대상은 아래 전체다.

1. 새 incentive / airdrop / boosted lending surface 탐지
2. 종료 임박 surface 감지
3. 기존 전략 family로의 자동 분류
4. overfit / liquidity mirage / reward-token exit risk 자동 태깅
5. tiny live canary 후보 생성
6. campaign 종료 시 stay / rotate / unwind 판단
7. 실전 receipt 기반으로 다음 회차 사이징 검토

즉, 단순 스크래퍼가 아니라 `기회 감지 -> 실전 검증 -> 회전` 전체를 설계한다.

## 2. 왜 지금 필요한가

Merkl 공식 문서 기준으로 opportunities, campaigns, metrics는 API 기반 integration이 가능하고, campaign에는 `startTimestamp`, `endTimestamp`가 있으며, opportunity / campaign / rewards / metrics를 조합할 수 있다.

핵심 의미:

- 새 기회를 자동 포착할 수 있다.
- 종료 시간을 기준으로 회전 준비를 자동화할 수 있다.
- 기회별 campaign 세부 규칙과 reward token 타입을 분리해서 볼 수 있다.

공식 근거:

- opportunities / campaigns 동시 조회: `withOpportunity=true`
- campaign configuration: `startTimestamp`, `endTimestamp`
- programmatic access / metrics

참고:

- <https://docs.merkl.xyz/integrate-merkl/app>
- <https://docs.merkl.xyz/merkl-mechanisms/campaignConfiguration>
- <https://docs.merkl.xyz/distribute-with-merkl/campaign-management>

## 3. Dry-run에 대한 입장

운영자 판단처럼, dry-run은 실전과 다르다.

따라서 이 시스템은 dry-run을 아래처럼 격하한다.

- dry-run 역할: calldata / binding / unwind path / schema sanity / obvious revert 탐지
- live tiny canary 역할: 실제 경제성, 실제 claimability, 실제 liquidity exit, 실제 incentive accrual 검증

즉, promotion evidence의 중심은 dry-run이 아니라 `tiny live canary receipts`다.

### 정책 선언

- dry-run만으로 scale-up 금지
- tiny live canary 이전 full promotion 금지
- canary size는 caps 내 dust-but-real 수준
- canary 후 `entry receipt + reward accrual evidence + unwind receipt`가 있어야만 확장 검토

## 4. 공격적으로 가되, 과적합은 어떻게 막을 것인가

여기서 막아야 하는 과적합은 일반 백테스트 과적합만이 아니다.

### 4.1 historical parameter overfit

- 한 기간, 한 시장, 한 pair, 한 프로토콜에서 좋았던 수치만 보고 일반화하는 것

대응:

- 기존 `Walk-Forward / purged CV / embargo` 규칙 유지
- Merkl 신규 surface에는 backtest가 아니라 live canary 반복 관측을 더 중시

### 4.2 campaign-chasing overfit

- 종료 직전 고APR 하나에 반응해서 진입하는 것

대응:

- 신규 진입 최소 남은 시간 설정
- 남은 시간이 짧으면 watch만 하고 scale 금지

### 4.3 liquidity mirage

- TVL이 너무 작아서 APR이 왜곡된 기회

대응:

- family별 최소 TVL floor
- `low_tvl_high_apr` 자동 태깅

### 4.4 reward-token exit mirage

- reward는 높아 보이는데 reward token을 실제로 좋은 가격에 털 수 없는 경우

대응:

- reward token type이 `POINT`면 기본 auto-entry 차단
- reward token liquidity / claim chain / claim latency 별도 점검

### 4.5 unsupported execution mirage

- 기회는 좋아 보여도 현재 repo가 range management / managed vault를 제어하지 못하는 경우

대응:

- execution surface 미지원이면 watch까지만
- auto-entry는 deterministic surface만 허용

## 5. 우선순위 원칙

### 5.1 먼저 자동화할 family

- BTC 담보 + stable borrow
- wrapped BTC direct lending
- same-chain deterministic lending carry

이유:

- health factor를 명확히 정의할 수 있다
- unwind 경로가 명확하다
- reward가 끝나도 base strategy가 남는다
- live canary truth를 수집하기 쉽다

### 5.2 나중에 자동화할 family

- concentrated LP
- managed vault
- points / pre-TGE 의존 전략
- TVL 작은 micro campaign chase

이유:

- range 관리 또는 블랙박스 전략 노출이 크다
- reward 종료 후 base yield 설명력이 약하다

## 6. 체인 / 프로토콜 범위

특정 체인만 하드코딩하지 않는다. 기본 구조는 유연하게 유지한다.

### core entry chains

- Ethereum
- Base
- BOB
- BNB
- Avalanche
- Berachain
- Optimism
- Sei
- Soneium
- Sonic
- Unichain

### extended watch chains

- World Chain
- Mantle
- Monad
- Plasma
- Polygon
- Arbitrum
- Linea
- Ink
- Etherlink

원칙:

- watch 범위는 넓게
- auto-entry 범위는 core 위주
- extended chain은 later promotion 또는 manual admission만

## 7. 아키텍처

### 7.1 Discovery watcher

파일:

- `src/watch/merkl-opportunity-watch.mjs`
- `src/cli/watch-merkl-opportunities.mjs`

역할:

- opportunities / campaigns 조회
- snapshot 저장
- diff 생성
- 신규 / live 전환 / 종료 / 종료임박 감지

출력:

- `data/merkl-opportunity-snapshots.jsonl`
- `data/merkl-opportunity-alerts.jsonl`

### 7.2 Normalizer

파일:

- `src/strategy/merkl-opportunity-normalizer.mjs`

역할:

- Merkl raw payload를 내부 common shape로 변환
- chain / protocol / family / strategy mapping / execution surface / operator hold 반영

### 7.3 Prefilter

파일:

- `src/strategy/merkl-opportunity-prefilter.mjs`
- `src/config/merkl-opportunity-policy.mjs`

역할:

- hard blockers
- watch reasons
- overfit flags
- score
- validation mode

### 7.4 Reporting / planning

파일:

- `src/strategy/merkl-opportunity-plan.mjs`
- `src/cli/report-merkl-opportunities.mjs`

역할:

- 상위 후보 정렬
- rotation candidate 계산
- "dry-run은 preflight only, live tiny canary가 truth"를 출력 구조에 명시

## 8. 구현 단계

### Phase A. Discovery surface 구축

완료 기준:

- API fetch 성공
- raw snapshot / diff 생성
- top candidate 요약 가능

### Phase B. Aggressive-but-bounded scoring

완료 기준:

- family별 TVL floor
- campaign 남은 시간 기준
- point reward 차단
- operator hold 반영
- score와 overfit flags 계산

### Phase C. Tiny live canary-first promotion

여기서부터 추가 구현 필요:

- Merkl 후보 -> 기존 strategy family 연결
- live canary intent builder
- canary receipt ingest
- claim / accrual / unwind evidence 저장

### Phase D. Rotation manager

추가 구현 필요:

- 종료 48h 전 rotation candidate 생성
- stay vs rotate vs unwind 계산
- current position과 target opportunity를 같은 family 안에서 비교

### Phase E. Allocation integration

추가 구현 필요:

- allocator-core와 연결
- chain / protocol / reward-token exposure cap 추가
- reward 종료 후 자동 demotion

## 9. live truth model

실전 검증은 아래 순서로 한다.

1. watcher가 신규 기회를 감지
2. normalizer / prefilter가 후보를 score
3. candidate면 tiny live canary 후보 생성
4. 실제 entry receipt 수집
5. reward accrual 또는 claimability 확인
6. 실제 unwind receipt 확인
7. 그 다음에만 scale-up 검토

즉, `entry-only proof`는 충분하지 않다.

최소 요건:

- entry tx hash
- reward accrual evidence or claimability evidence
- unwind tx hash
- realized cost

## 10. overfit acceptance criteria

새 family를 자동 승격하려면 최소한 아래를 만족해야 한다.

1. 서로 다른 2개 이상 campaign window에서 live canary evidence가 있다
2. 종료 직전 진입만으로 성과가 나온 것이 아니다
3. reward token liquidation 가정 없이도 base strategy 설명이 가능하다
4. reward 종료 후 stay vs unwind 결과가 기록된다
5. one-off micro TVL 기회가 아니다

## 11. coding work packages

다른 코딩 도구가 병렬로 나눠 작업할 수 있도록 작업 단위를 자른다.

### WP1. Discovery / API layer

- opportunities fetch
- campaigns fetch
- snapshot hash
- diff generation

### WP2. Internal schema

- family classifier
- strategy mapping
- chain normalization
- reward token typing

### WP3. Aggressive scoring policy

- score weights
- hard blockers
- watch reasons
- overfit flags

### WP4. Reporting surfaces

- report CLI
- JSON artifact
- dashboard/status 연결 준비

### WP5. Tiny live canary planner

- candidate -> canary intent
- canary cap selection
- route / funding prechecks

### WP6. Receipt ingestion

- entry receipt
- accrual evidence
- unwind receipt
- realized pnl / cost

### WP7. Rotation manager

- expiring candidate detection
- replacement search
- stay / rotate / unwind scoring

### WP8. Exposure controls

- protocol cap
- chain cap
- reward token cap
- failed gas / failed claim budget

### WP9. status/dashboard integration

- candidate counts
- expiring opportunities
- rotation queue
- live canary queue

## 12. 이번 턴 기준 실제 구현된 것

이미 scaffolded:

- Merkl API watcher
- Merkl normalizer
- Merkl prefilter
- Merkl report planner
- report/watch CLI
- aggressive-but-bounded policy config

아직 미구현:

- tiny live canary intent builder
- claim / unwind receipt ingestion
- allocator-core 연결
- dashboard slice

## 13. next coding steps

우선순위는 이렇게 권장한다.

1. `report:merkl-opportunities -- --write`를 status pipeline에 연결
2. `recursive_stablecoin_lending_loop`와 Merkl candidate 연결
3. tiny live canary intent builder 추가
4. claim / unwind evidence schema 추가
5. rotation manager를 allocator-core에 연결

## 14. 검증 원칙

코드가 다 만들어진 다음 최종 검증은 아래 순서다.

1. syntax / CLI smoke
2. watcher output sanity
3. candidate ranking sanity
4. operator hold respected 여부
5. point reward auto-block 여부
6. short-campaign 차단 여부
7. tiny live canary candidate만 promotion되는지 확인

## 15. 결론

이 시스템은 충분히 공격적으로 설계할 수 있다.

다만 핵심은 아래다.

- 높은 APR을 맹목 추종하지 않는다
- dry-run을 진실로 착각하지 않는다
- tiny live canary를 주 검증수단으로 쓴다
- reward 종료까지 포함한 전체 life-cycle을 자동화한다

이 방향이면 `기회를 놓치지 않으면서도`, `과적합과 착시를 줄이고`, `실전 데이터로 빠르게 학습하는` 에이전트를 만들 수 있다.
