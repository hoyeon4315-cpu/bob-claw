# System Self-Block + Tracking Gap Evidence Manifest

Created before code changes.

## Run Identity

- HEAD: `de728cc6841a6164b8060ced1825fdc99cc8ef1c`
- UTC observed at: `2026-05-09T08:50:40Z`
- Branch: `codex/auto-blocker-resolution`
- Worktree status: clean at start (`git status --short --branch` returned only branch header)

## Commands Captured

- `git rev-parse HEAD`
- `date -u +"%Y-%m-%dT%H:%M:%SZ"`
- Signer audit blocker counts:
  `jq -r '.lifecycle.blockers[]? // empty' logs/signer-audit.jsonl | sort | uniq -c | sort -nr | sed -n '1,40p'`
- Dashboard status snapshot:
  `jq '{generatedAt, walletHoldings: {observedAt: .walletHoldings.observedAt, source: .walletHoldings.source, walletUsd: .walletHoldings.walletUsd, protocolUsd: .walletHoldings.protocolUsd, totalUsd: .walletHoldings.totalUsd, doubleCountPreventedCount: .walletHoldings.doubleCountPreventedCount}, assetTracking: .assetTracking, capitalSummary: .capitalSummary, execution: .executorRuntime}' dashboard/public/dashboard-status.json`
- Wallet public snapshot:
  `jq '{generatedAt, observedAt, fullWalletObservedAt, oldestMaterialSourceObservedAt, source, walletUsd, protocolUsd, totalUsd, fullWalletUsd, externalTotalPortfolioUsd, doubleCountPreventedCount, walletCoverage, assetMetadataCoverage}' dashboard/public/wallet-holdings.json`
- Capital refill snapshot:
  `jq '{observedAt, balancesChains: (.balancesByChain|keys), inventoryObservedAt: .inventory.observedAt, jobs: (.jobs|length), fundingSourcePlan: {observedAt: .fundingSourcePlan.observedAt, sourceCount: (.fundingSourcePlan.sources|length // null)}, capitalPlan: {observedAt: .capitalPlan.observedAt, totalTargetUsd: .capitalPlan.totalTargetUsd}}' data/capital-manager-refill-jobs-latest.json`

## Current Audit/Runtime Evidence

- Verified: signer audit blockers are dominated by `expected_net_unmeasured` (2669), then `max_consecutive_failures_reached` (1711), then cap/kill/stale approval blockers. Source command is listed above.
- Verified: latest signer audit rows include live-mode `approve_exact` / wrapped-loop intents rejected with `expected_net_unmeasured`; no tx/broadcast is the correct observed result for those rows.
- Verified: dashboard public status generated at `2026-05-09T07:42:41.141Z`; wallet source observed at `2026-05-09T07:41:12.998Z`; executor heartbeat observed at `2026-05-09T07:42:45.756Z`; kill-switch halted is false.
- Verified: `dashboard/public/wallet-holdings.json` generated at `2026-05-08T20:56:43.987Z`, observed at `2026-05-08T20:56:41.121Z`, walletUsd `290.5067349462368`, protocolUsd `69.564222`, totalUsd `360.07095694623683`, doubleCountPreventedCount `1`.
- Verified: `dashboard/public/dashboard-status.json` currently shows capitalSummary `currentTotalUsd=320.35`, `currentWalletUsd=320.3490988981169`, `protocolDeployedUsd=0`, `assetFormula=current_wallet_plus_tracked_protocol_positions`, reconciliation state `needs_protocol_position_marks`.
- Contradicted/Stale: public wallet JSON and public dashboard status disagree on wallet/protocol totals and observation times; implementation must not assume either stale public artifact alone is the truth.
- Verified: `data/capital-manager-refill-jobs-latest.json` observed at `2026-05-09T08:46:24.090Z`, covers 12 chains, has 7 jobs, and fundingSourcePlan sourceCount 0.

## Source Line References

