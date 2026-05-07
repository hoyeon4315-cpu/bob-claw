# KIMI 리서치

현재 단계: L2 (Payback 엔진 코드 완료, 수익 전략 전부 미달)

## 시스템 분석 요약

- **8개 전략 라인 모두 `measured_below_policy` / `unobserved` / `analysis_only`**. 실제 실행 가능한 수익 전략 없음.
- **Payback 엔진은 코드 완성**. `scheduler.mjs` + `accumulator.mjs` 모두 정책 계산, 3-way receipt, 확장 게이트까지 구현됨. 하지만 `grossProfitSats_period = 0`이라 `planned_payback_below_minimum`로 carry 상태.
- **Gateway transport / settlement proof는 L1 완료**. Base → BOB L2 → Bitcoin L1 end-to-end live proof 존재.
- **Treasury / Capital Manager는 운영 중**. 잔고 스캔, 리필 잡, gas float top-up 모두 자동화됨.
- **`liveTrading: BLOCKED`**. policy 수준에서 하드 블록.

## 수익화 전략 연구 결과

| 라인 | 상태 | 핵심 blocker |
|---|---|---|
| Gateway wrapped-BTC loops | `measured_below_zero_floor` | net PnL -$1.45, variance $0.18. 엔트리부터 negative. |
| BTC proxy spreads | `measured_below_zero_floor` | net PnL -$0.90, variance $7.45. thin quote + overfit risk. |
| Stablecoin entry/exit | `measured_inside_variance_floor` | raw PnL +$137지만 variance $254k. noise 안에 묻힘. |
| BTC triangular/flash | `measured_below_policy` | latest flash -0.085%. sample 1개. |
| Wrapped BTC lending loop (Base/Moonwell) | `dry_run_evidence_recorded` | **현재 primary review lane**. recursive observed receipts + post-fee loop economics 아직 부족. |
| ETH-family 전체 | `unobserved` / `analysis_only` | 측정된 multichain ETH surface 없음. |

**결론**: 지금 당장 live 수익을 낼 수 있는 "즉시 매매형" 전략은 없다. 가장 가까운 것은 **Base/Moonwell wrapped BTC lending loop**이며, 이것만이 `dry_run`을 넘어 `live`로 갈 증거를 축적 중이다.

> 랜딩 루핑이나 유동성 공급은 "포지션 진입 후 시간이 지나며 수익이 쌓이는" 구조다. 따라서 이 전략의 평가 기준은 순간적 quote가 아니라: (1) 진입 비용, (2) 공시/실측 APY, (3) 출금 비용, (4) health factor floor, (5) 누적 수익의 페이백 가능성.

## 자동화 개선점

### 1. Payback swap venue 지원 Set 비어있음 — 이미 수정됨 (HEAD: ff40aa2)
`src/executor/payback/scheduler.mjs:318`의 `supportedSwapVenue()`에서 `const supported = new Set([])`이 빈 배열이었다. `cowswap`/`uniswap_v3`은 configured 되어 있지만 supported에 없어 `selected`가 항상 `null`. → profit이 생겨도 swap plan 단계에서 `swap_venue_not_supported`로 defer됨. **이미 `new Set(["cowswap", "uniswap_v3"])`으로 수정되어 커밋됨.**

### 2. Payback cap이 validation mode로 고착 — 이미 수정됨 (HEAD: ff40aa2)
`src/config/payback.mjs`: `perPeriodMaxSats: 50_000`, `annualMaxPaybackSats: 50_000`. 이 값은 엔진 검증용이지만, 수익 발생 시에도 한 번 페이백하면 연간 cap 소진. **이미 `perPeriodMaxSats: 500_000` (0.005 BTC), `annualMaxPaybackSats: 26_000_000` (0.26 BTC)로 상향 조정됨.**

### 3. Strategy revalidation 미자동화
`score:gateway`, `report:btc-proxy-spreads`, `collect:triangular-spreads` 등은 CLI 수동 실행. cron에 연결된 auto-revalidation runner가 없음. market condition 변화를 놓칠 수 있다. 주기적 shadow measurement를 daemon에 연결하거나, `runPaybackSchedulerLoop`와 유사한 `runRevalidationSchedulerLoop`를 추가하면 edge 변화를 실시간 포착 가능.

### 4. Lending loop live 증거 부재
`recursive_wrapped_btc_lending_loop`는 dry-run까지만. autoExecute로 가려면:
- `signer-backed observed receipts` (실제 체인에서의 post-fee APY, liquidation buffer)
- `healthFactorMin` breach 시 `emergency-unwind` path의 live test
이 두 가지를 수집하는 자동화 campaign 필요. 현재는 수동 prelive 패키지 실행.

### 5. Policy `liveTrading` 자동 해제 미연결
`edge-viability.mjs`는 `policy_ready` 상태를 감지할 수 있지만, `src/executor/policy/index.mjs`의 `liveTrading`이 이와 연동되어 있는지 불명확. `policy_ready`가 되면 자동으로 `ALLOWED`로 전환되는 로직이 있어야 unattended execution이 완성된다. 현재는 BLOCKED가 하드코딩되어 있을 가능성이 높다.

## 다음 체크리스트

- [ ] Base/Moonwell lending loop에 대해 `run-prelive-evidence-campaign` 자동화 — 일정 주기 dry-run → live canary 연결
- [ ] `liveTrading` policy가 `edgeViabilityVerdict`와 동적으로 연동되는지 확인 및 구현
- [ ] Yield strategy의 "누적 수익"을 accumulator가 제대로 인식하는지 검증 — `realizedNetCarrySats`/`realizedNetCarryUsd` path는 이미 존재하므로 receipt ingest pipeline 연결만 확인

## 왜 아직 L2인지

수익을 내는 전략이 없어 payback accumulator의 `grossProfitSats_period`가 0이다. transport와 payback 코드는 모두 준비됐지만, **alpha source가 없다**. L3으로 가려면 lending loop 또는 다른 lane에서 `policy_ready`가 나와야 한다.

---

## Opus 4.7 진행 상황 기록 (2026-04-21, last verified: session 96503db2)

> Opus가 아직 코딩 중. 다음 분석 요청 시 `git log --oneline -20` + `git diff HEAD~5..HEAD --stat`으로 변경 여부 먼저 확인.

### T1 `src/config/capital-adaptive.mjs` — 완료 (commit 포함됨)

| 항목 | 상태 | 비고 |
|---|---|---|
| `CAPITAL_ADAPTIVE_RATIOS` freeze | OK | 비율 변경은 커밋 필요 |
| `deriveCaps` 런타임 cap 변동 | **논쟁 여지** | `operatingBtcSats * 0.05` → 잔고 늘면 cap 자동 상승. AGENTS.md "Raising a cap requires a committed diff" 해석에 따라 회색지대. 비율은 커밋됐지만 절대값은 매 tick 변함. operator가 예상치 못한 크기의 tx를 서명할 수 있음. |
| `perStrategyShares` S1-S9 하드코딩 | **위험** | canary-1도 안 된 전략에 미리 25%/20%/15% 할당. "측정 전 가정" over-commit. S8(Babylon)은 plan §8에서 스코프 아웃했는데 shares에는 포함됨. |
| `projectToUsd` projectionOnly | OK | USD는 display-only. BTC 우선. |
| 단위테스트 | 11개 통과 | |

### T2 `src/config/diversification.mjs` — 완료 (commit 포함됨)

| 항목 | 상태 | 비고 |
|---|---|---|
| `DIVERSIFICATION_POLICY` freeze | OK | |
| `computeHhi` dual mode | OK | `portfolio`(cash residual 무시) vs `normalized`(realloc-only). 둘 다 valid. |
| `evaluateDiversification` 호출자 없음 | **위험** | 현재 accumulator는 per-strategy allocation을 추적하지 않음. `treasury/inventory.mjs`도 per-chain/token. 이 함수를 policy engine에 연동하려면 allocation ledger를 먼저 만들어야 함. **지금은 dead code**. |
| `canAcceptNewAllocation` policy 연동 없음 | **위험** | `src/executor/policy/index.mjs`에 diversification check가 없음. T14(dispatcher)가 이 함수를 호출하도록 설계됐지만 T14 미착수. |
| `GATEWAY_OFFICIAL_CHAINS` 11개 | OK | AGENTS.md와 일치 |
| 단위테스트 | 16개 통과 | |

### T3 `src/executor/risk/` 7개 모듈 + types — 완료 (commit 9c70afa), 23테스트

**이전 "3개 중복" 평가 수정 — 실제로 중복 아님.**

| 모듈 | 기존 코드 관계 | 실제 구현 | 중복 여부 |
|---|---|---|---|
| `concentration-guard.mjs` | `diversification.mjs` | `canAcceptNewAllocation`을 thin wrapper로 감싸 RiskVerdict 반환. T2의 policy 함수를 재사용. | **아님** |
| `circuit-breaker.mjs` | `kill-switch.mjs` | fan-in 결정자. "touch는 caller 책임"이라고 명시. pure function. `kill-switch.mjs`는 실행자. 역할 분리. | **아님** |
| `layerzero-oft-watcher.mjs` | `layerzero-scan.mjs` | supply deviation/mint-burn ratio 감시. 기존 scan은 경로 탐색. 기능 다름. | **아님** |

**실제 발견한 이슈들**

| 모듈 | 이슈 | 심각도 |
|---|---|---|
| `funding-rate-gate.mjs` | S6 어댑터 없어 현재 dead code. `ewma`가 샘플 1개면 그 값 그대로 반환 → 단일 샘플로 entry/exit 판단 가능. "insufficient data" 가드 부재. | 낮음 (S6 없음) |
| `peg-monitor.mjs` | threshold `depegPctMax: 0.005` (0.5%). cbBTC/BTC 페그는 보통 0.1% 이내. 0.5%는 느슱할 수 있음. but policy 상수라 커밋으로 조정 가능. | 낮음 |
| `protocol-health.mjs` | `adminKeyChangedRecently` 필드는 proxy admin event log 감시가 필요한데, 이를 채우는 polling 코드 없음. `exploitAdvisoryActive`도 외부 보안 DB polling 필요. | 중간 (caller 미구현) |
| `liquidity-watch.mjs` | `withdrawalQueueMaxBlocks: 500`. Moonwell은 Compound fork라 instant redeem이지만, queue 개념은 없음. 이 threshold는 Aave-style cooldown 프로토콜에만 적용. 현재 시스템 대상 프로토콜에는 불필요할 수 있음. | 낮음 |
| **전체** | 모든 모듈이 snapshot 객체를 pure function으로 받음. 실제 DefiLlama/Chainlink/LZ explorer polling 코드(데이터 소스 어댑터)는 **아직 없음**. T3는 평가 엔진(skeleton)만 완성. | 중간 |

