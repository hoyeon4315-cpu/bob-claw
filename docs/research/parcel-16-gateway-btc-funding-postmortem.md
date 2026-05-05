# Parcel 16 gateway BTC funding transfer postmortem

## Scope

- Strategy: `gateway-btc-funding-transfer`
- Auto-kill trigger: `failure_burst_per_strategy`
- Trigger timestamp: `2026-05-04T18:16:45.378Z`
- Trigger window requested: `2026-05-04T18:11:45Z` through
  `2026-05-04T18:16:45Z`
- Trigger payload: 6 failures in 300000 ms, threshold 5

## Findings

The trigger window contains 6 `gateway-btc-funding-transfer` audit rows. All 6
were policy rejects before broadcast. None contain broadcast evidence, realized
gas loss, signer error, RPC error, gas-estimation error, approval error, or
inventory-debit evidence.

| Timestamp | Chain | Amount USD | Route | Policy blocker | Root-cause class |
| --- | --- | ---: | --- | --- | --- |
| `2026-05-04T18:12:05.143Z` | base | 8.018704 | base wBTC.OFT -> bsc wBTC.OFT | `strategy_per_chain_cap_exceeded` | policy cap reject |
| `2026-05-04T18:12:40.449Z` | base | 27.802657 | base wBTC.OFT -> ethereum WBTC | `strategy_per_chain_cap_exceeded` | policy cap reject |
| `2026-05-04T18:13:19.008Z` | base | 64.992270 | base wBTC.OFT -> ethereum WBTC | `strategy_per_chain_cap_exceeded` | policy cap reject |
| `2026-05-04T18:14:15.085Z` | base | 8.016021 | base wBTC.OFT -> soneium wBTC.OFT | `strategy_per_chain_cap_exceeded` | policy cap reject |
| `2026-05-04T18:14:51.963Z` | base | 8.037966 | base wBTC.OFT -> sonic wBTC.OFT | `strategy_per_chain_cap_exceeded` | policy cap reject |
| `2026-05-04T18:15:22.763Z` | base | 7.232338 | base wBTC.OFT -> unichain wBTC.OFT | `strategy_per_chain_cap_exceeded` | policy cap reject |

The full 5-minute audit window contains 11 rows:

- 6 `gateway-btc-funding-transfer` rows with
  `strategy_per_chain_cap_exceeded`.
- 5 unrelated strategy rows with `max_consecutive_failures_reached`.
- 0 broadcast rows.
- 0 `policyVerdict=errored` rows.

## Root Cause

This was not an RPC failure, inventory failure, gas-estimate revert, approval
failure, or on-chain broadcast failure.

The operational halt was caused by the old auto-kill failure-burst classifier
counting no-transaction policy rejects as strategy failures. In this window,
ordinary cap-policy rejects for `gateway-btc-funding-transfer` accumulated fast
enough to trip `failure_burst_per_strategy`.

The behavior has already been structurally corrected by commit
`3c3d3863 fix(risk): ignore no-tx policy rejects in failure burst`, which routes
auto-kill failure-burst classification through
`classifyConsecutiveFailureRecord()` in
`src/executor/policy/consecutive-failures.mjs`. Under the current classifier:

- no-broadcast policy rejects classify as `policyRejected`;
- `policyRejected` rows do not count toward `failure_burst`;
- only `broadcastFailed` and `noTxFailure` rows count.

The current test suite includes the relevant guard in
`test/auto-kill-triggers.test.mjs`: no-transaction policy rejects with
substantive blockers such as `strategy_per_chain_cap_exceeded` are ignored by
failure-burst evaluation.

## Inventory Preflight Decision

No inventory preflight mitigation is proposed in this parcel because inventory
was not the cause of the halt. The six rows were blocked by committed cap policy
before signing, and there is no evidence of an attempted debit or insufficient
source balance in the trigger window.

## Resume Implication

The kill-switch remains correctly armed until the operator explicitly resumes
it. The stale arm is operationally reviewable because current replay no longer
fires the same trigger, but a coding agent must not clear it without an explicit
operator resume command and audit reason.
