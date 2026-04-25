# Known Test Failures

Updated: 2026-04-22

## 1. wrapped-btc-loop-live.test.mjs — "auto-builds Moonwell and Odos steps when bindings stay empty"

Status: **pre-existing, unrelated to W4–W7 changes**

### Symptom
```
Error: Iteration 2 still lacks repay inventory after collateral swap:
need 150670000, planned 133510000
```

### Root cause
`buildAutoWrappedBtcLoopScenarioBinding` at
`src/executor/strategies/wrapped-btc-loop-auto-build.mjs:672`
iterates collateral→borrow swaps until enough borrow inventory is
available for repayment.  Mock `odosClient` returns fixed output:
- USDC (0x833589...): `100000000`
- other token: `1332`

Iteration 2 needs ~150.6M units but mock only yields ~133.5M after
collateral swap.  The auto-build logic is correct; the test fixture
under-provisions the swap output.

### When introduced
Unknown (pre-existing before cap neutralization and W4–W7).

### How to verify it is pre-existing
```bash
git stash && node --test test/wrapped-btc-loop-live.test.mjs
```
Still fails on clean HEAD.

### Fix path
Either:
a) Update mock `odosClient.quote` in test to return a larger
`outAmounts` value for the non-USDC token path, or
b) Adjust `marketAssumptionsOverride` in the test to lower the
repay requirement.

No production code change needed.

---

## 2. v1-infra-drills.test.mjs — "per_tx_cap_exceeded" (FIXED)

Status: **fixed** by commit `840ca27`

### Symptom
`per_tx_cap_exceeded` drill expected `strategy_per_tx_cap_exceeded`
blocker but got `ALLOW`.

### Root cause
Cap neutralization changed `wrapped-btc-loop-base-moonwell`
`perTxUsd` from `25` → `1_000_000`.  Drill intent amount was `1_000`,
no longer exceeding the cap.

### Fix
Bumped drill `amountUsd` and `capCheckAmountUsd` to `2_000_000`.
