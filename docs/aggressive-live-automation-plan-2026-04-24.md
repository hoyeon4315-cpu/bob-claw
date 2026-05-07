# Aggressive Live Automation Plan - 2026-04-24

이 문서는 BOB Claw를 "보수적 관찰기"에서 "정책으로 통제되는 실전 자동 운용기"로 밀어 올리기 위한 코딩 핸드오프 문서다. 다음 Codex / Claude / Copilot 세션은 이 파일을 먼저 읽고, 아래 실행 단위대로 구현한다.

## 0. 결론

현재 시스템은 이미 실전 자동화의 골격을 갖고 있다. signer daemon, policy engine, live canary sweep, Gateway BTC on/off-ramp, payback scheduler, strategy execution surfaces가 존재한다. 최신 리포트 기준으로 `liveTrading=ALLOWED`지만, 전략 8개 모두 `currentLiveEligible=false`라 실제 전략 운용은 `shadow`, `analysis`, `dry_run`으로만 돈다.

따라서 다음 목표는 "안전 규칙을 제거"가 아니라 다음 세 가지다.

1. 전략별 `currentLiveEligible=0`을 만드는 구체 blocker를 코드로 해소한다.
2. live canary sweep을 단발 검증에서 반복 자동화 루프로 승격한다.
3. payback engine이 먹을 BTC-denominated realized PnL을 receipt-backed ledger로 계속 쌓는다.

## 1. 최신 확인값

확인 시각: 2026-04-24T05:08Z 근처.

사용한 명령:

```bash
npm run report:strategy-catalog -- --json
npm run report:live-baseline -- --json
npm run report:payback-status -- --json
npm run report:strategy-execution-surfaces -- --json
```

확인 결과:

- `report:live-baseline`: `status=ready`, `liveTrading=ALLOWED`, `shadowTrading=ALLOWED`, `currentStageId=tiny_live_canary_review`.
- `report:strategy-execution-surfaces`: `strategyCount=8`, `runnableCount=8`, `missingExecutorCount=0`, `liveEligibleCount=0`.
- 전략 실행 모드: `shadow=3`, `analysis=3`, `dry_run=2`.
- `report:payback-status`: pending carry `601 sats`, settled payback `0 sats`, blocker `planned_payback_below_minimum`.
- payback minimum: `50,000 sats`; 현재 planned target before costs `120 sats`; minimum까지 `49,880 sats` 부족.
- strategy catalog 현재 분류: `measured_below_policy=4`, `unobserved=2`, `analysis_only=2`.

중요 해석:

- 전역 live gate는 더 이상 핵심 blocker가 아니다.
- 현재 blocker는 전략별 edge/evidence/live-admission이다.
- payback code는 미비가 아니라 작동 중인 carry 상태다. blocker는 수익 누적량 부족이다.

## 2. 현재 시스템 맵

### 이미 있는 것

- Policy Engine: `src/executor/policy/index.mjs`
  - kill-switch, consecutive failures, cap check, HF check, stale quote, approval hygiene, tiny live canary, liquidity watch, concentration guard를 평가한다.
- Strategy Dispatcher: `src/executor/dispatcher/strategy-catalog-dispatcher.mjs`
  - adaptive capital, live gate, feed freshness, positive BTC net edge, caps, diversification을 합쳐 allow/deny intent를 만든다.
- Strategy Tick: `src/executor/tick/strategy-tick.mjs`
  - 전략 adapter report를 dispatcher candidate로 변환한다.
- Strategy Dispatch Runner: `src/session/strategy-dispatch-runner.mjs`
  - 현재는 리포트/분석/드라이런 script 중심의 안전한 실행기로 동작한다.
- Live Canary Sweep: `src/executor/live-canary-sweep.mjs`
  - 전체 wallet inventory에서 tiny DEX canary 후보를 만들고, per-route blocker를 전역 중단과 분리한다.
- Payback Scheduler: `src/executor/payback/scheduler.mjs`
  - BTC-denominated accumulator snapshot에서 payback 계획을 만들고, minimum 미만이면 carry한다.
- Payback Config: `src/config/payback.mjs`
  - `baseRatio=0.20`, `minPaybackSats=50_000`, `perPeriodMaxSats=500_000`.