- Verified: EV gate currently bypasses only safety critical intents, where `approve_exact` amount `0` is treated as safety critical (`src/executor/policy/ev-gate.mjs:205-210`, `:258-269`). Exact nonzero approvals currently still require expected net evidence (`:271-281`).
- Verified: EV gate policy is evaluated before consecutive failures in the policy index (`src/executor/policy/index.mjs:161-188`).
- Verified: consecutive failure classification separates broadcast failures from policy rejects/no-tx failures (`src/executor/policy/consecutive-failures.mjs:103-129`) and count logic skips policy/no-tx classifications (`:154-176`). A new counter store is not justified unless a fresh gap is found.
- Verified: consecutive failure metrics already expose `policyRejectedCount` and `noTxFailureCount` (`src/executor/policy/consecutive-failures.mjs:241-279`, `:323-340`). T2/T8 likely reclassify to provenance/reporting hardening, not a new counter store.
- Verified: protocol reader ownership is `src/protocol-readers/registry.mjs`, `dispatch.mjs`, and `bootstrap.mjs`; registry validates explicit ok/error envelopes and normalized positions (`src/protocol-readers/registry.mjs:38-70`), dispatch returns `reader`, `legacy`, or `none` without silent skip (`src/protocol-readers/dispatch.mjs:46-64`), bootstrap registers in-tree readers (`src/protocol-readers/bootstrap.mjs:13-21`).
- Verified: whole-wallet scan counts only fresh `protocol_reader` rows into protocolUsd and keeps legacy/stale protocol values separate as protocolStaleUsd (`src/treasury/whole-wallet-scan.mjs:452-469`).
- Verified: capital summary computes current total as wallet plus deployed protocol positions once (`src/status/capital-summary-slice.mjs:123-150`, `:203-251`).
- Verified: asset tracking blocks risk-ready status for wallet coverage, protocol position gaps, stale sources, missing metadata, and divergence (`src/status/asset-tracking-slice.mjs:116-285`).
- Verified: Merkl active positions aggregate event records for dashboard display (`src/status/merkl-active-slice.mjs:167-208`).
- Verified: Merkl exit currently records full close or zero-share reconciliation, but no explicit residual-share audit/report branch is visible in `executeReadyMerklPortfolioExits` (`src/executor/merkl-portfolio-exit.mjs:353-471`).

## Claim Labels

- Verified: Do not add reader slots to executor binding registry; reader owner is the protocol-reader registry/dispatch/bootstrap path.
- Verified: Do not change caps, payback ratio, `autoExecute`, kill-switch, dev-lock, signer policy bypass, or audit-log history.
- Verified: Current policy/no-tx consecutive-failure exclusion exists at HEAD; broad T2/T8 "needs counter store" is a `REVISE_TASK` candidate.
- Inferred: The current self-block pattern is likely EV-evidence plumbing/provenance around approval child intents rather than a missing consecutive-failure implementation.
- Inferred: Dashboard accounting needs a stricter published contract/provenance because generated public artifacts currently disagree.
- Unverified: Whether all live approval child intents carry enough parent EV evidence/hash/same strategy-chain-token-spender data. This must be proven with tests and code inspection.
- Unverified: Whether policy-time asset coverage blocks only opening/increasing exposure while allowing exit/unwind/redeem with warnings. This must be proven or patched.
- Unverified: Whether Merkl partial exit residual shares are recorded after executor settlement. This must be proven or patched.
- Contradicted: Treating any user-provided numeric counts or line references as current without HEAD verification.

## Initial REVISE_TASK Candidates

- T2/T8: If tests continue to confirm `policyRejected` and `noTxFailure` do not increment the active streak, do not implement a new counter store. Reclassify to reporting/provenance around audit rows and blocker summaries.
- T3/T4: Do not duplicate reader ownership in executor binding registry. Keep implementation in `src/protocol-readers/*` and caller envelopes.
- Any yoUSD-only patch: reject as stale/overfit unless generalized ERC4626 coverage with at least two fixtures and another chain is present.

