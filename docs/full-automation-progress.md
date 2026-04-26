# Full-Automation Progress (Score-Weighted Multichain Auto-Rebalance)

마지막 업데이트: 2026-04-26 (C6~C8)

## 목표

BTC L1만 보유한 상태에서 시작 → 점수 기반(promotionGate.score)으로 chain × strategy 별 목표 USD 분배를 예측 → 흩어진 자산(USDC on BSC 등)도 자동으로 목표 벡터에 수렴 → 전부 단일 autopilot tick 안에서 결정·발행됨.

## 완료된 변경

### C1. Score-weighted target builder + planner bug fix
- 파일:
  - 신규 `src/executor/capital/scored-target-balances.mjs` — `buildScoredTargetBalances({ promotionGate, economics, strategyCaps, totalCapitalUsd })`. candidate = `autoExecute: true` 전략 × positive `caps.perChainUsd[chain]`, Gateway 공식 11체인으로 필터. promotion-gate는 score source일 뿐 execution gate가 아니며, `strategyId`/`familyId`/exposure-derived score family로 score를 찾고 없으면 `minWeight`로 fallback. 할당은 water-fill로 잔여를 재분배하고 strategy/chain cap으로 클립한다.
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

### C6. perChainUsd=0 무력화 (Gas.Zip 누수 픽스)
- 파일: `src/executor/capital/target-balances.mjs` `effectivePerStrategySettlementTargetUsd()`.
  - 기존: `perChainUsd=0` 입력시 `>0` 필터로 거부되어 policy `canaryStartUsdMax`(default 50 USD)로 누수.
  - 변경: `perChainUsd === 0`이면 즉시 0 반환 (operator의 "do not target this chain"). policy default fallback 막음.
- 효과: pre-existing failing test `capital manager wrapper emits auto-executable Gas.Zip gas-float refill jobs` 통과로 전환.

### C7. BSC bridge naming 정합 (LI.FI/Stargate)
- 파일: `src/config/bridge-providers.mjs`.
  - `lifi.supportedChains`/`stargate.supportedChains`에서 `"bnb"` → `"bsc"`로 통일 (`src/config/chains.mjs`의 chain key는 `bsc`).
  - 결과: `bridgeProvidersForPair({srcChain:"bsc", ...})`가 LI.FI를 후보로 반환 → BSC USDC drain이 Across 미지원이어도 LI.FI fallback으로 잡힘.

### C8. Diversification cap을 score-weighted target에 반영
- 파일: `src/executor/capital/scored-target-balances.mjs`.
  - `DIVERSIFICATION_POLICY` (perStrategyMaxShare=0.25, perChainMaxShare=0.35) import.
  - per-strategy 할당에 `min(weightShare, perChainUsd cap, perStrategyMaxShare*total)` 적용.
  - per-chain 합이 `perChainMaxShare*total`을 넘으면 비례 축소.
  - `diversificationPolicy` 파라미터로 opt-out 가능 (테스트용 `null`).
- `src/cli/run-bootstrap-from-btc.mjs`도 `diversificationPolicy` pass-through.
- 테스트: `test/scored-target-balances.test.mjs` (cap 적용 + opt-out), `test/bootstrap-from-btc.test.mjs` (residual buffer 케이스 추가).

### C9. 전체인 분배 보장: review_only 포함 + 잔여 자본 재분배(water-fill)
- 파일: `src/executor/capital/scored-target-balances.mjs` 전면 재작성.
  - 기존: `allocationGate.status === "allocation_ready"` 항목만 분배 → 증거 수집 지연된 체인은 0% (특정 체인 매몰 원인).
  - 변경:
    - `review_only` 항목도 candidate에 포함, `reviewOnlyWeightFactor` (default 0.3)로 가중치 축소.
    - per-strategy/per-item cap 적용 후 잘려나간 잔여를 미충족 항목에 비례 재분배(water-fill, 최대 16회 iteration). cap이 안 걸린 체인까지 자본이 흘러들어 11체인 커버리지 향상.
  - per-chain cap (perChainMaxShare=0.35)은 안전 상한이므로 redistribute 안하고 BTC reserve로 남김 (보수).