- Strategy Caps: `src/config/strategy-caps.mjs`
  - live-capable infra strategies는 다수 `autoExecute=true`.
  - `wrapped-btc-loop-base-moonwell`은 config상 `autoExecute=true`지만 AGENTS operator hold 때문에 primary alpha로 쓰면 안 된다.

### 현재 약한 곳

- `strategy-dispatch-runner`의 allowlist가 아직 실전 executor 명령을 충분히 포함하지 않는다.
- `currentLiveEligible`가 strategy execution surface에서 false로 남아 있어 live mode 요청이 실제 live executor로 이어지지 않는다.
- Live canary sweep은 존재하지만 cron/watchdog형 반복 운용과 실패 후 per-chain retry policy가 부족하다.
- Payback은 scheduler/accumulator가 있지만 실전 PnL이 작아서 minimum에 못 닿는다.
- 전략별 realized BTC PnL ledger가 payback accumulator로 충분히 흘러들어가는지 end-to-end test가 더 필요하다.
- 일부 rule/cap은 너무 넓거나 너무 좁다. `1_000_000` 같은 neutralized cap은 실전 운영 문서에서 의미 있는 tier cap으로 재정리해야 한다.

## 3. 공격적 운영 원칙

공격적 운영은 "무조건 거래"가 아니다. 아래 상태면 계속 진행하고, 아래 상태면 멈춘다.

계속 진행:

- 한 route가 `no_route`, `below_minimum`, `quote_failed`, `router_missing`이어도 다른 후보는 계속 돈다.
- 한 chain이 `receipt_uncertain`이면 그 chain만 lock하고 다른 chain은 계속 돈다.
- route alpha가 없으면 route brute-force를 줄이고 yield / reserve / DEX canary / strategy evidence로 primary를 옮긴다.
- 작은 realized loss가 생겨도 per-strategy cap, failed gas budget, drawdown cap 안이면 다음 후보를 계속 평가한다.

즉시 중단:

- kill-switch file 존재.
- signer health 불량 또는 nonce/receipt 상태 불명확.
- policy가 capless / stale quote / unlimited approval / HF breach / concentration breach를 반환.
- realized 24h PnL이 `maxDailyLossUsd` 아래로 내려감.
- 동일 chain/output asset에 미해결 tx가 있어 balance-delta proof가 오염될 수 있음.
- private key 값이 로그, tool arg, dashboard, LLM context에 들어갈 위험.

## 4. 규칙 개선안

AGENTS.md의 핵심 안전 규칙은 유지한다. 다만 너무 보수적인 운영 표현은 아래처럼 바꿔야 한다.

### 바꿀 것

1. "manual canary review"라는 표현은 제거하거나 legacy로 격하한다.
   - 실제 규칙은 이미 "config `autoExecute=true` + policy pass면 실행"이다.
   - 문서와 report에서 `tiny_live_canary_review`가 사람이 누르는 단계처럼 보이면 다음 에이전트가 멈춘다.

2. "wrapped-BTC lending-loop operator hold"는 두 층으로 나눈다.
   - 유지: 기존 Moonwell loop를 primary alpha로 승격 금지.
   - 완화: unwind safety, isolated receipt, PnL ledger, tiny DEX inventory canary는 계속 허용.
   - 재오픈 조건: 새 diff로 strategy id, cap, HF floor, unwind route, expected BTC PnL source를 명시.

3. "route alpha exhausted" 이후 행동을 더 공격적으로 명시한다.
   - route brute-force 중단은 전체 중단이 아니다.
   - primary lane을 receipt-backed yield / reserve sleeve / live canary evidence로 자동 전환한다.

4. cap neutralization을 운영 tier로 재정리한다.
   - `1_000_000`은 "무제한처럼 보이는 테스트 중립값"이다.
   - 실전 cap tier를 config에 명명한다: `probe`, `tiny`, `pilot`, `operating`.
   - cap 증액은 여전히 committed diff로만 한다.

### 바꾸지 말 것

- LLM은 실행 판단 경로에 들어가지 않는다.
- key는 signer daemon 밖으로 나오지 않는다.
- capless strategy는 실행하지 않는다.
- no unlimited approval.
- settlement proof는 destination balance delta 또는 Bitcoin L1 delivery proof가 있어야 한다.
- payback amount/timing은 deterministic policy만 결정한다.

## 5. 구현 로드맵

### L1. Live canary autopilot

목표: `run-live-canary-sweep`을 사람이 한 번 치는 명령이 아니라 반복 자동화로 만든다.