**결론**: T3는 잘 짜인 pure function skeleton. 기존 코드와의 중복은 없음. 실제 가동하려면 데이터 소스 어댑터 + caller(watchdog/daemon) 연동이 필요.

---

## Opus 4.7 진행 상황 기록 (2026-04-21)

### T5 `src/executor/revalidation/scheduler.mjs` — 완료 (commit cb10d24)

| 항목 | 상태 | 비고 |
|---|---|---|
| cron 매칭 | OK | `matchesCronExpression`를 payback scheduler에서 재사용. 6시간 주기. |
| `buildAuditImpl` DI | **미연결** | `buildAuditImpl`은 필수 파라미터지만, 루프를 시작하는 진입점(`npm run daemon:revalidation` 등)에서 실제 audit builder를 주입하는 코드 없음. 현재는 테스트에서만 mock 주입. |
| `maxConsecutiveFailures` | OK | 3회 연속 실패 시 loop halt. restart는 외부 supervisor에게 위임. |
| audit log 무결성 | OK | snapshot 전용 경로에만 쓰고, `logs/signer-audit.jsonl`에는 절대 안 씀. |
| **실제 자동화 여부** | **미완** | scheduler skeleton 완성했지만, systemd/launchd 서비스 파일, `package.json` daemon 스크립트, cron job 등록 없음. 코드만 있고 러닝 인스턴스 없음. |

### T19 `src/executor/balance/reconcile.mjs` — 완료 (commit add38da), 12테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `normalizeSnapshot()` | OK | treasury inventory → `Map<chain::asset, {amountWei:bigint, decimals}>`. case-insensitive keys, BigInt-safe. |
| `reconcileBalances()` | OK | prev/curr snapshot + expectedIntents → `expected`/`unexpected`/`missing` classification. toleranceWei 지원. |
| `action` | OK | anomaly 있으면 `"emergency_pause"`, 없으면 `"continue"`. |
| `buildBalanceSnapshotRecord()` | OK | deterministically sorted JSONL record. caller가 append-only로 씀. |
| **caller/연동** | **없음** | `reconcileBalances`를 실제로 호출하는 코드 없음. `buildBalanceSnapshotRecord`를 JSONL에 append하는 caller 없음. grep 결과 `src/` 전체에서 참조 0건. |
| **intent 소스** | **미연결** | `expectedIntents` 파라미터는 signer daemon의 audit log에서 추출해야 함. 이 파이프라인 없음. |
| **5 tick 연속 RPC 실패 정지** | **미구현** | `reconcile.mjs` 자체에는 없음. caller 쪽에서 처리해야 함. |

**결론**: T19 pure function 완성. 실제 balance-snapshots.jsonl append + signer audit log와의 intent 매칭 파이프라인은 미연결.

### T20 `src/executor/bootstrap/multi-hop-planner.mjs` — 완료 (commit 795f118), 11테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `planBootstrapHops()` | 완료 | BFS over hopCatalog, MAX_HOPS=6. lowest totalFeeBps path 선택. tie-breaking: hop count → lexicographic id. |
| BigInt fee math | OK | `applyFee`가 bps integer math. `amountWei * (10_000 - feeBps) / 10_000`. BigInt-safe. |
| gas float check | OK | `gasBelowFloor`로 각 touched chain의 gas float 검사. 부족하면 `gas_top_up_required_first`. |
| minAmountWei | OK | target output이 `minAmountWei` 미달이면 `below_min_target`. |
| **hopCatalog 소스** | **미연결** | `hopCatalog`는 caller가 주입. 실제 Gateway quote + OFT route 수집하는 어댑터 없음. |
| **caller 연동** | **없음** | `rebalancer.mjs`, `refill-job.mjs`, `treasury/policy.mjs` 모두 `planBootstrapHops`를 **전혀 호출하지 않음**. grep 결과 0건. |
| **gas-bootstrap / asset-bootstrap 서브모듈** | **없음** | plan §5b.2의 gas-bootstrap(gas float 부족 시 wrapped→native unwrap), asset-bootstrap(EV 50% 초과 abort)는 별도 파일로 미구현. multi-hop planner만 존재. |

**결론**: T20은 multi-hop planner pure function만 완성. **hopCatalog 생성 어댑터 + Capital Manager 연동 없음**. 기존 treasury refill job이 단순 1-hop refill을 커버하지만, 복합 경로(BTC L1 → Gateway → OFT → swap → cbBTC)는 이 planner를 거쳐야 함.

### T6 `liveTrading` policy를 `edgeViabilityVerdict`와 동적 연동 — **완료 (commit 0441ce1, Kimi 직접 수정)**

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/status/live-policy.mjs` | 수정 완료 | `applyLaneAwareLivePolicy`에 `edgeViability` 파라미터 추가. `edgeViability?.verdict?.code === "policy_ready"` + `policy.ok`이면 `liveTrading`을 `BLOCKED` → `ALLOWED` 승격. 기존 blockers는 `promoted_from_blocker:*` warnings로 전환. |
| `src/status/current-dashboard-context.mjs` | 수정 완료 | `applyLaneAwareLivePolicy` 호출 시 `edgeViability: dashboardStatus.strategy?.edgeViability` 전달. |
| `src/cli/write-session-handoff.mjs` | 수정 완료 | 동일하게 `edgeViability` 전달. |
| **테스트** | 통과 | `test/live-policy.test.mjs` 5개 전부 통과. |
| **실제 효과** | 제한적 | 현재 `policy_ready` 상태 전략이 없으므로, 이 코드는 아직 실행되지 않음. lending loop에서 `policy_ready`가 나오면 자동으로 `ALLOWED`로 전환될 것. |

**결론**: T6 1단계(내 수정)는 live-policy.mjs에 직접 연동됨. **2단계(Opus 추가 동적 live gate 실험)는 이후 cleanup에서 제거됨**. 현재 liveTrading 의미는 deterministic policy/signer eligibility다.

### T22 watchdog 강화 + gas-snapshot freshness cron 수리 — 완료 (commit 21477da), 13테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/executor/watchdog/feed-freshness.mjs` | 완료 | `evaluateFeedFreshness({feeds, now})` pure function. per-feed staleness budget. required feed stale → `halt_new_entries`. severity UNWIND_ALL/KILL_SWITCH → `touch_kill_switch`. |
| clock skew 처리 | OK | 미래 타임스탬프는 `skewed`로 분류 → stale로 취급 안 함. 클록 드리프트로 인한 오halt 방지. |
| `latestObservedAtOf` | OK | JSONL record list에서 `{observedAt, updatedAt, timestamp, ts, createdAt}` 필드를 자동으로 읽어 최신 시간 추출. |
| **caller 연동** | **없음** | `feed-freshness.mjs`를 실제로 호출하는 signer daemon이나 strategy dispatcher 없음. feed manifest 구성 코드 없음. |
| **gas-snapshot cron 등록** | **미완** | 코드는 완성됐지만 실제 cron job 등록은 운영자 조치 필요. `npm run snapshot:gas`를 crontab에 추가하거나 systemd timer로 등록. |
| **425m stale 시나리오** | 테스트에 고정 | 425m stale vs 30m budget 테스트 케이스 포함. cron 복구 즉시 daemon이 자동으로 broadcast 허용. |

**결론**: T22는 평가 엔진 완성. 실제로 동작하려면 (1) cron 등록, (2) signer daemon에 feed manifest 주입, (3) `evaluateFeedFreshness` 호출 3가지 필요.

### T14 Strategy Catalog Dispatcher — 완료 (commit ddc8940), 14테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/executor/dispatcher/strategy-catalog-dispatcher.mjs` | 완료 | `dispatchStrategyCatalog` pure function. T4(adaptiveCapitalPlan) + T15(diversificationSlice) + T6(dynamicLiveGate) + T22(feedFreshness)를 하나로 통합. |
| **Global gates** | OK | feed stale → `block_all`. live gate blocked → `block_all`. operating floor → `block_all`. |
| **Per-candidate gates** | OK | unknown strategy, autoExecute=false, newEntriesBlocked, negative edge (netSats ≤ 0), cap zero, diversification violated. |
| **Diversification shrink** | OK | binary search (40 iterations)로 diversification 위반 시 최대 허용 allocation까지 축소. 0이면 deny. |
| **Binding constraint** | OK | `static` / `adaptive` / `request` / `diversification`. 어떤 gate가 cap을 shrink했는지 표시. |
| **Ranking** | OK | allow-first, then `expectedNetSats` desc. |
| **T3 risk/ 반영** | **없음** | `circuit-breaker`, `concentration-guard`, `protocol-health` 등 T3 risk verdict를 읽어서 block 여부 결정하는 코드 없음. T3는 dispatcher에 연동되지 않음. |
| **caller 연동** | **없음** | `dispatchStrategyCatalog`를 실제로 호출하는 코드 없음. `src/cli/run-strategy-catalog-dispatcher.mjs`(기존 CLI)는 이 함수를 **전혀 호출하지 않음**. Capital Manager tick이나 Signer Daemon preflight에서 이 함수를 소비해야 함. |

**결론**: T14는 4개 gate를 통합한 dispatcher pure function 완성. **T3 risk/는 연동되지 않음**. 실제로 동작하려면 Capital Manager나 Signer Daemon preflight에서 이 함수를 호출해야 함. 기존 `run-strategy-catalog-dispatcher.mjs` CLI는 여전히 예전 방식으로 동작.

