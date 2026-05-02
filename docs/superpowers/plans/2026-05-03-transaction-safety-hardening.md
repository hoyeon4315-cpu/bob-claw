# Transaction Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audited unattended-execution gaps without changing strategy caps, live sizing, or economic thresholds.

**Architecture:** Add deterministic signer-side backstops at the last point before transaction broadcast and at EVM transaction request construction. Keep policy pure, keep signer keys isolated, and improve health reporting by reading the runtime snapshot the live dashboard runner actually writes.

**Tech Stack:** Node.js ESM, `node:test`, ethers v6, existing signer/policy/report modules.

---

### Task 1: Kill-Switch Hard Stop

**Files:**
- Modify: `src/executor/policy/kill-switch.mjs`
- Modify: `src/executor/signer/daemon.mjs`
- Test: `test/executor-kill-switch.test.mjs`
- Test: `test/executor-signer-daemon.test.mjs`

- [x] Add RED tests proving the default kill-switch path resolves to `~/.bob-claw/KILL_SWITCH` when env is unset.
- [x] Add RED tests proving `handleIntentCommand()` checks the kill-switch again after signing and before broadcast.
- [x] Implement default path resolution with env override preserved.
- [x] Implement pre-broadcast kill-switch recheck that writes a rejected audit record and returns `status:"rejected"` without calling `broadcastSignedIntent`.
- [x] Run `node --test test/executor-kill-switch.test.mjs test/executor-signer-daemon.test.mjs`.

### Task 2: EVM Transaction Semantic Guard

**Files:**
- Modify: `src/executor/signer/evm-local-signer.mjs`
- Test: `test/evm-local-signer.test.mjs`

- [x] Add RED tests proving an EVM intent with `tx.to` different from `metadata.expectedTxTo`, `quote.txTo`, or `approval.token` is rejected before nonce reservation.
- [x] Add RED tests proving approval calldata must target `approval.token`, encode `approve(spender, amount)`, and match `approval.spender` and `approval.amount`.
- [x] Implement narrow signer-side validation that accepts existing non-approval executable txs when the expected target is explicit, and rejects mismatched or missing critical tx fields.
- [x] Run `node --test test/evm-local-signer.test.mjs`.

### Task 3: Automation Health Runtime Snapshot

**Files:**
- Modify: `src/system/automation-health-report.mjs`
- Test: `test/automation-health-report.test.mjs`

- [x] Add RED test proving automation health prefers `data/dashboard-live-runtime.json` when present and keeps `dashboard/public/live-runtime.json` as fallback.
- [x] Implement source loading or summary selection so live dashboard health does not report stale disabled state while the live runner is active.
- [x] Run `node --test test/automation-health-report.test.mjs`.

### Task 4: Verification And Integration

**Files:**
- No extra source files unless a task above exposes a required local helper.

- [x] Run focused safety tests:
  `node --test test/executor-kill-switch.test.mjs test/executor-signer-daemon.test.mjs test/evm-local-signer.test.mjs test/automation-health-report.test.mjs`
- [x] Run policy/signer regression tests:
  `node --test test/gateway-availability.test.mjs test/executor-policy-index.test.mjs test/executor-cap-check.test.mjs test/executor-signer-client.test.mjs test/btc-local-signer.test.mjs`
- [x] Run full verification:
  `npm run check`
  `npm test`
- [x] Stage only the files changed for this hardening work.
- [ ] Commit, push the current branch, then merge only if verification is green and git state permits a non-destructive merge.
