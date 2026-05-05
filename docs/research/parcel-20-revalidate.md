# Parcel 20 re-validate dry-run

## Scope

- Re-run `npm run autopilot:all-chains -- --dry-run-first` after Parcels
  16-19 (postmortem, RPC ordering, payback patch surface, resume-review CLI)
  landed.
- Confirm that the autopilot remains correctly blocked while the
  kill-switch is still operator-armed.
- Confirm that no `gateway-btc-funding-transfer` intent is emitted, since
  the trigger that armed the kill-switch traced back to that strategy.
- Do **not** clear the kill-switch. AGENTS.md and the previous postmortem
  (`docs/research/parcel-16-gateway-btc-funding-postmortem.md`) require an
  explicit operator resume request with `--reason` before any toggle.

## Run inputs

- Branch / HEAD: `main`, ahead of `origin/main` by the Parcel 17 / 18
  commits (see `git log`).
- Test suite: `npm test` reports 2666 tests (2665 pass, 1 skip, 0 fail).
- Kill-switch state at run start: HALTED.
  - `activeReason`: `auto_kill:failure_burst_per_strategy`.
  - `activeSince`: `2026-05-04T18:16:45.378Z`.
- Command:
  `npm run autopilot:all-chains -- --dry-run-first --json --timeout-ms=120000 --canary-timeout-ms=120000 --dispatch-timeout-ms=120000`

## Run outcome

- `phase`: `completed`.
- `mode`: `preview`.
- `status`: `completed_with_blockers`.
- `blockedReason` (top-level): `null` (each blocker is reported per step).
- 11 official Gateway destination chains evaluated.

### Step-level results that matter

| Step | Outcome | Detail |
| --- | --- | --- |
| `auto_kill_check` | `triggered: false`, `alreadyArmed: true`, `killSwitchActive: true` | Replay confirms no live trigger fires now; the operator-armed stale arm is what holds the halt. |
| `treasury_refill_plan` + `capital_manager_refill_plan` | 25 jobs identified (15 treasury + 10 capital manager) | `refillAttemptedCount: 0`, `refillExecutedCount: 0`. Plans surfaced; nothing executed. |
| `live_canary_sweep` | `exitCode: 1`, `blockedReason: live_baseline_blocked`, `status: blocked` | Live baseline is BLOCKED with `currentStageId: tiny_live_canary_review` and zero refresh / operator / technical / objective evidence; the 3 required refresh inputs are missing. |
| `merkl_portfolio_orchestrator` | `exitCode: 1`, `blockedReason: no_portfolio_entry_ready` | Capital allocator declines to open a new Merkl entry. |
| `auto_kill_dashboard_slice` | `triggered: false`, `alreadyArmed: true` | Dashboard slice updated with the same replay state. |

### Strategy intents

- No `gateway-btc-funding-transfer` intent was emitted.
- No live signer broadcast was attempted.
- The live canary preflight blocked **before** any per-strategy intent
  generation, so the strategy-specific cap-policy chain was not exercised
  in this run. The 1460 historic `max_consecutive_failures_reached`
  rejections in `logs/signer-audit.jsonl` are pre-Parcel-9 residue and
  are unrelated to this dry-run.

## Decision

- The dry-run reproduces the expected blocked state: live trading remains
  closed, no broadcasts are attempted, and the kill-switch stale arm
  alone is sufficient to keep the live lane shut. This matches the
  Parcel 14 postmortem evidence and the Parcel 16 root-cause analysis.
- Live flipping is **not** attempted in this parcel. AGENTS.md requires an
  explicit operator resume request with `--reason` before any toggle, and
  no such request has been issued.
- The smallest live canary on the strongest-evidence strategy is gated
  behind: (a) operator resume of the kill-switch, (b) non-zero refresh /
  operator / technical / objective evidence in the live baseline slice,
  and (c) a Stage A → Stage B refresh-success-ratio recovery. None of
  those conditions are satisfied right now.

## Operator action required for next attempt

1. Read `docs/research/parcel-16-gateway-btc-funding-postmortem.md` and
   confirm the trigger no longer applies under the current classifier.
2. Run `npm run kill:resume-review` to assemble the
   `resume_review_packet` audit row with the latest replay evidence.
3. Issue `npm run kill:off -- --reason=<operator reason>` only after
   review. The coding agent must not skip step 2.
4. Re-run `npm run autopilot:all-chains -- --dry-run-first` and confirm
   `live_baseline.status` and the staged readiness evidence before any
   `--execute` invocation.

## Next coding-agent action if anything trips

If a future dry-run shows `auto_kill_check.triggered: true`, halt the
loop, append a per-trigger postmortem under `docs/research/`, and do not
clear the kill-switch. Use `npm run kill:status:json` to capture the
exact arming reason and feed it into the new postmortem.