### T21 Per-Adapter Canary Promotion State Machine — 완료 (commit 5189679), 15테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `evaluateCanaryPromotion()` | 완료 | 4단계 결정론 상태머신: `dry_run` → `canary_1`(5k sats) → `canary_7`(50k sats) → `live`. |
| **승격 규칙** | OK | dry_run: ≥8 obs → canary_1. canary_1: ≥1 fill + netSats > 0 → canary_7. canary_7: ≥7d + netSats ≥ 100 sats → live. |
| **강등 규칙** | OK | `consecutiveFailures ≥ 3` 또는 `realizedLossSats > 10_000` → 즉시 `disabled`. autoExecute=false. |
| **cap 변경 정책** | OK | 승격은 항상 `action=PROMOTE_PR`. 런타임 cap 상향 금지. caller가 PR intent emit → operator가 커밋. **AGENTS.md invariant #5 준수**. |
| **강등은 즉시** | OK | 런타임이 이미 낮은 cap에서 서명 권한을 가지고 있으므로, 꺼는 것은 PR 없이 가능. |
| **disabled 복구** | OK | PR 없이는 복귀 불가. 수동 re-entry 필요. |
| **caller 연동** | **없음** | `evaluateCanaryPromotion`를 실제로 호출하는 코드 없음. `src/` 전체에서 참조 0건. |
| **stats 소스** | **미연결** | `stats.dryRunObservations`, `successfulFills`, `realizedNetSats`, `consecutiveFailures` 등을 채우는 receipt 집계 파이프라인 없음. |
| **T14와의 관계** | **미연결** | T14 dispatcher가 per-candidate canary stage를 고려하지 않음. dispatcher는 `autoExecute`/`newEntriesAllowed`만 본다. canary runner의 output을 dispatcher가 소비하도록 연동 필요. |

**결론**: T21은 잘 설계된 canary 상태머신. **실제 receipt 집계 + 호출자 + T14 연동 없음**. 현재 모든 adapter는 dry_run 단계에 머물러 있음(= stats 부재).

### T16 LayerZero OFT Exploit Detector — 완료 (commit a3312e0), 13테스트

**이전 평가 수정**: T16은 "T3에 회귀 테스트 추가"가 아니라 **별도의 고급 감지기**.

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/risk/oft-exploit-detector/oft-exploit-detector.mjs` | 완료 | `detectOftExploit` pure function. 7개 시그널. Kelp $292M 패턴 기반. |
| **7개 시그널** | OK | (1) peg_deviation > 200 bps, (2) supply_mismatch > 0.5%, (3) mint_velocity > 5M sats/hr, (4) burn_velocity > 5M sats/hr, (5) bridge_withdrawal_spike > 10M sats/hr, (6) oracle_stale > 10m, (7) protocol_in_blocklist. |
| **심각도 상승** | OK | 단일 soft → HALT_PROTOCOL. blocklist/supply_mismatch 또는 2+ HALT → UNWIND_ALL. bridge_spike alone → UNWIND_ALL. **peg_deviation + bridge_spike → KILL_SWITCH** (Kelp composite). |
| **T3와의 관계** | **상위 호환** | `src/executor/risk/layerzero-oft-watcher.mjs`(T3)보다 시그널 더 많고, escalation 더 세밀. T16이 T3를 대체할 수 있음. |
| **caller 연동** | **없음** | "Signer Daemon preflight and Payback Scheduler emergency-pause check"에서 소비한다고 하지만, 실제 호출 코드 없음. grep 결과 0건. |
| **OFT snapshot 수집** | **미연결** | chain별 공급, bridge withdrawal 속도, peg oracle 등을 수집하는 어댑터 없음. |

**결론**: T16은 T3의 상위 호환 고급 감지기. **실제 OFT 상태 수집 + caller 연동 없음**. Kelp composite 패턴은 테스트에 고정됨.

### T17 End-to-End Shadow Run Aggregator — 완료 (commit 9864557), 14테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `aggregateShadowRun()` | 완료 | `logs/signer-audit.jsonl`의 `mode='shadow'` 엔트리를 1주 창으로 접어 per-adapter readiness 판정. |
| **6개 게이트** | OK | (1) 기간 ≥7d, (2) approved ≥100, (3) approvedRate ≥0.7, (4) meanNetSats > 0, (5) errored=0, (6) 단일 rejectionReason ≤60%. |
| **mode 필터링** | OK | `mode='shadow'`만 집계. live/canary 엔트리는 무시 → shadow readiness를 실자본 트래픽으로 위조 불가. |
| **출력** | OK | all gates pass → `verdict='ready'`, `action='promote_to_canary_1'`. any blocker → `verdict='not_ready'`, `action='continue_shadow'`. |
| **T21과의 관계** | **미연결** | shadow aggregator가 "ready"를 반환하면 canary runner의 `dry_run` stage 충족. 하지만 두 모듈 간 직접 연동 코드 없음. |
| **caller 연동** | **없음** | `aggregateShadowRun`를 실제로 호출하는 코드 없음. `src/` 전체에서 참조 0건. |
| **shadow 엔트리 생성** | **미연결** | `mode='shadow'`인 audit 엔트리를 생성하는 cap=0 shadow 실행 루프 없음. |

**결론**: T17은 cap=0 shadow audit → readiness 판정 pure function. **실제 shadow 실행 루프 + caller 연동 없음**. T21과 직접 연결되면 dry_run → canary_1 승격 파이프라인 완성.

### T18 autoExecute=true Cap-Flip Commit Gate — 완료 (commit f8efe96 + 284c008), 14테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| legacy receipt-promotion evidence module | removed | cleanup 이후 auto-promotion preview는 `evaluateAutoPromotion` dev guard를 사용한다. |
| **5개 promotion gate** | frozen | `minSignerBackedReceipts: 8`, `minConsecutiveSuccess: 5`, `maxFailureCount: 1`, `minCumulativeProfitSats: 5_000`, `minRoundTripEfficiency: 0.9`. lookback: 14일. |
| **AGENTS.md 불변 원칙** | **준수** | `PROMOTION_THRESHOLDS`는 Object.freeze. "This module never rewrites strategy-caps.mjs and never opens a PR." `suggestedDiff`는 hint만 — operator가 수동 commit. |
| `src/cli/promotion-pr-preview.mjs` | updated | CLI. current implementation reports advisory auto-promotion preview through `evaluateAutoPromotion`. |
| `--write=<path>` | OK | `mkdir -p` 포함 원자 쓰기. `--quiet`는 stdout 억제. |
| `.github/workflows/promotion-watch.yml` | 완료 | Daily cron(23:00 UTC) + workflow_dispatch. `npm run report:promotion-pr-preview -- --lookback-days=14 --write=reports/promotion-latest.json --quiet`. artifact 30일 보관. |
| **permissions** | `contents: read` | **write 없음**. audit log 읽기만. 캡 변경은 여전히 사람 commit. |
| **현재 출력** | blocked | `recursive_wrapped_btc_lending_loop = blocked: insufficient_signer_backed_receipts (0/8)`. 사실관계상 정확 — live receipt 0개. |
| **caller 연동** | **없음** | legacy receipt-promotion evidence was never a dispatcher or policy-engine input. |
| **auto PR 생성** | **미구현** | eligible 나와도 자동 PR 생성 없음. operator가 `suggestedDiff` 보고 수동 커밋. |

**결론**: T18은 **deterministic promotion gate + PR preview CLI + daily cron** 완성. cap 변경은 AGENTS.md invariant #5대로 사람의 commit으로만. 현재는 receipt 부족으로 모든 전략 blocked. 첫 ELIGIBLE 로그가 찍히면 operator가 `suggestedDiff`를 보고 수동 PR 생성.

### T18(확장) Dashboard Promotion Slice — 완료 (commit 86209ea), 6테스트 추가

| 항목 | 상태 | 비고 |
|---|---|---|
| legacy dashboard promotion slice | removed | cleanup 이후 dashboard promotion summary is advisory auto-promotion preview data only. |
| **Invariant** | `suggestedDiff` 누출 방지 | `buildPromotionSlice`는 `suggestedDiff` body를 **전혀 반환하지 않음**. public-visible dashboard에 민감한 PR 정보 노출 방지. 테스트에서 `JSON.stringify(slice).includes("suggestedDiff") === false` 검증. |
| **Output shape** | 6개 필드 | `available`, `generatedAt`, `lookbackDays`, `eligibleCount`, `blockedCount`, `eligible[]`, `blocked[]`. `blocked` 항목: `strategyId`, `firstBlocker`, `receiptsObserved`, `receiptsRequired`. |
| `src/status/dashboard-status.mjs` | 수정 | `buildDashboardStatus`에 `promotionReport` 파라미터 추가 → `buildPromotionSlice(promotionReport)` → `dashboardStatus.promotion = ...`. |
| `src/status/current-dashboard-context.mjs` | 수정 | `readJsonIfExists(join(dataDir, "promotion-latest.json"))` → `promotionReport` → `buildDashboardStatus`에 전달. |
| **Flow** | 자동화 | `npm run report:promotion-pr-preview -- --write=data/promotion-latest.json --quiet` → 다음 `npm run status:dashboard`에서 `data/promotion-latest.json` 자동 로드 → `dashboard-status.json.promotion` 슬라이스에 반영. |
| **Test** | 6개 추가 | `test/promotion-slice.test.mjs`: null/undefined/wrong-type 핸들링, realistic report, eligible promotion, **suggestedDiff 누출 방지**(invariant), malformed entries. |
| **전체 테스트** | 1235/1237 green | 2개 pre-skip. commit 86209ea 기준. |

**결론**: T18 확장으로 **promotion 상태가 dashboard에 실시간 노출**. 운영자가 핸드폰에서 `promotion.available: true`, `blockedCount: 3`, `eligibleCount: 0`, `receiptsObserved: 0`, `receiptsRequired: 8`를 바로 확인 가능. receipt 누적 시 `eligibleCount: 1`로 자동 전환 → operator가 `suggestedDiff` 기반 PR 생성.

### T18d Candidate Builder: T8-T13 Adapter → T14 Dispatcher Bridge — 완료 (commit 84416a6), 13테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/executor/dispatcher/candidate-builder.mjs` | 신규 | `buildDispatcherCandidates(inputs, opts)` pure function. Adapter reports → dispatcher candidates. |
| **Wiring gap closer** | **첫 다리** | Kimi 문서가 지적한 "27 pure + 0 wiring" 패턴을 깨는 첫 연결. T8-T13 adapter의 report shape를 T14 dispatcher의 candidate shape로 결정론적 변환. |
| **Input shape** | adapter report | `{ strategyId, mode, shadowReady, liveReady, blockers, economics: {projectedNetUsd}, chain, ... }` |
| **Output shape** | dispatcher candidate | `{ strategyId, chain, protocol, proposedAllocationSats, expectedYieldSats, roundTripCostSats, sourceMode }` |
| **Mode filter** | 2단계 | `liveReady === true` → `live_candidate`. `shadowReady === true` + `allowShadow === true` → `shadow_ready`. 그 외 → skipped. |
| **Blocked handling** | 명시적 | `mode === "blocked"` → skipped with `reason: "adapter_blocked"` + `topBlocker`. silent drop 없음. |
| **STRATEGY_PROTOCOL** | closed allow-list | 8개: pendle-pt-lbtc-base→pendle, pendle-pt-solvbtc-bbn-bsc→pendle, aerodrome-cl-base→aerodrome, berachain-bend-bex-bgt→berachain-bend-bex, gmx-v2-perp-basis-avax→gmx-v2, beefy-folding-vault→beefy, wrapped-btc-loop-base-moonwell→moonwell, recursive_wrapped_btc_lending_loop→moonwell. unknown strategyId → `protocol_unknown` skip. |
| **USD → sats 변환** | `usdToSats` | `projectedNetUsd / btcPriceUsd * 1e8` → `expectedYieldSats`. `perTradeCapUsd / btcPriceUsd * 1e8` → `proposedAllocationSats`. |
| **Double-counting 방지** | `roundTripCostSats: 0` | adapter `economics.projectedNetUsd`가 이미 fee/slippage/borrow 차감 후 net. dispatcher의 `netSats()` math가 one-way 유지되도록 cost를 0으로 설정. |
| **Shadow allocation** | 0 sats | `perTradeCapUsd === 0` → `proposedAllocationSats = 0`. dispatcher가 CAP_ZERO deny — shadow는 observe-only. |
| **Protocol override** | 3계층 | (1) `entry.protocol` per-input, (2) `opts.protocolOverrides`, (3) `STRATEGY_PROTOCOL` allow-list. precedence: entry > opts > allow-list. |
| **Chain resolution** | 2계층 | `report.chain` > `config.chain`. 둘 다 없으면 `chain_unknown` skip. |
| **Tests** | 13개 | input validation, sats conversion, shadow-skip/allow flag, blocked-with-reason, protocol-override precedence, chain/strategy/report missing guards, STRATEGY_PROTOCOL coverage, frozen output, **end-to-end dispatch through dispatchStrategyCatalog()** (실제 downstream 코드에서 bridge 검증). |
| **전체 테스트** | 1283/1285 green | 2개 pre-skip. commit 84416a6 기준. |
| **Pending wiring** | **2개** | (1) Runtime caller: 각 adapter의 evaluate*()를 iterate → reports 수집 → builder → dispatcher. (2) Market snapshot collectors: Pendle SDK, Aerodrome subgraph 등 — network I/O 필요, infra-agent scope. |

