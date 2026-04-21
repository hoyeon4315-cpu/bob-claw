# Session Handoff - 2026-04-12

## Purpose

This note is the safest starting point for the next session.

Use it together with `docs/current-status.md`, but prefer this file for judgment and prioritization because it includes the latest local hardening work and an explicit anti-overfit check.

## Current Objective View

- Live trading remains `BLOCKED`.
- Active canary remains `bob->base wBTC.OFT->wBTC.OFT`.
- Active canary verdict remains `reject_no_net_edge`.
- Overfit time gates still block live expansion.
- The highest-value work right now is not live execution.
- The highest-value work right now is:
  - widen shadow candidate coverage
  - harden data and scoring assumptions
  - accumulate shadow evidence across time and route diversity

## What Was Confirmed This Session

- The local hardening track for four known issues was completed.
- `npm test` passes locally with `212` tests.
- `npm run check` passes locally.
- The local worktree is now dirty again because of this hardening work and has not been committed yet.

## Hardening Changes Landed Locally

### 1. `solvBTC` metadata was wrong and is now corrected locally

The previous `SOLVBTC_TOKEN` constant pointed to Base `oUSDT`, not Base `SolvBTC`.

Local code now points to:

- token: `0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f`
- ticker: `solvBTC`
- decimals: `18`

Evidence used in this session:

- Base RPC `decimals()` for `0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f` returned `0x12` => `18`
- BaseScan labels that address as `Solv BTC (SolvBTC)`
- Base RPC `decimals()` for the previous address `0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189` returned `0x06` => `6`
- BaseScan labels that previous address as `OpenUSDT (oUSDT)`

Interpretation:

- Prior `solvBTC` assumptions were not reliable.
- Token registry facts must be treated as verification targets, not memory targets.

### 2. `stableSerialize(undefined)` is now deterministic

- `src/execution/journal.mjs` now preserves `undefined` as a sentinel string instead of silently collapsing it through JSON behavior.
- Regression tests were added.

Interpretation:

- This reduces hash or event-id ambiguity when optional fields are present but unset.

### 3. Quote-decay selective scoring args were hardened

- Quote-decay rescoring now uses a helper that stays selective only when both `routeKey` and `amount` are present.
- Otherwise it falls back to a safe broader `--write --shadow-rollover-ms=0`.

Interpretation:

- This reduces accidental partial-scoring assumptions in watcher flows.

### 4. Treasury action output now guards non-finite values

- `src/cli/plan-treasury-actions.mjs` now formats non-finite numbers as `n/a`.
- Direct-run guarding was also added so tests can import helpers safely.

Interpretation:

- This prevents CLI output from misleading the operator with `Infinity`, `NaN`, or brittle formatting.

## Operational Interpretation

The operating interpretation still has not changed:

- `liveTrading=BLOCKED`
- current canary is negative after known costs
- overfit blockers remain `shadow time window` and `time bucket diversity`
- the route universe is worth continuing in shadow mode
- the route universe is not yet justified for live expansion

Important distinction:

- We should run multiple shadow candidates.
- We should not run multiple active canaries.
- The right structure is `one active canary + many shadow candidates`.

## What Not To Over-Interpret

### 1. Do not over-trust the big positive measured leader

`ethereum->base WBTC->wBTC.OFT` currently looks strong in some summaries, but it is still not a valid execution candidate because it still needs:

- wallet readiness
- exact gas freshness
- allowance and funding readiness
- fresh executable DEX confirmation
- full prep viability

Interpretation:

- A large positive measured value here is still a hypothesis, not a trading permission.

### 2. Do not mistake broader strategy search for execution readiness

We do want to search:

- Gateway routes
- wrapped-BTC transfer routes
- stable-entry / stable-exit loops
- BTC proxy spreads
- DEX-assisted loops

But search coverage is not the same as execution readiness.

Interpretation:

- A wider shadow roster is required.
- Strategy expansion is allowed in shadow mode.
- Live expansion is still blocked.

### 3. Do not overfit to one fresh sample

