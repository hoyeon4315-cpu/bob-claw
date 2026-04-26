# Full-Automation Progress (Score-Weighted Multichain Auto-Rebalance)

마지막 업데이트: 2026-04-26

## 목표

BTC L1만 보유한 상태에서 시작 → 점수 기반(promotionGate.score)으로 chain × strategy 별 목표 USD 분배를 예측 → 흩어진 자산(USDC on BSC 등)도 자동으로 목표 벡터에 수렴 → 전부 단일 autopilot tick 안에서 결정·발행됨.

## 완료된 변경

### C1. Score-weighted target builder + planner bug fix
- 파일:
  - 신규 `src/executor/capital/scored-target-balances.mjs` — `buildScoredTargetBalances({ promotionGate, economics, strategyCaps, totalCapitalUsd })`. weight = max(0, score), per-strategy USD = `(weight/sumWeights)*total`, `strategy.caps.perChainUsd[chain]`로 클립. strategy 매칭 안되면 캡 없음(보수적으로 매칭 안되면 `null`).
  - 수정 `src/strategy/destination-allocation-planner.mjs` — 기존 버그 `Math.min(remainingActiveBudget, activeBudgetUsd)` 제거, `distributeBudget()` 도입(score-weighted, per-item cap 클립).
- 테스트: `test/scored-target-balances.test.mjs`, `test/destination-allocation-distribution.test.mjs`.

### C2. Bidirectional rebalancer
- 파일: `src/executor/capital/rebalancer.mjs`
  - `buildCapitalRebalancePlan` 시그니처에 `scoredTargets` 추가. 전달되면 `targets`를 score-weighted per-chain으로 사용.
  - `policy.capital.rebalanceToleranceUsd` (default 5) 도입.
  - shortfall은 기존 `capital_rebalance` 그대로. 잉여 chain은 `surpluses`에 모음 → `buildCapitalRebalanceMatchedTransfers`로 shortfall과 페어링 → matched된 만큼 빼고 잔여만 `capital_drain` 발행. 매칭된 surplus는 기존 fundingSourcePlan이 source chain으로 자연스럽게 사용함(이중 발행 안됨).
  - `buildCapitalManagerRefillJobs`도 `scoredTargets` 인자 받아 그대로 통과.
- 테스트: `test/capital-bidirectional-rebalance.test.mjs`. 기존 `test/capital-rebalancer.test.mjs`의 wrapped-BTC 테스트 1건 expectation 업데이트.

### C3. Bootstrap-from-BTC CLI + autopilot wire-in
- 파일:
  - 신규 `src/cli/run-bootstrap-from-btc.mjs` (export: `buildBootstrapFromBtcReport`). flags: `--btc-balance-sats`, `--btc-price-usd`, `--total-capital-usd`, `--write`, `--json`. 출력: `data/bootstrap-from-btc.json`.
  - 수정 `src/executor/all-chain-autopilot.mjs` — `runAllChainAutopilot` 파라미터 `bootstrapBtcSats`, `bootstrapBtcPriceUsd`, `bootstrapTotalCapitalUsd` 추가. 입력 있으면 gas snapshot 직후 `bootstrap_from_btc` step 실행.
  - 수정 `src/cli/run-all-chain-autopilot.mjs` — `--bootstrap-btc-sats=`, `--bootstrap-btc-price-usd=`, `--bootstrap-total-capital-usd=` 플래그 통과.
  - 수정 `package.json` — `executor:bootstrap-from-btc` 스크립트 추가.
- 테스트: `test/bootstrap-from-btc.test.mjs`.

### C4. Proactive Base cbBTC handoff
- 파일: `src/executor/all-chain-autopilot.mjs` `wrappedBtcHandoffAmountSats()`.
  - 기존: `liveAdmissionBlockers`에 `base_cbbtc_collateral_unavailable` 있어야만 fire.
  - 변경: idle Base wBTC.OFT가 `MIN_WRAPPED_BTC_HANDOFF_USD`($5) 이상이고 strategy autoExecute=true면 proactive로도 fire.
- 기존 테스트 14개 pass.

### C5. Docs
- README "Operating Loop" 섹션 갱신 (bootstrap CLI + bidirectional drain 명시).
- AGENTS.md `Capital Manager` 항목 갱신 (scored target + bidirectional + bootstrap CLI).
- 본 문서.

## 현재 단계

**4단계** (실전 자동화 라인 + score-weighted bootstrap + bidirectional rebalance까지 코드 완료, main 머지 전).

## 검증 결과 (tests 일부)

```
node --test test/scored-target-balances.test.mjs test/destination-allocation-distribution.test.mjs test/destination-allocation-planner.test.mjs test/capital-bidirectional-rebalance.test.mjs test/capital-rebalancer.test.mjs test/capital-target-balances.test.mjs test/bootstrap-from-btc.test.mjs test/all-chain-autopilot.test.mjs test/wrapped-btc-loop-bindings.test.mjs
→ 모두 pass (단, `capital manager wrapper emits auto-executable Gas.Zip gas-float refill jobs` 1건은 main 기준에서도 실패하는 pre-existing 버그라 본 작업 범위 외).
```

## 알려진 한계 / 후속

- BSC 출구 Across 미지원. BSC에서 USDC drain은 Gateway/CCTP 같은 fallback이 필요. 현재 `buildTreasuryRefillJobs`가 사용 가능한 경로만 잡는다 — BSC drain이 막히면 그대로 blocker로 노출됨. 후속 작업: BSC stablecoin offramp lane.
- proactive cbBTC handoff은 `MIN_WRAPPED_BTC_HANDOFF_USD = $5` 정적값. 운영 데이터 누적 후 cap 동적화 검토.
- payback `minPaybackSats=50_000`은 본 작업 범위 외 (사용자가 carry 수용).
- pre-existing failing test `Gas.Zip gas-float refill jobs` — buildCapitalRebalancePlan이 `canaryStartUsdMax=50` policy default 때문에 perChainUsd=0인 strategy도 settlementTargetUsd=50을 만들어 capital_rebalance까지 발행. main에서도 동일 문제. 별도 cleanup 필요.

## 새 세션 이어가기

이 문서 + `CLAUDE.md` + `AGENTS.md` 읽고:
1. `git status`로 현재 머지/푸시 상태 확인.
2. `node --test test/*.test.mjs` 실행 후 fail 카운트 비교 — Gas.Zip 1건 외 신규 failure 없으면 OK.
3. 후속이라면 BSC offramp lane 또는 cap 동적화부터 진행.