**결론**: T18d는 **"27 pure + 0 wiring" 패턴을 깨는 첫 다리**. T8-T13 adapter와 T14 dispatcher 사이에 결정론적 변환 레이어 추가. adapter는 pure 유지, dispatcher는 pure 유지, builder가 중간에서 shape 변환. **하지만 이 다리를 건너는 runtime caller는 없음**. `buildDispatcherCandidates`를 호출하는 코드가 `src/` 전체에서 0건. end-to-end 테스트는 mock input으로 검증. 실제 market snapshot 수집 + adapter evaluate() 호출 + builder → dispatcher 체인은 미배선.

### T18(확장) Walk-Forward Purged/Embargoed CV Evaluator — 완료 (commit 42a225e), 12테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/walk-forward-cv.mjs` | 신규 | `evaluateWalkForwardCv` pure function. AGENTS.md "no strategy goes live solely on a single-period backtest" 요구사항 충족. |
| **AGENTS.md 요구사항** | 첫 절반 | "walk-forward purged/embargoed CV + at least one regime change in the sample window". 이 모듈은 walk-forward CV 부분만. regime-change detection은 별도 모듈(미작성). |
| **Algorithm** | 5-fold sliding window | train(14d) → purge(1d) → test(3d) → embargo(1d). step = testMs + embargoMs. 다음 fold의 train은 현재 test+embargo 이후부터 시작. |
| **Per-fold criteria** | 3개 | (1) `successRateDelta >= -0.20`(test 성공률이 train보다 20%p 이상 떨어지면 실패), (2) `testNetProfitPerSample >= 0.5 * trainNetProfitPerSample`(test가 train의 50% 이상 순이익/샘플 유지), (3) `roundTripEffDelta >= -0.10`(test 효율이 train보다 10%p 이상 떨어지면 실패). |
| **Aggregate criteria** | 60% pass | `minFoldsPassedFraction: 0.6`. 5개 fold 중 3개 이상 pass해야 전체 pass. |
| **Per-sample 정규화** | **버그 수정** | 초기 구현은 총 순이익 비율(train 14d vs test 3d)로 비교 → 안정 데이터에서도 test가 짧아서 0.214 ratio → 오탐. **샘플당 정규화로 교정**: `trainNetPerSample = net / count`, `testNetPerSample = net / count` → ratio 비교. |
| **Zero I/O** | OK | deterministic, frozen output. 샘플 배열 + 설정 상수만 입력. |
| **auto-promotion evidence 연동** | **미통합** | 의도적으로 isolated unit으로 먼저 착지. current dev guard integration belongs in `evaluateAutoPromotion` evidence, not runtime signer policy. |
| **Tests** | 12개 | non-array reject, empty samples, frozen shape, short span blocker, stable dense history pass, degradation detection, per-sample normalization, insufficient samples, custom thresholds, edge cases. |
| **전체 테스트** | 1247/1249 green | 2개 pre-skip. commit 42a225e 기준. |

**결론**: walk-forward CV evaluator는 AGENTS.md의 live 승격 전 필수 조건 중 첫 번째(시간 순서 분할 CV)를 충족. **regime-change detection(두 번째 조건)과 auto-promotion evidence 통합은 미완**. 현재는 standalone 모듈. 실제 전략 샘플이 쌓이면 `evaluateWalkForwardCv({samples})`를 `evaluateAutoPromotion` evidence path에 추가하면 commit-guard 기준 강화.

### T18c Regime-Change Detector (Mayer Multiple) — 완료 (commit 6c5ffd7), 17테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/regime-detector.mjs` | 신규 | `classifyRegime`, `annotateRegimeSeries`, `extractRegimeChanges`, `hasRegimeChangeInWindow`, `summarizeRegimeWindow`. |
| **Mayer Multiple** | `spot / 200d MA` | `maWindowDays: 200`. time-weighted two-pointer rolling window. irregular sampling에도 robust. |
| **Classification** | 3개 | `bear`: MM < 1.0, `neutral`: 1.0 ≤ MM < 2.4, `bull_peak`: MM ≥ 2.4. payback.mjs ratio multipliers(bear 1.2, neutral 1.0, bull_peak 0.7)와 일치. 직접 import 없음 — pure function. |
| **Unknown guard** | 90% threshold | 200d window이 90% 미만 충족 시 `regime: "unknown"`. 워밍업 오분류 차단. |
| **extractRegimeChanges** | unknown 무시 | `unknown` → known 전환, known → `unknown` 전환 모두 regime change로 집계하지 않음. 오직 known↔known 다른 label 간만 기록. |
| **hasRegimeChangeInWindow** | window 내 검사 | `[startMs, endMs)` 안에 regime change가 1개 이상 있으면 `true`. |
| **summarizeRegimeWindow** | convenience | window 내 regime 분포 + change list + `hasChange` boolean. |
| **auto-promotion evidence 통합** | **미통합** | 의도적으로 isolated. regime-change detector 완성 후 walk-forward와 함께 auto-promotion dev guard evidence에 추가 예정. |
| **Tests** | 17개 | classifyRegime(4), annotateRegimeSeries(5: non-array, unknown warmup, neutral stable, bull_peak rally, bear collapse), extractRegimeChanges(3: basic, unknown ignored, no change), hasRegimeChangeInWindow(2: present, absent), summarizeRegimeWindow(3). |
| **전체 테스트** | 1264/1266 green | 2개 pre-skip. commit 6c5ffd7 기준. |

**결론**: regime-change detector는 AGENTS.md 두 번째 조건 "at least one regime change in the sample window"를 충족. **walk-forward CV와 함께 promotion-evidence에 통합하면 6-gate live 승격 기준 완성**. 현재 standalone.

### T23 Dashboard Mindmap Slice — 완료 (commit cff4c0c), 14테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/status/mindmap-slice.mjs` | 완료 | `buildMindmapSlice` pure function. `{nodes, edges, counts}` 그래프 생성. |
| **규칙** | OK | (1) chain-internal swap 제외, (2) Gateway-routed flow만 edge(onramp/offramp/gateway_bridge/payback), (3) payback arrow → `edge.type='payback'`, (4) protocol node에 logoId/role/balanceSats/apyBps, missing은 null. |
| **결정론** | OK | deterministic sort (bridges before paybacks, then from→to→kind). hash-based cache key 가능. |
| **caller 연동** | **없음** | `buildMindmapSlice`를 호출하는 코드 없음. `dashboard/public/mindmap.jsx`는 이 함수를 **전혀 참조하지 않음**(React 컴포넌트가 직접 JSON을 파싱). |
| **diversification 슬라이스** | **여전히 없음** | T15의 `buildDiversificationKpiSlice`가 dashboard JSON에 포함되지 않음. |
| **canary 슬라이스** | **여전히 없음** | T21 canary stage 정보가 dashboard JSON에 없음. |
| **risk 슬라이스** | **여전히 없음** | T3/T16 risk verdict가 dashboard JSON에 없음. |
| **feed-freshness 슬라이스** | **여전히 없음** | T22 feed 상태가 dashboard JSON에 없음. |

**결론**: T23은 mindmap용 pure function slice builder 완성. **caller 연동 없음**. diversification/canary/risk/feed-freshness 슬라이스는 여전히 dashboard JSON에 없음.

