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

### Follow-up: daemon reload and second attempt

Investigation of the `gateway_native_asset_conversion_sleeve` blocker
showed that the current repository code and audit log classified the Base
scope correctly after the reset row:

- `consecutiveFailures`: `0`
- `lastResetAt`: `2026-05-04T17:49:29.589Z`
- `broadcastFailureCount`: `0`
- latest post-reset rejection: no-broadcast policy rejection, therefore
  not counted by the corrected classifier

The signer daemon process was still the long-running process started on
`2026-05-02T20:15:54` and had not reloaded the parcel code. The daemon and
watchdog were restarted through launchd while the kill-switch remained
armed. New daemon pid: `39707`; new watchdog pid: `39796`.

After an operator-approved resume:

- Resume-review packet was appended at `2026-05-05T07:39:04.996Z`.
- Kill-switch resume command:
  `npm run kill:off -- --reason="parcel-20-daemon-reloaded-after-counter-reset"`.
- Fresh auto-kill replay:
  `triggered=false`, `killSwitchWritten=false`, `alreadyArmed=false`.
- `npm run autopilot:all-chains -- --profile=aggressive_v1 --dry-run-first`
  completed in preview mode with live steps blocked only by `preview_only`.

The next live Merkl canary attempt did not reach signer broadcast. It was
blocked earlier by deterministic opportunity policy:

- Execute command:
  `npm run executor:merkl-canary-autopilot -- --json --write --execute --max-candidates=1 --max-usd=5 --timeout-ms=180000`
- Result:
  - `status`: `blocked`
  - `blockedReason`: `same_chain_unprofitable:need_$18_on_optimism`
  - selected chain: `optimism`
  - selected protocol: `morpho`
  - selected amountUsd: `4.09698`
  - plan: `null`
  - execution: `null`

Per Parcel 20, the agent did not bypass the policy flag. The kill-switch
was immediately re-armed with:

`npm run kill:on -- --reason="parcel-20-live-canary-blocked-opportunity-policy-unprofitable"`

Audit row:

- `ts`: `2026-05-05T07:47:46.243Z`
- `action`: `halt`
- `reason`: `parcel-20-live-canary-blocked-opportunity-policy-unprofitable`
- `previousState`: `running`

### Decision

No live broadcast occurred in either attempt. The first block was caused
by a stale signer daemon process that had not reloaded the corrected
counter classifier. The second block was a valid opportunity-policy
rejection: the selected Optimism canary was too small to clear the
same-chain profitability floor. The selector should avoid advancing an
execute candidate that fails deterministic opportunity policy when another
ready candidate may exist.

### Next required work

1. Keep the kill-switch armed until the selector/preflight behavior is
   corrected and reviewed.
2. Update Merkl canary candidate selection so execute mode chooses the
   first candidate that passes opportunity policy, or reports all
   policy-failing candidates as deterministic deferrals.
3. Add a regression fixture where an Optimism candidate is inventory-ready
   but unprofitable and a Base candidate is policy-pass; execution should
   select Base.
4. Re-run dry-run-first, then retry the smallest policy-pass live canary
   only after operator resume.

### Follow-up: Merkl selector fix

The Merkl execute selector now scans beyond the requested live execution
count, applies deterministic opportunity policy before plan construction,
and defers policy-failing candidates instead of selecting them as the sole
execute candidate. Regression coverage:

- Optimism candidate: inventory-ready but blocked by
  `same_chain_unprofitable:need_$18_on_optimism`
- Base candidate: lower priority but policy-pass
- Expected selection: Base selected, Optimism emitted as deterministic
  deferral

Current live data after the fix has no Merkl policy-pass candidate:

- ready Merkl candidates: `1`
- only ready candidate: Optimism Morpho opportunity
  `17563083078147412604`, amountUsd `4.09698`
- deterministic deferral:
  `same_chain_unprofitable:need_$18_on_optimism`

Therefore the next live-canary route must come from another policy-ready
surface, such as destination representative execution, or wait for a new
Merkl inventory/campaign state.

### Follow-up: destination representative live attempt

Because Merkl had no policy-pass candidate, the next policy-ready surface
was destination representative execution.

Preview:

- Command:
  `node src/cli/run-destination-representative-autopilot.mjs --json --write --timeout-ms=180000`