## Post-Patch Implementation Evidence

- Verified: T1 implemented as a narrow exact-approval EV evidence bridge. Nonzero `approve_exact` is allowed only with parent intent, parent intent hash, parent EV evidence hash, `allow === true`, same strategy, same chain, same token, same spender, non-unlimited amount, and positive parent expected net above required net (`src/executor/policy/ev-gate.mjs:232-279`). `approve_max` is not included in the bypass path.
- Verified: T2/T8 stayed a `REVISE_TASK`/reporting classification. `node --test test/executor-consecutive-failures.test.mjs` passed and confirms no-tx/policy-only rejects are not active streak increments.
- Verified: T3/T4 did not add reader ownership to executor binding registry. Additional ERC4626 reader fixtures use `src/protocol-readers/readers/erc4626.mjs` through the protocol-reader path and include Base, Ethereum, positive, zero-share, and error-envelope cases.
- Verified: T5/T10/T11 dashboard accounting contract is now explicit: `currentTotalUsd = currentWalletUsd + protocolDeployedUsd` once, with separate inferred automation/protocol tracking gap fields and provenance enums (`src/status/capital-summary-slice.mjs:3-23`, `:168-230`, `:241-280`). Public dashboard adapter carries `assetClaimLabel` and no longer marks fallback/no-data assets as high-confidence verified current.
- Verified: T9 Merkl partial exit residuals append a separate `position_exit_residual_detected` open record with `autoRedeemAttempted: false`; executor status becomes `position_closed_with_residual` without attempting a second redeem (`src/executor/merkl-portfolio-exit.mjs:367-395`, `:460-481`).
- Verified: T12/T13 policy-time asset coverage guard blocks opening/increasing exposure on unknown/coverage-gap assets while allowing exit/unwind/redeem with warnings (`src/executor/policy/asset-coverage-guard.mjs:14-44`, `:90-116`; wired in `src/executor/policy/index.mjs:1-3`, `:162-190`).
- Verified: Stale or unverified dev-lane work orders become `REVISE_TASK` with lifecycle `revise_task`, evidence labels, and current-HEAD recheck instructions before implementation (`src/strategy/dev-agent-automation-bridge.mjs:30-38`, `:73-120`, `:152-210`).

## Post-Patch Verification

- Verified: Targeted tests passed: `node --test test/executor-ev-gate.test.mjs test/executor-consecutive-failures.test.mjs test/executor-policy-index.test.mjs test/merkl-portfolio-exit.test.mjs test/dev-agent-automation-bridge.test.mjs test/protocol-readers.test.mjs test/protocol-readers-bootstrap.test.mjs test/protocol-position-erc4626-adapter.test.mjs test/erc4626-protocol-canary.test.mjs test/treasury-holdings-slice.test.mjs test/asset-tracking-slice.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-app.test.mjs` -> 170 pass.
- Verified: `npm run check` passed and `dashboardPublic=ok refs=6`.
- Verified: `npm test` passed with 3005 pass, 0 fail, 1 skipped.
- Verified: `npm run dashboard:build` passed with `dashboardBuild=ok outputs=5 changed=1`.
- Verified: `npm run status:dashboard:light` regenerated dashboard status and returned `liveTrading=ALLOWED`, runtime/watchdog healthy, payback carry below minimum, and all-chain autopilot `completed_with_blockers` due to `max_consecutive_failures_reached`.
- Verified: `npm run ops:full-automation-readiness:json` returned `status=attention_required`, `ready=false`, blockers `capital_rebalancer_not_ready` and `refill_routes_unresolved`; live automation refill blockers are execution-unresolved `max_consecutive_failures_reached` routes. This is policy/readiness no-tx evidence, not a bypass target.
- Verified: `npm run risk:auto-kill-check:json` returned `triggered=false`, `killSwitchActive=false`, and did not write the kill-switch.
- Verified: `git diff --check` passed.