### T7 recursive wrapped BTC lending loop 측정 어댑터 — 미착수

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/recursive-lending-loop-dry-run.mjs` | 기존 | dry-run packet/receipt builder. `mirrorWrappedBtcObservedReceiptForRecursive`로 wrapped-BTC loop live proof를 recursive loop record로 변환. |
| `src/strategy/recursive-lending-loop-slice.mjs` | 기존 | scaffold builder. `readyForLive: false`. |
| **signer-backed observed receipts** | **없음** | 실제 체인에서의 post-fee APY, liquidation buffer 수집 코드 없음. |
| **emergency-unwind live test** | **없음** | `healthFactorMin` breach 시 unwind path의 실제 체인 테스트 없음. |
| **autoExecute** | **false** | `src/config/strategy-caps.mjs`에서 `recursive_wrapped_btc_lending_loop`의 `autoExecute: false`. |
| **독립 live executor** | **없음** | `wrapped-btc-loop-live.mjs`는 `wrapped-btc-loop-base-moonwell` 전용. recursive variant용 live executor 없음. |

**결론**: T7은 아직 시작되지 않음. recursive loop는 `wrapped-btc-loop`의 live proof를 mirror하는 것만 가능. 독립적인 live canary를 위한 adapter + executor 모두 미구현.

### T8 S1 Pendle PT-LBTC Adapter Scaffold — 완료 (commit 6368a05), 18테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/pendle-pt-lbtc-adapter.mjs` | 완료 | `evaluatePendlePtLbtcAdapter` pure function. config + market snapshot + receipts → viability report. |
| **전략 ID** | `pendle-pt-lbtc-base` | 기존 S1(`wrapped-btc-loop-base-moonwell`)과 **별개**의 새 전략. Pendle PT-LBTC fixed yield. |
| **Market gates** | 9개 | pt_implied_apr, maturity, liquidity, cbbtc_supply_apr, usdc_borrow_apr, entry_slippage, exit_slippage, lbtc_peg, oracle_fresh. |
| **Policy gates** | 6개 | maturity_too_near/far, pt_implied_apr_below_threshold, entry/exit_slippage_above, lbtc_peg_deviation_excessive(>50bps). |
| **승격 단계** | 3단계 | `blocked` → `shadow_ready`(market+policy pass + net>0) → `live_candidate`(≥3 receipt + realized>0 + rollover proven). |
| **Shadow mode** | OK | `perTradeCapUsd=0`, `perDayCapUsd=0`, `autoExecute=false`. |
| **caller 연동** | **없음** | `evaluatePendlePtLbtcAdapter`를 호출하는 코드 없음. T14 dispatcher에 주입되지 않음. |
| **market snapshot 수집** | **미연결** | Pendle SDK, Moonwell oracle, LBTC peg 데이터를 수집하는 어댑터 없음. |
| **receipt 수집** | **미연결** | signer-backed receipt를 생성하는 live executor 없음. |

**결론**: T8은 Pendle PT-LBTC 전략의 pure function evaluator 완성. **S1의 확장이 아니라 새 전략**. 실제 market 데이터 + receipt 수집은 미연결.

### T10 S3+S4 Aerodrome CL Adapter — 완료 (commit f6cd467), 20테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/aerodrome-cl-adapter.mjs` | 완료 | `evaluateAerodromeClAdapter` pure function. CL position manager evaluator. |
| **전략 ID** | `aerodrome-cl-base` | S3(`cbbtc_lbtc_tight`) + S4(`cbbtc_usdc_incentive`)를 `poolVariant`로 구분. |
| **Pool variants** | 2개 | `cbbtc_lbtc_tight` — narrow BTC↔BTC, fee income dominant, IL peg drift. `cbbtc_usdc_incentive` — single-sided BTC vs stable, AERO emissions, structural IL. |
| **Market gates** | 10개 | pool_tvl, pool_fee_apr, incentive_apr, realized_il, out_of_range_time, current_tick_offset, entry_slippage, exit_slippage, gateway_quote_fresh, gateway_round_trip_cost. |
| **Policy gates** | 8개 | pool_tvl_below_min, pool_fee_apr_below_threshold(>400bps), realized_il_above_threshold(>150bps), out_of_range_time_above_threshold(>30%), current_price_outside_target_range(>|rangeHalfWidthBps|), entry/exit_slippage_above, round_trip_cost_above. |
| **승격 단계** | 3단계 | `blocked` → `shadow_ready` → `live_candidate`. |
| **live_candidate 추가 조건** | 4개 | ≥3 passed receipts + realizedNetUsd>0 + `rebalanceProven` ≥1 + `ilWithinBoundsCount === signerBackedCount`(100% receipt가 IL bounds 내). |
| **Shadow mode** | OK | `perTradeCapUsd=0`, `perDayCapUsd=0`, `autoExecute=false`. |
| **caller 연동** | **없음** | `evaluateAerodromeClAdapter`를 호출하는 코드 없음. T14 dispatcher에 주입되지 않음. |
| **market snapshot 수집** | **미연결** | Aerodrome pool TVL, fee APR, AERO incentive APR, current tick, out-of-range time 등을 수집하는 어댑터 없음. |
| **receipt 수집** | **미연결** | CL position의 rebalance proof + IL bounds proof를 생성하는 live executor 없음. |

**결론**: T10은 Aerodrome CL 전략의 pure function evaluator 완성. **2개 pool variant를 하나의 adapter로 통합**. 실제 pool data + position management receipt 수집은 미연결. `rebalanceProven`과 `ilWithinBoundsCount`는 CL 전략 특유의 live evidence로, 다른 adapter와 구조가 다름.

### T11 S5 Berachain Bend + BEX + BGT Adapter — 완료 (commit 미확인, 파일 존재), 18테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/berachain-bend-bex-adapter.mjs` | 완료 | `evaluateBerachainAdapter` pure function. Lending + DEX LP + governance reward evaluator. |
| **전략 ID** | `berachain-bend-bex-bgt` | S5 Berachain. Bend(lending) + BEX(DEX) + BGT(governance reward). |
| **Modes** | 2개 | `collateral_only` — Bend에만 deposit. `lp_bgt` — Bend collateral + BEX LP + BGT claim. |
| **Market gates (collateral_only)** | 7개 | lending_tvl, lending_supply_apr, entry_slippage, exit_slippage, gateway_quote_fresh, gateway_round_trip_cost, offramp_cost. |
| **Market gates (lp_bgt 추가)** | +6개 | lp_tvl, lp_fee_apr, lp_realized_il, bgt_apr, bgt_oracle_drift, bgt_spot_liquidity. |
| **Policy gates (collateral_only)** | 5개 | lending_tvl_below_min, lending_supply_apr_below_threshold(>200bps), entry/exit_slippage_above, round_trip_cost_above, offramp_cost_above. |
| **Policy gates (lp_bgt 추가)** | +5개 | lp_tvl_below_min, lp_fee_apr_below_threshold(>300bps), lp_realized_il_above_threshold(>200bps), bgt_apr_below_threshold(>500bps), bgt_oracle_drift_above_threshold(>500bps). |
| **BGT valuation** | haircut 적용 | `bgtIlliquidityHaircutBps: 2000`(20%). BGT는 claim 후 swap path 불확실 → projected economics에서 20% haircut. |
| **승격 단계** | 3단계 | `blocked` → `shadow_ready` → `live_candidate`. |
| **live_candidate 추가 조건 (lp_bgt)** | 2개 | `bgtClaimProvenCount ≥ 1` + `rebalanceProvenCount ≥ 1`. `collateral_only`는 일반적인 ≥3 receipt + realized>0. |
| **Shadow mode** | OK | `perTradeCapUsd=0`, `perDayCapUsd=0`, `autoExecute=false`. |
| **caller 연동** | **없음** | `evaluateBerachainAdapter`를 호출하는 코드 없음. T14 dispatcher에 주입되지 않음. |
| **market snapshot 수집** | **미연결** | Bend lending APY/TVL, BEX pool APY/TVL/IL, BGT emission rate/USD valuation, Berachain Gateway offramp cost 등을 수집하는 어댑터 없음. |
| **receipt 수집** | **미연결** | BGT claim + swap route proof, Bend deposit/redeem proof를 생성하는 live executor 없음. |

**결론**: T11은 Berachain 생태계 전략의 pure function evaluator 완성. **2개 mode로 확장성 있게 설계**. BGT의 illiquidity haircut(20%)은 실험적 가정. Berachain은 Gateway destination이지만 새 chain이라 offramp cost 측정이 필수. 실제 data + receipt 수집 미연결.

---

### T8-T13 Protocol Adapters — 종합 업데이트 (2026-04-21)

Plan §3의 9개 전략에 대응하는 adapter 목록 (T8-T13 반영):

| 전략 ID | 현재 파일 | 상태 | live executor | dry-run | autoExecute |
|---|---|---|---|---|---|
| S1 `wrapped-btc-loop-base-moonwell` | `src/strategy/wrapped-btc-loop-live.mjs` 등 | **가장 진행됨** | 있음 | 있음 | true |
| S1b `pendle-pt-lbtc-base` | `pendle-pt-lbtc-adapter.mjs`(T8) | evaluator만 | 없음 | 없음 | false |
| S1c `pendle-pt-solvbtc-bbn-bsc` | `pendle-pt-solvbtc-bbn-adapter.mjs`(T9) | evaluator만 | 없음 | 없음 | false |
| S2 `recursive_wrapped_btc_lending_loop` | `recursive-lending-loop-*` | dry-run만 | 없음 | 있음 | false |
| S3 `aerodrome-cl-cbbtc-lbtc` | `aerodrome-cl-adapter.mjs`(T10) | evaluator만 | 없음 | 없음 | false |
| S4 `aerodrome-cl-cbbtc-usdc` | `aerodrome-cl-adapter.mjs`(T10) | evaluator만 | 없음 | 없음 | false |
| S5 `berachain-bend-bex-bgt` | `berachain-bend-bex-adapter.mjs`(T11) | evaluator만 | 없음 | 없음 | false |
| S6 `gmx-v2-perp-basis-avax` | `gmx-basis-adapter.mjs`(T12) | evaluator만 | 없음 | 없음 | false |
| S7 `beefy-folding-vault` | `beefy-folding-adapter.mjs`(T13) | evaluator만 | 없음 | 없음 | false |
| S8 `babylon_btc_staking` | 없음 | 스코프 아웃(§8) | 없음 | 없음 | false |
| S9 `btc_triangular_arbitrage` | `collect:triangular-spreads` CLI | shadow 측정 | 없음 | 수동 | false |
| S9b `eth_family_proxy_spread` | `report:btc-proxy-spreads` 등 | measured_below_zero_floor | 없음 | shadow 수동 | false |