수정 대상:

- `src/cli/run-live-canary-sweep.mjs`
- `src/executor/live-canary-sweep.mjs`
- `src/executor/watchdog/runner.mjs` 또는 새 `src/cli/run-live-canary-autopilot.mjs`
- tests under `test/`

구현:

- `--loop`와 `--interval-ms` 옵션 추가.
- per-chain cooldown과 per-output-asset lock을 persistent state로 저장한다.
- `receipt_uncertain` chain만 quarantine하고 sweep 전체는 계속한다.
- `data/live-canary-sweep-latest.json`과 `data/live-canary-sweep-state.json`을 쓴다.
- delivered / source_confirmed / blocked / quarantined를 분리한다.

검증:

```bash
node --test test/live-canary-sweep*.test.mjs
npm run executor:live-canary-sweep -- --json --write
```

### L2. Strategy live admission bridge

목표: `strategy-execution-surfaces`의 `currentLiveEligible=false`를 만드는 이유를 명시하고, live 가능한 전략은 실제 executor command로 이어지게 한다.

수정 대상:

- `src/strategy/strategy-execution-surfaces.mjs`
- `src/session/strategy-dispatch-runner.mjs`
- `src/cli/run-strategy-catalog-dispatcher.mjs`
- `src/config/strategy-caps.mjs`

구현:

- 각 strategy result에 `liveAdmissionBlockers[]`를 추가한다.
- `DEFAULT_ALLOWED_STRATEGY_DISPATCH_SCRIPTS`에 실전 executor 중 정책 통과형 명령만 추가한다.
- live mode일 때는 `currentLiveEligible=true`인 전략만 실행하되, false면 blocker를 machine-readable로 기록한다.
- route-specific input이 필요한 전략은 `candidateBuilder`가 executor args를 생성하도록 한다.
- `autoExecute=false` 전략은 report에 "config diff needed"를 표시한다.

검증:

```bash
npm run report:strategy-execution-surfaces -- --json
npm run run:strategy-catalog-dispatch -- --json --mode=live
node --test test/*strategy*dispatch*.test.mjs
```

### L3. Realized BTC PnL ledger

목표: payback minimum에 도달할 수 있도록 모든 canary / strategy receipt가 BTC-denominated realized PnL로 누적되게 한다.

수정 대상:

- `src/executor/ingestor/execution-receipt-ingest.mjs`
- `src/executor/payback/accumulator.mjs`
- `src/executor/payback/dashboard.mjs`
- `src/cli/report-payback-status.mjs`

구현:

- 모든 receipt record에 `paperPnlSats`, `estimatedPnlSats`, `realizedPnlSats` 중 가능한 값을 명확히 분리한다.
- DEX canary는 수익 전략이 아니면 `realizedPnlSats=0` 또는 negative cost로 기록하고, evidence cost로 분류한다.
- strategy harvest만 payback-eligible realized profit으로 집계한다.
- BTC first, USD projection second 원칙을 report에 강제한다.

검증:

```bash
npm run report:payback-status -- --json
node --test test/*payback*.test.mjs test/*receipt*.test.mjs
```

### L4. Aggressive capital manager

목표: 자산이 어느 chain에 있든 tiny/pilot cap 안에서 자동으로 실험 후보를 만들고, profitable/evidence-backed lane에 capital을 옮긴다.

수정 대상:

- `src/executor/capital/rebalancer.mjs`
- `src/executor/capital/gas-float-keeper.mjs`
- `src/executor/bootstrap/gas-bootstrap.mjs`
- `src/executor/dispatcher/candidate-builder.mjs`
- legacy adaptive-cap config overlay (removed; committed caps remain canonical)

구현:

- cap tier: `probe`, `tiny`, `pilot`, `operating`.
- gas bootstrap job이 필요한 chain은 blocker가 아니라 prerequisite job으로 queue된다.
- refill cost가 expected edge보다 큰 경우 해당 candidate만 reject한다.
- reserve chain은 Base를 기본으로 유지하되, Base round-trip efficiency 8회 조건을 만족하기 전까지 payback reserve expansion은 금지한다.

검증:

```bash
node --test test/*capital*.test.mjs test/*bootstrap*.test.mjs
npm run report:strategy-execution-surfaces -- --json
```

### L5. Payback live settlement loop

목표: payback이 minimum에 도달하면 자동으로 Base -> BOB -> Bitcoin L1 settlement proof까지 수행한다.

