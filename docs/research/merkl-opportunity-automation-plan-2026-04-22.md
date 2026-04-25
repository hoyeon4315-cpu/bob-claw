# Merkl 기회 자동화 플랜 (2026-04-22)

목적: 기간이 짧은 incentive / airdrop opportunity를 사람이 계속 수동 추적하지 않아도, BOB Claw가 자동으로 감시하고, 조건이 맞을 때만 전략 후보로 승격하고, 종료가 다가오면 자동 복귀 후보를 계산하는 구조를 설계한다.

중요: 이 문서는 `AI가 직접 매매 결정을 내린다`는 뜻이 아니다.

- AI: 후보 수집, 요약, 태깅, 위험 설명, 코드 작성
- deterministic policy: 실행 가능 여부 판단
- signer daemon: policy 승인된 intent만 서명

즉, Merkl 자동화는 가능하지만 `LLM trading bot`으로 만들면 안 된다.

## 왜 가능한가

Merkl 공식 문서 기준으로 programmatic access가 가능하다.

- advanced analytics / programmatic access는 Merkl API 사용 권장
- campaign configuration에는 `endTimestamp`가 있다
- airdrop / campaign는 end date와 claim timing이 분리될 수 있다

이건 "새 기회 탐지"와 "종료 임박 감시"를 자동화할 수 있다는 뜻이다.

## 왜 바로 자동매매로 가면 위험한가

Merkl가 보여주는 APR은 종종 아래가 섞여 있다.

- 기본 금리
- incentive token 배포
- 포인트 / pre-TGE 기대
- LP in-range 전제

즉, 표면 APR만 보고 바로 진입하면 안 된다.

특히 아래 경우는 강한 필터가 필요하다.

- low TVL 인센티브 왜곡
- reward token 유동성 부족
- managed vault 블랙박스 구조
- 종료 직전 campaign chasing
- claim은 가능하지만 신규 배포는 끝난 campaign

## 권장 구조

### 1. Discovery watcher

새 컴포넌트: `src/watch/merkl-opportunity-watch.mjs`

역할:

- Merkl API 또는 공식 앱 surface를 주기적으로 조회
- chain / protocol / token / action / APR / TVL / campaign end time을 저장
- 이전 snapshot과 diff 비교
- 새 기회, 종료 임박, 종료, APR 급변만 이벤트로 발행

출력 예시:

- `data/merkl-opportunities-latest.json`
- `data/merkl-opportunity-events.jsonl`

### 2. Normalizer

새 컴포넌트: `src/strategy/merkl-opportunity-normalizer.mjs`

역할:

- Merkl 기회를 내부 공통 schema로 변환
- `arrivalFamily`, `strategyFamily`, `requiresLpManager`, `incentiveType`, `campaignEndsAt`, `baseYieldKnown`, `btcDenominatedPotential` 같은 필드 생성

핵심은 "Merkl 원문"을 그대로 믿지 않고 내부 전략 후보 shape로 바꾸는 것이다.

### 3. Deterministic prefilter

새 컴포넌트: `src/strategy/merkl-opportunity-prefilter.mjs`

규칙 예시:

- BTC 또는 BTC 담보가 직접 들어가는가
- 운영 범위 체인인가
- 현재 executor가 다룰 수 있는 family인가
- reward 제외 수익 구조 설명이 가능한가
- campaign 종료까지 최소 N일 남았는가
- TVL floor 이상인가
- per-tx cap 기준에서 dust 아닌가

이 단계에서 대부분 탈락시킨다.

### 4. Strategy mapping

새 컴포넌트: `src/strategy/merkl-opportunity-mapper.mjs`

역할:

- 남은 후보를 기존 전략 lane에 매핑
- 예:
  - Morpho WBTC 담보 stable 차입 -> `recursive_stablecoin_lending_loop`
  - cbBTC/USDC LP -> LP family candidate
  - Euler WBTC lend -> wrapped BTC lending candidate

중요:

- "새 기회"가 곧 "새 전략"은 아니다.
- 대부분은 기존 strategy family의 새 venue / 새 market / 새 campaign으로 들어가야 한다.

### 5. Dry-run generator

새 컴포넌트: `src/session/merkl-shadow-candidate-queue.mjs`

역할:

- prefilter 통과 후보만 shadow queue에 추가
- quote refresh, market snapshot, unwind simulation, route cost estimation 명령 생성
- 기존 `shadow-refresh-queue`와 유사한 형태로 동작

### 6. Promotion gate

기존 `policy / prelive / canary` 흐름 재사용

승격 규칙:

- fresh quotes
- measured route cost
- unwind path present
- protocol trust tier pass
- reward token liquidity pass
- campaign remaining duration >= minimum threshold
- shadow / dry-run / receipt evidence pass

여기까지 통과해도 첫 진입은 소액 canary다.

### 7. Exit / rotation manager

새 컴포넌트: `src/strategy/merkl-campaign-rotation.mjs`

역할:

- campaign 종료 임박 감지
- 종료 후 base yield만 남았을 때 유지할지 결정
- incentive 종료 시 기존 primary venue로 복귀 후보 계산
- gas / slippage / tax-lot / unwind cost를 반영한 `stay vs rotate` 비교

이게 있어야 "끝나면 다시 돌아오는" 자동화가 된다.

## AI가 맡아도 되는 부분과 맡으면 안 되는 부분

### AI가 맡아도 되는 것

- Merkl opportunity 요약
- 새로운 후보를 기존 family에 태깅
- 위험 설명과 문서화
- 코드 변경 제안

### AI가 맡으면 안 되는 것

- 즉석에서 "이건 좋아 보이니 바로 실행" 결정
- payback ratio, sizing, runtime cap 변경
- signer 우회
- reward token dump 가능성을 근거 없이 낙관 반영

## 지금 repo와 잘 맞는 이유

현재 repo에는 이미 아래 구조가 있다.

- watcher
- refresh queue
- strategy catalog
- deterministic candidate slice
- prelive / canary / review package
- policy engine
- signer daemon

즉, Merkl 자동화는 새 거래 엔진을 처음부터 만드는 문제가 아니라, 기존 시스템에 `discovery input`을 하나 더 붙이는 문제에 가깝다.

## 현실적인 3단계 구현 순서

### A. 관측 자동화

첫 단계는 절대 자동진입이 아니다.

- Merkl watcher 추가
- 종료 임박 / 신규 캠페인 이벤트 저장
- dashboard/status에 "new opportunity"만 표시

### B. 연구 자동화

- prefilter + strategy family mapping
- shadow candidate queue 생성
- dry-run / unwind / route-cost 리포트 자동 생성

여기까지 가면 "기회를 놓치지 않는 시스템"이 된다.

### C. 제한적 자동회전

아래를 모두 통과한 family에만 허용:

- binding 존재
- unwind deterministic
- reward token liquidity 측정 가능
- same-chain 또는 proven transport path
- observed receipts 존재

이때도 기본은 `tiny canary -> receipt 확인 -> cap 내 확장`이다.

## 첫 구현 대상으로 적합한 범위

가장 먼저 자동화하기 좋은 것은 다음이다.

- Morpho / Euler / Aave의 BTC 담보 + stable borrow/lend 계열

이유:

- LP manager보다 deterministic하다
- health factor와 unwind 정의가 가능하다
- reward가 끝나도 base strategy가 남는다

반대로 뒤로 미뤄야 하는 것은 다음이다.

- concentrated LP
- managed vault
- points / pre-TGE heavily dependent campaigns
- low TVL micro-campaign chasing

## 첫 acceptance criteria

1. 새 Merkl 기회가 생기면 1시간 안에 로컬 이벤트 로그에 잡힌다
2. 종료 48시간 전이면 rotation candidate가 자동 생성된다
3. prefilter 통과 후보만 shadow queue로 들어간다
4. policy bypass 없이 canary 후보까지만 자동 승격된다
5. 종료 후에는 stay / rotate / unwind 이유가 문서와 로그에 남는다

## 결론

자동화는 충분히 가능하다.

하지만 가장 수익이 잘 나는 형태는 보통 `AI가 마음대로 갈아타는 구조`가 아니라 아래 구조다.

- Merkl가 새 기회를 알려준다
- 시스템이 규칙으로 90%를 버린다
- 남은 10%만 dry-run과 canary로 검증한다
- 종료가 다가오면 base yield 유지 vs 복귀를 비용 기준으로 다시 계산한다

즉, `기회 포착 자동화`는 매우 유효하다.
반면 `AI 재량 자동매매`는 우리 시스템 원칙상 금지되어야 한다.