Even a fresh positive route should still be treated as weak evidence if it lacks:

- amount ladder coverage
- repeat observations
- multiple hourly buckets
- quote-decay survival
- failure-rate context

Interpretation:

- The system should prefer repeated, durable, executable edge over a single attractive reading.

## Self-Overfit Check For Codex

These are the main ways the assistant could overfit the current situation:

- Mistaking a measured positive route for an executable route
- Treating “multiple strategies in shadow” as permission for multiple live candidates
- Confusing underobserved universes with disproven universes
- Extrapolating too much from stale or thin DEX coverage
- Trusting remembered token metadata without on-chain verification
- Sliding from objective route-profit research into directional BTC accumulation logic

Current self-check result:

- No evidence that live urgency is justified
- No evidence that the current negative canary should be forced forward
- No evidence that the wrapped-BTC thesis is dead in every universe
- Strong evidence that the currently measurable and prep-viable active canary is still not good enough

Net conclusion:

- Continue broader shadow research
- Keep live blocked
- Keep economic objectivity above narrative momentum

## Recommended Next Plan

### Priority 1. Commit the local hardening work

Before the next research pass:

- review the local diff
- commit the hardening changes
- keep the commit message focused on metadata and watcher/CLI hardening

### Priority 2. Expand the multi-shadow roster

Do this next:

- keep the active canary as the baseline
- expand shadow focus routes for:
  - `base->avalanche wBTC.OFT->wBTC.OFT`
  - `base->sonic wBTC.OFT->wBTC.OFT`
  - `base->unichain wBTC.OFT->wBTC.OFT`
  - `ethereum->base WBTC->wBTC.OFT`
- continue `btc proxy spread` accumulation by amount ladder
- keep stable-entry and stable-exit loops in scope, not just wrapped-BTC transfer legs

Success condition:

- each candidate has route-specific sample count, success rate, latency, fees, and rejection reasons

### Priority 3. Add replay and shadow failure-case tests

Do this before adding more execution ambition:

- add tests for false-positive positive routes
- add tests for stale or mixed-input scorer behavior
- add tests for route-specific selective refresh behavior
- add tests for missing or thin DEX leg coverage

Success condition:

- a route cannot become “interesting” because of missing, stale, or mismatched inputs

### Priority 4. Accumulate objective shadow evidence

Continue collecting:

- shadow horizon toward `168h`
- hour buckets toward `24`
- quote-decay coverage for required windows
- amount ladder coverage for candidate routes
- route-level failure-rate evidence

Success condition:

- the next session can compare candidates by durable evidence, not intuition

## Recommended Next Session Starting Order

1. Read `docs/session-handoff-2026-04-12.md`
2. Read `docs/current-status.md`
3. Inspect `git status`
4. Review the uncommitted hardening diff
5. Commit the current hardening changes
6. Start multi-shadow candidate expansion and replay-test expansion

## Known Good Reference Points

- Branch with prior deployed work: `codex/treasury-risk-pipeline`
- Prior pushed commits:
  - `3b70f5f` `Add canary review telemetry and dashboard ETA`
  - `1fd7c12` `Refresh deployed dashboard status snapshot`
- Prior deployed dashboard URL:
  - `https://bob-claw-dashboard.pages.dev`

## Local Files Changed In This Session

- `src/assets/tokens.mjs`
- `src/execution/journal.mjs`
- `src/watch/canary-readiness-watch.mjs`
- `src/cli/watch-canary-readiness.mjs`
- `src/cli/plan-treasury-actions.mjs`
- `test/dex-route-universe.test.mjs`
- `test/btc-proxy-spreads.test.mjs`
- `test/execution-journal.test.mjs`
- `test/canary-readiness-watch.test.mjs`
- `test/plan-treasury-actions.test.mjs`

## Final Decision For The Next Session

Do not push toward live.

Do not collapse back to a single-route mindset.

Use the current canary as a baseline, but spend the next session on:

- hardening completion
- broader shadow candidate coverage
- stable and DEX-assisted loop evidence
- anti-overfit evidence accumulation