## 2026-05-05 operator-approved resume and live canary attempt

### Operator approval

- The operator approved moving to execution after reviewing the staged
  blockers.
- The kill-switch was resumed with:
  `npm run kill:off -- --reason="parcel-16-mitigated"`.
- Audit row:
  - `ts`: `2026-05-05T07:14:59.961Z`
  - `action`: `resume`
  - `reason`: `parcel-16-mitigated`
  - `previousState`: `halted`

### Post-resume dry run

- Command:
  `npm run autopilot:all-chains -- --profile=aggressive_v1 --dry-run-first`
- CLI behavior note: without `--execute`, this command runs preview mode.
- Outcome:
  - `mode`: `preview`
  - `status`: `completed_with_blockers`
  - `executionGate`: `preview_only`
  - `refillExecutedCount`: `0`
  - `strategyDispatch.liveEligibleCount`: `0`
  - `payback`: `carry`, `pendingCarrySats: 601`
- No signer audit rows were appended by the all-chain dry run after
  the resume timestamp.
- No `gateway-btc-funding-transfer` signer attempt was emitted after
  the resume timestamp.

### Smallest eligible canary selected

- Preview command:
  `npm run executor:merkl-canary-autopilot -- --json --max-candidates=1 --max-usd=5 --timeout-ms=120000`
- Preview status: `preview_ready`.
- Selected canary:
  - `strategyId`: `gateway_native_asset_conversion_sleeve`
  - `opportunityId`: `13747891056392346282`
  - `chain`: `base`
  - `protocolId`: `yo`
  - `bindingKind`: `erc4626_vault_supply_withdraw`
  - `amountUsd`: `5`
  - `asset`: Base USDC
  - `plan steps`: `approve_asset_to_vault`, `deposit_asset_to_vault`
- Preconditions observed by the canary preview:
  - kill-switch preflight ready
  - inventory ready: Base USDC and native ETH present
  - auto-entry ready
  - sizing ready with `capUsd: 5`

### Live attempt outcome

- Execute command:
  `npm run executor:merkl-canary-autopilot -- --json --write --execute --max-candidates=1 --max-usd=5 --timeout-ms=180000`
- Result:
  - `mode`: `execute`
  - `status`: `blocked`
  - `blockedReason`: `max_consecutive_failures_reached`
  - `settlementStatus`: `signer_rejected`
  - first step: `approve_asset_to_vault`
  - signer policy decision: `BLOCK`
  - signer policy blockers: `["max_consecutive_failures_reached"]`
- Consecutive-failure policy metrics:
  - `maxConsecutiveFailures`: `3`
  - `consecutiveFailures`: `3`
  - `terminalRecordCount`: `111`
  - `lastTerminalStatus`: `failure`
  - `latestFailureAt`: `2026-05-02T09:35:18.475Z`
  - `resumeAfter`: `2026-05-01T22:54:52.000Z`
- Kill-switch policy inside the signer evaluation was `ALLOW`; the
  block came from the consecutive-failure policy only.
- Broadcast count after the operator resume: `0`.
- Signer audit rows after the operator resume:
  - one rejected row for `gateway_native_asset_conversion_sleeve`
  - no broadcast row
  - no receipt reconciliation row
  - no payback accumulator delta

### Safety action taken

- Per Parcel 20 instruction, the agent did not bypass the signer policy
  flag.
- The kill-switch was immediately re-armed with:
  `npm run kill:on -- --reason="parcel-20-live-canary-blocked-max-consecutive-failures"`.
- Audit row:
  - `ts`: `2026-05-05T07:24:26.567Z`
  - `action`: `halt`
  - `reason`: `parcel-20-live-canary-blocked-max-consecutive-failures`
  - `previousState`: `running`

### Decision

The first live canary attempt did not reach broadcast. The system behaved
correctly: policy rejected the intent before signing because
`gateway_native_asset_conversion_sleeve` still has a true
`max_consecutive_failures_reached` state. This is a different strategy
from the Parcel 16 gateway funding trigger and must not be reset
automatically.

### Next required work

1. Investigate the `gateway_native_asset_conversion_sleeve` consecutive
   failure state, especially the terminal failures ending at
   `2026-05-02T09:35:18.475Z`.
2. Classify those failures with the corrected broadcast/no-tx classifier.
3. Only if the failures are confirmed to be stale no-broadcast artifacts,
   use the existing audited reset CLI with a new explicit reason.
4. If the failures are true broadcast failures, keep the strategy paused
   and fix the underlying execution issue before any new live attempt.
5. Do not clear the kill-switch again until that investigation is
   complete and the operator explicitly resumes it.