- Result: `preview_ready`
- Selected template: `soneium:stablecoin_lending_carry`
- Chain/protocol: Soneium / Aave v3
- Amount: `2999768` raw USDC, approximately `$2.999768`
- Planned steps: `approve_asset_to_pool`, `supply_asset_to_pool`

Execution:

- Command:
  `node src/cli/run-destination-representative-autopilot.mjs --json --write --execute --timeout-ms=240000`
- Result: `blocked`
- Blocker: `destination_representative_execution_error`
- The approve step broadcast and confirmed:
  - txHash: `0x47309a61fa104bf4a0be121643864bdebcf0a23545c37c42c36b5a1ca08cfe56`
  - block: `22416394`
- The supply step broadcast and reverted:
  - txHash: `0xac8b0635ff3829c76dd6a22e463c2eb418a60a790a706c4302e074789e8f0818`
  - block: `22416399`
  - receipt status: `0`
  - revert message from replay call: `execution reverted`
  - revert data: `0x6d305815`

At the same resume window, a background `run-all-chain-autopilot --loop
--write --execute` launchd job also fired a refill transfer:

- strategy: `gateway-btc-funding-transfer`
- txHash: `0x0693053f48d6e5c3d0630d1352a8ef74a29fc11d5e7163dee0a132ac2e386786`
- block: `45589094`
- receipt status: `1`

Safety actions:

- Kill-switch was re-armed immediately after the destination representative
  revert:
  `parcel-20-destination-representative-reverted-after-broadcast`.
- The live all-chain autopilot launchd job was unloaded so a later
  kill-switch resume does not automatically restart the loop:
  `com.bobclaw.all-chain-autopilot` is `configured_not_loaded`.
- The reverted supply left an exact USDC allowance on Soneium. A protective
  revocation was executed:
  - reason: `parcel-20-revoke-stale-soneium-allowance`
  - txHash: `0x2bc6ca231cbab0300bac77ba27cc2864dd19fcf85bd6111e9d1cf0cd52d98ebf`
  - block: `22416469`
  - receipt status: `1`
  - post-check allowance: `0`
- Kill-switch was re-armed after revocation:
  `parcel-20-post-revoke-hold-for-revert-review`.

### Follow-up: Aave supply preflight patch

The Soneium Aave helper estimated supply gas after approval, but if the
estimate failed it fell back to a default gas limit and still broadcast the
supply. That transformed a preflight failure into a live revert.

The helper now treats supply gas-estimate failure as a hard pre-broadcast
blocker. If approval has already been sent, it automatically broadcasts an
exact zero-allowance revocation before throwing `AaveSupplyPreflightFailed`.
Regression coverage asserts the sequence:

1. approve exact allowance
2. supply preflight fails
3. revoke allowance
4. do not broadcast supply

### Follow-up: Soneium Aave reserve root cause

The Soneium binding addresses were internally consistent:

- Pool address provider `getPool()` resolved to
  `0xDd3d7A7d03D9fD9ef45f3E587287922eF65CA38B`.
- The configured aToken reported the same pool and the configured underlying
  USDC.e asset.
- The operator allowance was successfully revoked back to `0`.

The reserve itself was not supplyable. A live `eth_call` to
`Pool.getConfiguration(USDC.e)` showed:

- `active=true`
- `frozen=true`
- `paused=false`
- `supplyCapWholeTokens=8000000`

Root cause classification: Aave reserve frozen. The previous representative
candidate readiness check treated a verified binding plus inventory and gas as
ready, but did not inspect the current Aave reserve configuration before
approval/supply planning.

Mitigation:

- `buildAaveProtocolCanaryPlan()` now verifies the configured pool against
  the addresses provider, then reads `getConfiguration(asset)` and
  `getReserveData(asset)` before gas estimation or approval planning.
- Reserves with `active=false`, `frozen=true`, or `paused=true` throw
  `AaveReservePreflightFailed` with blocker
  `aave_reserve_not_supplyable:<reason>`.
- A reserve whose returned aToken does not match the binding also blocks with
  `aave_reserve_not_supplyable:a_token_mismatch`.
- `runDestinationRepresentativeAutopilot()` now records plan-preflight
  failures as blocked reports instead of letting the CLI crash before writing
  the report.
- A live read of the Soneium binding now blocks before `estimateGas` with
  `aave_reserve_not_supplyable:frozen`.