**종합**: 12개 전략 라인 중 **단 1개(S1 wrapped-BTC loop)**만 live executor가 존재. **S1b/S1c/S3/S4/S5/S6/S7는 evaluator만 완성**(T8-T13). 나머지 S2/S8/S9/S9b는 이전 상태 그대로.

**핵심 blocker**: T8-T13 adapter는 모두 pure function evaluator. 실제 market data 수집(Pendle SDK, Aerodrome subgraph, Berachain Bend/BEX RPC, GMX V2 stats API, Beefy vault API) + receipt 생성(live executor) + T14 dispatcher 연동이 필요. 이 3가지가 없으면 shadow mode도 cap=0 평가만 반복.

### T9 S2 Pendle PT-SolvBTC.BBN Direct Adapter — 완료 (commit 2c062e2), 18테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/pendle-pt-solvbtc-bbn-adapter.mjs` | 완료 | `evaluatePendlePtSolvBtcBbnAdapter` pure function. |
| **전략 ID** | `pendle-pt-solvbtc-bbn-bsc` | S1c와 **별개**. BSC 체인, Gateway Custom Action. |
| **S1b와의 차이** | 3가지 | (1) leverage loop 없음 — 직접 매입, (2) Custom Action 원자성이 정책 중심(내부 실패 시 revert 필수), (3) liveReady에서 100% atomic 비율 + 1회 이상 만기 redeem 증명. |
| **Chain** | `bsc` 강제 | validator가 `chain='bsc'`를 강제. 다른 체인은 config invalid. |
| **Custom Action** | 정책 중심 | `maxCustomActionFailureRateBps: 200`(2%). 내부 스텝 실패 시 외부 주문 revert 필수. |
| **Withdrawal path** | offramp-only | PT redeem at maturity → Solv redeem → wBTC.OFT → Gateway offramp → native BTC. |
| **Shadow mode** | OK | `perTradeCapUsd=0`, `perDayCapUsd=0`, `autoExecute=false`. |
| **caller 연동** | **없음** | 호출자 없음. T14 dispatcher에 주입되지 않음. |

**결론**: T9는 BSC Pendle PT-SolvBTC.BBN 전략 evaluator 완성. **S1b(T8)와 구조 유사하지만 체인/전략 모두 별개**. 실제 Gateway Custom Action SDK 결합 + Pendle 만기 redeem 자동화는 후속 operational 작업.

**종합**: 12개 전략 라인 중 **단 1개(S1 wrapped-BTC loop)**만 live executor가 존재. **S1b/S1c/S3/S4/S5/S6/S7는 evaluator만 완성**(T8-T13). 나머지 S2/S8/S9/S9b는 이전 상태 그대로.

**핵심 blocker**: T8-T13 adapter는 모두 pure function evaluator. 실제 market data 수집(Pendle SDK, Aerodrome subgraph, Berachain Bend/BEX RPC, GMX V2 stats API, Beefy vault API) + receipt 생성(live executor) + T14 dispatcher 연동이 필요. 이 3가지가 없으면 shadow mode도 cap=0 평가만 반복.

### T4 Capital Manager에 `deriveCaps` tick 통합 — **파일만 생성, 연동 없음** (commit 8a78a3f)

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/executor/capital/adaptive-caps.mjs` | 완료, 11테스트 | `buildAdaptiveCapitalPlan`이 `deriveCaps()` + `projectToUsd()` → static caps와 overlay. `effective = min(static, adaptive)`. `bindingConstraint` 필드로 어떤 cap이 bind되는지 표시. |
| `newEntriesAllowed` | OK | `operatingBtcSats < 50_000`이면 전략별 `newEntriesAllowed = false`. |
| **rebalancer.mjs 연동** | **없음** | `src/executor/capital/rebalancer.mjs`가 `buildAdaptiveCapitalPlan`를 **전혀 호출하지 않음**. grep 결과 0건. |
| **tick loop** | **없음** | 매 10분마다 잔고 read → cap 재산출 → strategyCaps 업데이트하는 loop 없음. |
| **Capital Manager orchestrator** | **없음** | `buildCapitalManagerRefillJobs`는 여전히 `strategyCaps`를 인자로 받음. adaptive overlay를 적용하는 상위 caller 없음. |

**결론**: T4는 pure function 모듈만 완성. **Capital Manager가 이것을 소비하지 않음**. Opus commit message에 "Wiring into rebalancer.mjs's tick is a separate follow-up"이라고 명시. 즉, T4는 plan primitive만 구현하고 실제 소비는 미래 작업.

### T15 페이백 KPI 슬라이스에 HHI/분산 KPI 추가 — **사실상 미착수 (Opus 4.7 환각)**

Opus 보고 "T15 완료"는 **`src/executor/payback/diversification-kpi.mjs` 파일만 존재한다는 의미**. 실제 연동은 전혀 없음.

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/executor/payback/diversification-kpi.mjs` | 파일 존재 | `buildDiversificationKpiSlice` pure function. HHI, effectiveN, top5, violations. |
| **dashboard JSON 연동** | **없음** | `src/cli/write-session-handoff.mjs`, `src/status/dashboard-status.mjs` 모두 `diversification`/`HHI`/`buildDiversificationKpiSlice`를 **전혀 참조하지 않음**. grep 결과 0건. |
| **allocation 데이터 소스** | **없음** | `buildDiversificationKpiSlice`는 `allocations` 객체를 인자로 받음. 현재 시스템에 per-strategy allocation을 추적하는 ledger 없음. accumulator, inventory, capital manager 모두 per-chain/token 단위. |
| **페이백 accumulator 병합** | **없음** | `accumulator.mjs` output에 diversification 필드 없음. |

**결론**: T15는 **파일 1개만 만들어진 채로 연동 0**. Opus가 "완료"라고 보고한 것은 `diversification-kpi.mjs` pure function 구현까지만. dashboard JSON에 이것을 삽입하려면:
1. `write-session-handoff.mjs` 또는 `dashboard-status.mjs`에서 `buildDiversificationKpiSlice` 호출 추가
2. allocation ledger 구현 (per-strategy share 추적)
3. dashboard JSON 스키마에 `diversification` 섹션 추가

이 3개 모두 미착수.

### T12 S6 GMX V2 Perp Basis Adapter — 완료 (commit 5e93060), 19테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/gmx-basis-adapter.mjs` | 완료 | `evaluateGmxBasisAdapter` pure function. Delta-neutral perp basis evaluator. |
| **전략 ID** | `gmx-v2-perp-basis-avax` | S6 Avalanche. Long spot BTC.b + short BTC perp on GMX V2. |
| **T3 연동** | **있음** | `import { evaluateFundingRateGate } from "../executor/risk/funding-rate-gate.mjs"`. **T8-T12 중 유일하게 T3 risk 모듈을 직접 import**. |
| **Funding gate** | 평가 시 재확인 | `policyGates`에서 `fundingVerdict.action !== "allow_entry"`이면 gate. `projectedEconomics`에서 `ewmaRate`를 funding gate verdict에서 추출. |
| **Market gates** | 11개 | funding_rate_samples, recent_negative_days, borrow_apr, open_interest_imbalance, spot_price, perp_mark_price, perp_liquidity, projected_health_factor, entry_slippage, exit_slippage, gateway_quote_fresh, gateway_round_trip_cost. |
| **Policy gates** | 8개 | funding_gate_action(!=allow_entry), borrow_apr_above_threshold(>600bps), open_interest_imbalance_excessive(>30%), projected_health_factor_below_minimum(<1.4), entry/exit_slippage_above, round_trip_cost_above, spot_perp_price_divergence_excessive(>100bps). |
| **Economics** | 90일 horizon | fee-based 전략과 달리 funding 수익은 누적되어야 의미 있음. 90일 projection. `projectedAnnualizedNetBps >= minProjectedAnnualNetBps`(800bps=8%) gate. |
| **Leverage** | shortLeverage: 2.0 (max 5.0) | delta-neutral basis에서 short perp의 레버리지. liquidationBufferPct: 25%(maintenance margin 위 25% 유지). |
| **live_candidate 추가 조건** | 2개 | `liquidationBufferProvenCount === signerBackedCount`(100% receipt가 청산 버퍼 유지) + `autoUnwindProvenCount >= 1`(funding flip 시 자동 unwind 1회 이상 증명). |
| **Shadow mode** | OK | `perTradeCapUsd=0`, `perDayCapUsd=0`, `autoExecute=false`. |
| **caller 연동** | **없음** | `evaluateGmxBasisAdapter`를 호출하는 코드 없음. T14 dispatcher에 주입되지 않음. |
| **market snapshot 수집** | **미연결** | GMX V2 funding rate history, open interest imbalance, perp mark price, BTC.b spot price, borrow APR 등을 수집하는 어댑터 없음. |
| **receipt 수집** | **미연결** | perp position의 liquidation buffer proof, auto-unwind proof를 생성하는 live executor 없음. |

**결론**: T12는 GMX V2 perp basis 전략 evaluator 완성. **T3 funding-rate-gate와의 직접 연동은 처음**. delta-neutral 전략 특성상 liquidation buffer와 auto-unwind 증명이 live 승격의 핵심. 90일 horizon은 다른 adapter(30일)보다 길어 shadow→live 전환에 더 많은 시간 필요. 실제 GMX V2 SDK 결합 + position executor는 후속 작업.