- 효과: 1~2개 체인이 cap에 걸려도 잔여가 다른 후보 체인에 흘러감. review_only인 체인도 0이 아닌 reduced share를 받음.
- 테스트: `test/scored-target-balances.test.mjs` 6건 (water-fill 잔여 재분배 + review_only 포함 + blocked 제외 검증).

### C10. score source 매칭 정합
- 파일: `src/executor/capital/scored-target-balances.mjs`.
  - root cause: 운영 `destination-promotion-gate.json`은 `familyId` 중심인데, 실제 `strategy-caps`의 autoExecute 전략 대부분은 `familyId`가 없어서 score 매칭이 1/139개에 그쳤다.
  - 변경: score lookup에 `strategyId` index를 추가하고, `familyId`가 없는 전략은 `exposure.assetFamily`에서 score family를 추론한다. Infra/refill/bridge 계열은 score family 추론에서 제외해 `minWeight` fallback만 받는다.
  - 실측: `$1000` bootstrap 기준 score 매칭 58/139, Gateway 공식 11체인, 합계 `$1000`.
- 테스트: `test/scored-target-balances.test.mjs`에 familyId 없는 stablecoin exposure 매칭 회귀 테스트 추가. `test/bootstrap-from-btc.test.mjs` fixture를 "진짜 무점수" 케이스로 정리.

## 현재 단계

**6단계 준비** — score-weighted bootstrap + bidirectional rebalance + 단일 체인/전략 dominance guard + BSC fallback lane까지 코드 완료. `$1000` bootstrap dry-run에서 11체인 분배와 합계 `$1000` 확인. 다음은 signer health + explicit execute/write 운영 tick이다.

## 검증 결과 (tests 일부)

```
node --test test/scored-target-balances.test.mjs
→ pass 7/7

node --test test/bootstrap-from-btc.test.mjs
→ pass 4/4
```

## 알려진 한계 / 후속

- ~~BSC 출구 Across 미지원~~ → C7에서 LI.FI fallback로 해결. Stargate v2는 design_scaffold (executor 미구현) 상태로 catalog에만 노출.
- proactive cbBTC handoff은 `MIN_WRAPPED_BTC_HANDOFF_USD = $5` 정적값. 운영 데이터 누적 후 cap 동적화 검토.
- payback `minPaybackSats=50_000`은 본 작업 범위 외 (사용자가 carry 수용).
- ~~pre-existing failing test `Gas.Zip gas-float refill jobs`~~ → C6에서 픽스.
- 남은 pre-existing failing tests는 broad suite에서 재확인 필요. 이전 main 기준 failure는 Gateway chain alias 중복, Cloudflare 환경, Gas.Zip refill preparation, operational address, promotion evidence/pr-preview, supportedBindingKinds, status dashboard 계열이었다.
- 실전 bootstrap plan은 운영 환경에서 `npm run executor:bootstrap-from-btc -- --total-capital-usd=... --write --json` 실행하면 `data/bootstrap-from-btc.json`에 score-weighted + diversification cap 적용된 per-chain refill plan이 생성된다.

## 새 세션 이어가기

이 문서 + `CLAUDE.md` + `AGENTS.md` 읽고:
1. `git status`로 현재 머지/푸시 상태 확인.
2. `node --test test/scored-target-balances.test.mjs test/bootstrap-from-btc.test.mjs`로 focused suite를 먼저 확인.
3. broad suite가 필요하면 `node --test test/*.test.mjs` 실행 후 fail 카운트와 pre-existing 목록 비교.
4. 후속이라면 signer health 확인 후 `executor:all-chain-autopilot -- --bootstrap-total-capital-usd=<실제> --execute --write`로 운영 tick을 진행.
