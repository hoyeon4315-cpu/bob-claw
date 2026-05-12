# DIA DeFi Vaults Lending Loophole Audit — Codex (2026-05-12)

## Confidence Standard

I am not claiming literal certainty about future market profit. The target is AGENTS.md evidence-complete confidence: repo-visible callers accounted for, known operating-law loopholes closed, policy authority intact, tests passing, and no live-path regression found in the final review loop.

## Loopholes Found

1. **Protocol alias false positives.** `protocolsMatch("", "aave-v3")` and substring-only pairs could match unrelated DefiLlama pools. This could attach Merkl evidence to the wrong protocol surface.
   - Fix: canonical-only protocol matching; empty ids never match; substring matching removed.
   - Regression: `test/protocol-id-aliases.test.mjs`, `test/report-campaign-aware-opportunities.test.mjs`.

2. **Pool selection used first match instead of strongest evidence.** Multiple DefiLlama pools for the same chain/protocol/token could pick a weaker low-TVL pool by array order.
   - Fix: candidate pool matches are ranked by token coverage, then TVL.
   - Regression: `getDefiLlamaPool` test prefers highest TVL after matching protocol/chain/token.

3. **Missing numeric DefiLlama fields became zero.** `Number(null)` converted unknown APY/TVL/sigma fields to `0`, which weakens evidence accuracy and can hide missing-data blockers.
   - Fix: explicit `numberOrNull` helpers in DefiLlama normalization, client, and proxy spread source builder.
   - Regression: `test/strategy/defillama-yield-adapter.test.mjs`, `test/defillama-client.test.mjs`, `test/proxy-spread-expansion-adapter.test.mjs`.

4. **Oracle divergence samples lacked strict pair labels.** Raw price samples could be grouped as `unknown`, allowing cross-asset comparisons such as BTC vs ETH if consumed directly.
   - Fix: `priceSamplesFromSnapshot` now attaches canonical pair labels such as `BTC/USD`, `ETH/USD`, `CBBTC/USD`, `BNB/USD`.
   - Regression: `test/prices.test.mjs`.

5. **Oracle divergence source count could be inflated by duplicate fields from one provider.** A single source could contribute multiple same-pair samples and satisfy `minSourceCount`.
   - Fix: `evaluateOracleDivergence` now groups by pair and then by distinct source; duplicate same-source samples are collapsed by median before divergence evaluation.
   - Regression: `test/auto-kill-triggers.test.mjs`.

## Diagnostics Snapshot

- `npm run report:policy-coverage -- --json`: `runtimeAuthority` is `policy_engine_only`; `totalChecks` is `11`; `enforcedByPolicy` is `11`.
- `node src/cli/check-full-automation-readiness.mjs --json`: `ready=false`; blockers include `dependency_command_failed:capitalManager`, `capital_rebalancer_not_ready`, and `strategy_dispatch_not_ready`; `defillama-yield-portfolio` remains `analysis_only` with `live_executor_not_bound`.
- `npm run report:payback-status -- --json`: scheduler status is `carry`; reason is `planned_payback_below_minimum`; `accumulatorPendingSats=578`; `minPaybackSats=5000`.
- `npm run report:capital-audit -- --json`: status is `complete_with_residual_checks`; summary has `unmatchedBroadcastCount=0`; issue list still includes live-read failures such as `receipt_read_failed` and `bitcoin_history_read_failed`.
- `dashboard/public/dashboard-status.json`: `liveTrading` is `BLOCKED`; blockers include `kill_switch_present` and `kill_switch_stale_arm_present`.

## Verification

- RED loop before fixes: targeted tests failed on the five core loopholes above.
- GREEN focused loop: `node --test test/defillama-client.test.mjs test/protocol-id-aliases.test.mjs test/report-campaign-aware-opportunities.test.mjs test/prices.test.mjs test/auto-kill-triggers.test.mjs test/strategy/defillama-yield-adapter.test.mjs test/proxy-spread-expansion-adapter.test.mjs` passed `82` tests.

## Verdict

After this patch, I have evidence-complete confidence in the implemented data/evidence strategy surfaces under current repo authority. I am not confident that the strategy is currently live-executable or profitable: current diagnostics still show operational blockers, payback carry, capital-manager timeout, routing exhaustion, and kill-switch blockers. The correct current state is conservative: analysis/shadow evidence is improved; live movement remains blocked by policy/runtime state.

## Follow-up Loop — Full Regression Determinism

### Additional Loophole Found

6. **Full regression depended on live network/RPC paths.** `test/autopilot-portfolio.test.mjs` called `runAutopilotTick()` without fixture opportunities or injected positions. That let the test hit live DefiLlama fetch and protocol RPC reconciliation, so a network failure could make the evidence-complete loop fail without a code regression.
   - Fix: tests now inject fixture opportunities and `previousPositions: []` for non-RPC cases.
   - Regression: `node --test test/autopilot-portfolio.test.mjs` now passes `7` tests in-process without live fetch/RPC dependency.

### Updated Diagnostics Snapshot

- `npm run report:policy-coverage -- --json`: `runtimeAuthority` is `policy_engine_only`; `totalChecks` is `11`; `enforcedByPolicy` is `11`.
- `node src/cli/check-full-automation-readiness.mjs --json`: `ready=false`; only top-level blocker is `strategy_dispatch_not_ready`; `runtime.ready=true`; `capitalManager.ready=true`; `liveEligibleCount=0`; `defillama-yield-portfolio` remains `analysis_only` with `live_executor_not_bound`.
- `npm run report:payback-status -- --json`: scheduler status is `carry`; reason is `planned_payback_below_minimum`; `accumulatorPendingSats=580`; `minPaybackSats=5000`; `progressToMinimumRatio=0.0232`.
- `dashboard/public/dashboard-status.json`: `liveTrading` is `BLOCKED`; blockers are `kill_switch_present` and `kill_switch_stale_arm_present`; `shadowTrading` is `ALLOWED`.

### Updated Verification

- Focused regression: `node --test test/autopilot-portfolio.test.mjs test/defillama-client.test.mjs test/protocol-id-aliases.test.mjs test/report-campaign-aware-opportunities.test.mjs test/prices.test.mjs test/auto-kill-triggers.test.mjs test/strategy/defillama-yield-adapter.test.mjs test/proxy-spread-expansion-adapter.test.mjs` passed `89` tests.
- Full regression: `npm test` passed `3565` tests, `0` failed, `1` skipped.

### Updated Verdict

Evidence-complete confidence is now green for the implemented strategy evidence surfaces and regression suite. Live/profit confidence remains intentionally not green: current truth surfaces say no live dispatch (`liveEligibleCount=0`, `liveTrading=BLOCKED`) and payback remains below minimum. This is the correct safe state, not a failure to force through.