수정 대상:

- `src/executor/payback/scheduler.mjs`
- `src/cli/run-payback-scheduler.mjs`
- `src/executor/helpers/gateway-btc-offramp.mjs`
- `src/executor/helpers/settlement-proof.mjs`

구현:

- `PAYBACK_BTC_DEST_ADDR` 미설정이면 carry가 아니라 `missing_destination_config`로 명확히 표시한다.
- planned payback이 minimum 이상이면 composite preview를 항상 생성한다.
- execution 후 Gateway order id, source tx, Bitcoin txid, settled balance delta를 audit log에 묶는다.
- payback 실패는 strategy execution과 별도 failure budget으로 관리한다.

검증:

```bash
npm run executor:payback-scheduler:once -- --json
npm run report:payback-status -- --json
node --test test/*payback*.test.mjs
```

## 6. 우선순위

바로 할 순서:

1. L1 live canary autopilot.
2. L2 live admission blocker reporting.
3. L3 realized BTC PnL ledger.
4. L4 capital manager.
5. L5 payback settlement loop.

왜 이 순서인가:

- 지금 live gate는 열려 있지만 live-eligible strategy가 없다.
- 실제 수익 전략 전에도 tiny canary 자동화는 signer/policy/receipt/delta 경로를 계속 단련한다.
- payback은 code gap이 아니라 PnL accumulation gap이다.
- capital manager는 live admission과 realized ledger가 있어야 공격적으로 움직여도 평가할 수 있다.

## 7. 다음 에이전트 시작 체크리스트

1. 먼저 상태 확인:

```bash
git status --short --branch
npm run report:live-baseline -- --json
npm run report:strategy-execution-surfaces -- --json
npm run report:payback-status -- --json
```

2. dirty worktree에서 산출물과 코드 변경 분리:

- `dashboard/public/*.json`, `data/*.json`, `docs/current-status.md`는 보통 재생성 산출물이다.
- 실제 코드 변경과 운영 산출물을 같은 커밋에 섞지 않는다.
- 현재 확인된 dirty file 중 `test/executor-policy-index.test.mjs`는 실제 코드 변경 가능성이 있으므로 원인을 확인한다.
- 현재 `?? 1` 파일은 생성 산출물인지 수동 보관물인지 확인 후 처리한다.

3. L1부터 구현:

```bash
npm run executor:live-canary-sweep -- --json --write
node --test test/live-canary-sweep*.test.mjs
```

4. 의미 있는 실행 단위가 끝나면 테스트 후 커밋한다.

## 8. 완료 기준

이 계획은 아래가 되면 "실전 자동화 1단계 완료"로 본다.

- `run-live-canary-sweep --loop`가 per-route blocker를 기록하며 계속 돈다.
- nonce/receipt uncertain chain만 격리되고 전체 sweep은 멈추지 않는다.
- `strategy-execution-surfaces`가 live-ineligible 이유를 strategy별로 설명한다.
- 최소 1개 strategy가 `currentLiveEligible=true`가 되거나, false인 이유가 모두 code/config diff 단위로 추적 가능하다.
- payback accumulator가 realized BTC PnL과 evidence cost를 분리해서 보여준다.
- `npm test` 또는 관련 targeted test가 통과한다.

## 9. 현재 단계 판정

현재 단계: L1 준비

이번에 한 일:

- 최신 리포트로 전역 live gate와 전략별 실행 표면을 확인했다.
- 실전 자동화 blocker가 전역 gate가 아니라 strategy live admission, 반복 canary automation, realized BTC ledger라는 점을 정리했다.
- 다음 에이전트가 바로 구현할 수 있는 파일 단위 로드맵을 남겼다.

왜 아직 그 단계인지:

- `liveTrading=ALLOWED`지만 `liveEligibleCount=0`이다.
- payback은 `601 sats` carry로, minimum `50,000 sats`에 못 미친다.
- live canary sweep은 존재하지만 반복 자동 운용/격리/상태 저장 루프가 아직 강화되어야 한다.

다음 체크리스트:

- [ ] L1: `run-live-canary-sweep`에 loop/cooldown/quarantine state 추가.
- [ ] L2: `strategy-execution-surfaces`에 `liveAdmissionBlockers[]` 추가.
- [ ] L3: receipt ingestor와 payback accumulator의 realized BTC PnL 분리 검증.