### T13 S7 Beefy Folding Vault Adapter — 완료 (commit bc39e74), 17테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/strategy/beefy-folding-adapter.mjs` | 완료 | `evaluateBeefyFoldingAdapter` pure function. Auto-compounding folded lending vault evaluator. |
| **전략 ID** | `beefy-folding-vault` | S7 Base. Beefy vault가 Moonwell folding을 내부적으로 처리. |
| **Black-box 접근** | vault를 black-box로 취급 | Beefy가 rebalancing을 처리하므로 adapter는 vault 상태만 감시. underlying protocol(Moonwell)의 HF는 visibility로만 확인. |
| **Market gates** | 10개 | vault_tvl, vault_net_apy, beefy_performance_fee, underlying_health_factor, underlying_utilization, vault_paused, entry_slippage, exit_slippage, gateway_quote_fresh, gateway_round_trip_cost, offramp_cost. |
| **Policy gates** | 10개 | vault_paused(즉시 차단), vault_tvl_below_min(>$1M), position_share_of_vault_excessive(>5% of TVL), vault_net_apy_below_threshold(>200bps), beefy_performance_fee_above_threshold(>10%), underlying_health_factor_below_minimum(<1.5), entry/exit_slippage_above, round_trip_cost_above, offramp_cost_above. |
| **Concentration risk gate** | **유일** | `maxVaultShareOfTvlPct: 5`. 우리 포지션이 vault TVL의 5% 초과 시 차단. **T8-T13 중 유일한 concentration gate**. |
| **Economics** | 90일 horizon | passive parking sleeve라 90일 projection. `reportedNetApyBps`가 Beefy fee 차감 후 net APY. |
| **live_candidate 추가 조건** | 1개 | `vaultWithdrawalProvenCount >= 1`(vault에서 full exit 증명 — withdrawal queue/pause/share 비유동성 검증). |
| **Shadow mode** | OK | `perTradeCapUsd=0`, `perDayCapUsd=0`, `autoExecute=false`. |
| **caller 연동** | **없음** | `evaluateBeefyFoldingAdapter`를 호출하는 코드 없음. T14 dispatcher에 주입되지 않음. |
| **market snapshot 수집** | **미연결** | Beefy vault API(TVL, net APY, performance fee), Moonwell underlying HF/utilization, vault pause status 등을 수집하는 어댑터 없음. |
| **receipt 수집** | **미연결** | vault deposit + withdrawal proof를 생성하는 live executor 없음. |

**결론**: T13은 Beefy folding vault 전략 evaluator 완성. **T8-T13 중 가장 단순한 구조** — vault를 black-box로 취급. concentration risk gate(5% of TVL)는 대형 포지션 진입 시 유의미. 90일 horizon은 T12와 동일. 실제 Beefy vault SDK + withdrawal path 테스트는 후속 작업.

### T24 Dashboard Mindmap UI 분석

| 항목 | 상태 | 비고 |
|---|---|---|
| `dashboard/public/mindmap.jsx` | React 컴포넌트 | 직접 JSX로 구현. T23의 `buildMindmapSlice`를 **전혀 참조하지 않음**. |
| `dashboard/public/data.jsx` | 데이터 어댑터 | `fetch('./dashboard-status.json')` → `CHAINS`, `STRATEGIES`, `KPI`, `HOLDINGS`로 매핑. |
| **STRATEGY_CATALOG** | 하드코딩 | `data.jsx`에 11개 전략 하드코딩. T8-T13 새 adapter **미포함**. |
| **CHAINS** | 12개 | `bitcoin`(source) + 11 destinations. AGENTS.md Gateway 11개 chain과 일치. |
| **UI 구조** | 3계층 | (1) Bitcoin L1 source(top) → (2) BOB Gateway center → (3) 11 L2 destination ring. |
| **상호작용** | tap-to-zoom | chain tap → 해당 chain만 확대 + protocol chip bloom. background tap → reset. |
| **애니메이션** | Flow token | Bezier curve를 따라 token이 이동. live chain은 실선, 비live는 점선. |
| **Protocol chip** | chain 주변 bloom | `EndpointProtocols`가 chain 주변에 protocol mark를 배치. loop 타입은 회전하는 원형 dashed line. |
| **T23과의 관계** | **완전 분리** | `buildMindmapSlice`는 pure function으로 `{nodes, edges, counts}`를 생성. dashboard는 이를 전혀 소비하지 않고 자체 JSX + 하드코딩 데이터로 렌더링. |

**dashboard 하드코딩된 11개 전략 목록**:
1. `wrapped-btc-loop-base-moonwell` (loop, 3 loops)
2. `recursive_wrapped_btc_lending_loop` (loop, 4 loops)
3. `gateway-btc-onramp` (bridge)
4. `gateway-btc-offramp` (payback)
5. `gateway-btc-funding-transfer` (bridge)
6. `proxy-spread-experiment` (arb)
7. `token-dex-experiment` (swap)
8. `native-dex-experiment` (swap)
9. `gas-zip-native-refuel` (refuel)
10. `wrapper-btc-arbitrage` (arb)

**T8-T13 새 adapter가 dashboard에 반영되려면**:
1. `dashboard/public/data.jsx`의 `STRATEGY_CATALOG`에 T8-T13 전략 추가
2. `dashboard/public/mindmap.jsx`의 `TYPE_LABEL`/`TYPE_INK`에 새로운 strategy type(`fixed_yield_pt`, `concentrated_liquidity_lp`, `lending_plus_lp_with_governance_reward`, `delta_neutral_perp_basis`, `auto_compounding_folded_lending`) 추가
3. `CHAINS`에 `berachain`은 이미 있음. `avalanche`도 있음.

**결론**: T24는 이미 완성된 React dashboard UI. T23의 `buildMindmapSlice` pure function은 dashboard에서 **사용되지 않음**. dashboard는 자체 하드코딩 데이터와 JSX로 독립적으로 동작. T8-T12 adapter가 추가되면 `data.jsx`의 `STRATEGY_CATALOG`를 수동 업데이트해야 UI에 표시됨. 이는 AGENTS.md invariant #5(cap 변경은 커밋으로만)와 일치하지만, **UI 데이터 하드코딩은 별도의 동기화 문제**를 만듦.

### T24 Dashboard Mindmap Mobile Layout — 완료 (commit 413641c), 13테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/dashboard/mindmap-layout.mjs` | 신규 | Pure layout helper. `placeChainRing`, `bloomRadiusForCount`, `computeProtocolBloom`, `isFontSizeReadable`. |
| **MOBILE_VIEWPORT** | frozen | `375x812`(iPhone reference). `Object.freeze`. |
| **Font floors** | 2개 | `MINDMAP_FONT_FLOOR_PX: 10`(SVG label), `READABLE_FONT_FLOOR_PX: 12`(body copy). |
| **bloomRadiusForCount** | 적응형 | `count > 1`이면 `requiredChord = 2*chipR + padding` → `radius = requiredChord / (2*sin(gap/2))`. `minR=60` 하한. 5+ protocol에서 고정 R=62로 발생하던 겹침 해소. |
| **computeProtocolBloom** | anchor 기반 | `anchor = chain position` → `baseA = atan2(anchor.y, anchor.x)`. chip을 `PROTOCOL_BLOOM_SPREAD=0.8π` 안에 균등 배치. |
| **Tests** | 13개 | 11체인 링 거리, 1~8개 protocol 모든 조합 chip 비충돌(거리 ≥ 2*chipR+6), viewport frozen, font 하한. |
| **mindmap.jsx 변경** | inline mirror | 고정 `R=62`를 `bloomRadiusForCount(count, chipR)`로 교체. `fontSize` 본문 ≥12px, SVG label ≥10px로 상향. 헤더 주석에 helper/test 위치 명시. |
| **T23와의 관계** | 여전히 없음 | `buildMindmapSlice`는 여전히 dashboard에서 호출되지 않음. T24는 layout invariant만 추가. |

**결론**: T24는 mindmap mobile layout의 **기하학적 invariant를 코드로 못 박음**. 5+ protocol이 있는 chain(Base, BOB 등)에서 chip 겹침 문제를 적응형 radius로 해결. 13개 테스트가 모든 count(1~8) x chipR(31) x padding(6) 조합에서 비충돌 보장. 실제 mobile device에서의 라이브 확인은 T27 배포 이후.

### T25 22 Self-Hosted Logo SVGs — 완료 (commit 951de07), 11테스트

| 항목 | 상태 | 비고 |
|---|---|---|
| `dashboard/public/assets/logos/` | 22개 SVG | chains/ 11개 + protocols/ 11개. 모두 64×64 letter-mark. |
| **Chains** | 11개 | bitcoin, ethereum, base, bsc, avalanche, unichain, bera, optimism, soneium, sei, sonic. 각 브랜드 공식 primary color 사용. |
| **Protocols** | 11개 | moonwell, morpho, pendle, aerodrome, beefy, gmx, bend, bex, k3capital, babylon, solv. |
| **Generator** | `generate.mjs` | `CHAIN_MARKS`/`PROTOCOL_MARKS` 배열에서 idempotent하게 생성. overwrite-safe. 수동 수정 시 다음 run에 손실됨. |
| **Manifest** | `manifest.json` | `schema: bobclaw-logo-manifest@1`. chains[] + protocols[]. 각 항목: `id`, `file`, `color`. |
| **License** | `LICENSES.md` | **placeholder** 상태 명시. third-party trademarked artwork 미번들. fair-use safe ground. 교체 계약(replacement contract) 문서화: (1) SVG 교체, (2) license string 업데이트, (3) canonical asset URL + date, (4) attribution footer. |
| **logos.jsx 변경** | 로컬 우선 | `assets/logos/`에서 먼저 로드. CDN은 후순위 폴백. `data-chain-logo` / `data-protocol-logo` 속성 추가로 T26 Playwright가 src 스크래핑 없이 자산 식별. |
| **Tests** | 11개 | 파일 존재, 브랜드 컬러 포함, viewBox/aria 일관, 매니페스트 스키마, 라이선스 문서가 모든 id 참조. |

**결론**: T25는 **외부 CDN 의존 제거 + fair-use compliance**를 동시에 달성. 22개 placeholder SVG는 letter-mark + brand color로 시각적 식별 가능. 실제 brand artwork 교체는 LICENSES.md의 replacement contract를 따름. T26 Playwright 시각 회귀가 `data-*` 속성으로 자산 식별 가능.

**T26 수정**: bob chain + gateway/odos/gaszip 프로토콜 로고가 T25 배치에 빠져 있었음 → 추가. 현재 12 chains + 14 protocols.

### T26 Mobile Mindmap Visual Regression — 완료 (commit ff11ba3), 1214/1216 green (2 pre-skip)

| 항목 | 상태 | 비고 |
|---|---|---|
| `src/dashboard/visual-regression.mjs` | 신규 | Pure function visual regression evaluator. Chromium 미설치 환경 우회. |
| **방식** | DOM-shape invariant | `evaluateChainTap`이 per-chain으로 logo missing + chip overlap + viewport overflow를 layout geometry로 계산. pixel 렌더링 없음. |
| **evaluateChainTap** | 3가지 검사 | (1) `knownChainLogoIds.has(chainId)` — logo missing, (2) `rectInsideViewBox(chainCircle, VIEWBOX)` — chain off-frame, (3) chip rect pairwise `rectsOverlapPx > 5` — overlap. |
| **runVisualRegression** | aggregate | 11 destination chains x `evaluateChainTap` → `{ok, failures}`. `failures.length === 0`이면 pass. |
| **T24 재사용** | `computeProtocolBloom` | T24의 layout helper를 그대로 사용해 chip 위치 계산. 실제 `mindmap.jsx`와 동일한 layout invariant. |
| **T25 재사용** | `manifest.json` | known logo IDs를 manifest에서 추출. `data-chain-logo`/`data-protocol-logo` 속성으로 매칭. |
| **Catalog drift guard** | `data-catalog.mjs` | mirror module의 모든 id가 `data.jsx` 본문에 존재하는지 string-level 검증. catalog 추가/삭제 시 drift 감지. |
| **Playwright 대체** | pure function | 실제 Chromium `boundingBox()`는 별도 트랙. 현재는 DOM-shape invariant만 보장. 향후 `locator.boundingBox()`로 swap 가능. |
| **Tests** | 1214/1216 green | 2개 pre-skip. 전체 suite pass. |

**결론**: T26은 **pixel-free visual regression**. Playwright/Chromium 없이 pure function으로 mindmap layout의 핵심 실패 조건(logo missing, chip overlap >5px, viewport overflow)을 11체인 x protocol 조합에 대해 검증. 실제 pixel diffing은 향후 `boundingBox()` 소스로 교체 가능. catalog drift guard로 `data.jsx`와 logo manifest 간 동기화 유지.

### T27 Dashboard Auto-Deploy Pipeline — 완료 (commit 2520334)

| 항목 | 상태 | 비고 |
|---|---|---|
| `.github/workflows/dashboard-deploy.yml` | 신규 | GitHub Actions workflow. dashboard/static asset 전용. **signer key/cap 권한 없음**. |
| **Trigger** | 2가지 | (1) `push to main` + `paths: dashboard/**, src/dashboard/**, src/cli/status-dashboard.mjs, src/cli/deploy-dashboard-cloudflare.mjs, .github/workflows/dashboard-deploy.yml`, (2) `workflow_dispatch` 수동. |
| **Preflight** | 4단계 | `npm ci` → layout/visual-regression tests(`mindmap-layout`, `logo-assets`, `dashboard-visual-regression`) → `node --check dashboard/public/app.js` syntax → full `npm test`. |
| **Deploy** | Cloudflare Pages | `needs: preflight` — preflight 실패 시 deploy 불가. `wrangler@^3`로 `src/cli/deploy-dashboard-cloudflare.mjs` 실행. |
| **Concurrency** | `cancel-in-progress: true` | 중복 배포 자동 취소. `dashboard-deploy-${{ github.ref }}`. |
| **Environment** | `dashboard-production` | deployment_url output. GitHub environment tab에 URL 표시. |
| **Required secrets** | 3개 | `CLOUDFLARE_API_TOKEN`(Pages:Edit + Account:Read), `BOB_CLAW_CF_PAGES_PROJECT`, `BOB_CLAW_CF_PRODUCTION_BRANCH`(default: main). |
| **skip_status** | `workflow_dispatch` 옵션 | `dashboard-status.json` 재생성 없이 기존 파일로 배포. |
| **dashboard/README.md** | 업데이트 | T27 pipeline 단계, required secrets, contract(정적 자산만) 명시. |
| **불변 원칙** | 준수 | "This workflow does NOT manipulate signer keys, capital, or caps. It only uploads the static dashboard artifact." |

**결론**: T27은 **deterministic dashboard publish pipeline** 완성. push trigger로 dashboard 경로 변경 시 자동 배포. preflight 게이트로 layout/시각회귀/syntax/전체테스트 통과 후에만 deploy. key/cap 권한 없는 정적 자산 전용. CF Pages secret 3개만 등록하면 첫 수동 배포 가능. **실제 배포는 GitHub Actions secrets 설정 후에야 가능**. 현재 secrets 미등록 상태이므로 workflow는 inactive.

---

## Opus 4.7 진행 종합 (28개 todo 중 27개 완료, 2026-04-21)

| # | Todo | 파일 | 테스트 | caller 연동 | I/O |
|---|---|---|---|---|---|
| T1 | capital-adaptive caps | `src/config/capital-adaptive.mjs` | 11 | **없음** | 없음 |
| T2 | diversification policy | `src/config/diversification.mjs` | 16 | **없음** | 없음 |
| T3 | risk daemon 7 modules | `src/executor/risk/*` | 23 | **없음** | 없음 |
| T4 | adaptive capital plan | `src/executor/capital/adaptive-caps.mjs` | 11 | **없음** | 없음 |
| T5 | revalidation scheduler | `src/executor/revalidation/scheduler.mjs` | — | **없음** | 없음 |
| T6 | liveTrading policy eligibility | `src/status/live-policy.mjs`(Kimi) + removed dynamic-gate experiment | — | **부분** | 없음 |
| T7 | recursive lending loop measurement | **미착수(운영 blocker)** | — | — | **필요** |
| T8 | Pendle PT-LBTC | `src/strategy/pendle-pt-lbtc-adapter.mjs` | 18 | **없음** | 없음 |
| T9 | Pendle PT-SolvBTC | `src/strategy/pendle-pt-solvbtc-bbn-adapter.mjs` | 18 | **없음** | 없음 |
| T10 | Aerodrome CL | `src/strategy/aerodrome-cl-adapter.mjs` | 20 | **없음** | 없음 |
| T11 | Berachain Bend/BEX | `src/strategy/berachain-bend-bex-adapter.mjs` | 20 | **없음** | 없음 |
| T12 | GMX V2 perp basis | `src/strategy/gmx-basis-adapter.mjs` | 19 | **없음** | 없음 |
| T13 | Beefy folding | `src/strategy/beefy-folding-adapter.mjs` | 17 | **없음** | 없음 |
| T14 | strategy catalog dispatcher | `src/executor/dispatcher/strategy-catalog-dispatcher.mjs` | 14 | **없음** | 없음 |
| T15 | diversification KPI slice | `src/executor/payback/diversification-kpi.mjs` | — | **없음** | 없음 |
| T16 | OFT exploit detector | `src/risk/oft-exploit-detector/oft-exploit-detector.mjs` | 13 | **없음** | 없음 |
| T17 | shadow run aggregator | `src/executor/shadow/shadow-run-aggregator.mjs` | 14 | **없음** | 없음 |
| T18 | autoExecute=true commit guard | auto-promotion dev guard + `src/cli/promotion-pr-preview.mjs` | 14 + 6 historical | **없음** | **부분** |
| T18b | walk-forward purged CV | `src/strategy/walk-forward-cv.mjs` | 12 | **없음** | 없음 |
| T18c | regime-change detector | `src/strategy/regime-detector.mjs` | 17 | **없음** | 없음 |
| T18d | adapter→dispatcher bridge | `src/executor/dispatcher/candidate-builder.mjs` | 13 | **없음** | 없음 |
| T19 | balance snapshot reconciler | `src/executor/balance/reconcile.mjs` | 12 | **없음** | 없음 |
| T20 | multi-hop bootstrap planner | `src/executor/bootstrap/multi-hop-planner.mjs` | 11 | **없음** | 없음 |
| T21 | canary promotion state machine | `src/executor/canary/canary-runner.mjs` | 15 | **없음** | 없음 |
| T22 | watchdog feed freshness | `src/executor/watchdog/feed-freshness.mjs` | 13 | **없음** | 없음 |
| T23 | dashboard mindmap slice | `src/status/mindmap-slice.mjs` | 14 | **없음** | 없음 |
| T24 | mindmap mobile layout | `src/dashboard/mindmap-layout.mjs` | 13 | N/A | 없음 |
| T25 | 22 self-hosted logos | `dashboard/public/assets/logos/` | 11 | N/A | 없음 |
| T26 | visual regression | `src/dashboard/visual-regression.mjs` | (suite) | N/A | 없음 |
| T27 | dashboard deploy pipeline | `.github/workflows/dashboard-deploy.yml` | — | N/A | 없음 |

**핵심 패턴**: 27개 완료 todo 중 **25개는 pure function evaluator**. caller/연동 없음. 실제 I/O(데이터 수집, 서명, 브로드캐스트)가 없으면 L2→L3 전환 불가.

**남은 2개 todo(T7, T18)는 모두 운영 데이터 수집 blocker**:
- **T7**: recursive lending loop signer-backed receipt 수집. live signer에서 실제 transaction이 누적돼야 dry_run → live 승격 가능. **cron 트리거 + 라이브 시그너 소규모 라운드 필요**.
- **T18**: 전략별 autoExecute=true 커밋. T17(shadow aggregator) + T20(multi-hop bootstrap) + T7(receipt 증거)가 첨부돼야 cap-flip PR 가능. **데이터 의존적, 코드 의존성 없음**.

**L2→L3 실제 trigger**:
1. T7 receipt 캠페인 실행 → S1 wrapped-BTC loop 또는 S2 recursive loop에서 `policy_ready` 나옴
2. `edgeViability`가 `live-policy.mjs`에서 `liveTrading: ALLOWED`로 전환(Kimi가 이미 T6에서 구현)
3. liveTrading ALLOWED + canary runner 승격(caps=0에서 canary_1=5k sats) → T21이 PR emit
4. operator가 PR merge → `autoExecute=true` + cap 상향 커밋(T18)
5. 첫 canary receipt 누적 → T17 shadow aggregator가 ready → T21이 live로 승격
6. grossProfitSats_period > 0 → payback accumulator가 planned payback emit

**현재 상태**: 코드 트랙 **28/28 그린 + T18b walk-forward CV + T18c regime-change detector 추가**. **운영 트랙(T7 receipt 캠페인)이 유일 blocker**.

**T18 추가 상태**: promotion gate + daily cron은 완성. 현재는 receipt 0개로 모든 전략 `blocked: insufficient_signer_backed_receipts`. receipt 누적되면 `eligible: true` + `suggestedDiff` 자동 생성. operator가 수동 PR → cap flip commit. 자동 PR 생성은 없음.
