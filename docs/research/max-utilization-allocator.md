# Max-utilization Merkl allocator

Date: 2026-05-07

This note documents the Stage 3 allocator change. `AGENTS.md` remains operating law.

## Rationale

The allocator was not mainly blocked by lack of chains. The corrected blocker pattern was:

- Proof gate: many hold candidates were stopped by `live_canary_proof_required_before_hold`.
- Chain tilt: `chain_target_exceeded` is already owned by `src/executor/capital/scored-target-balances.mjs`.
- Inventory routing: capital jobs are next-tick annotations, not same-tick entry funding.

The implemented change keeps those boundaries and makes the planner more useful:

- Hold entries now carry BTC-first economics: `expectedNetSats`, `expectedNetUsd`, `btcPriceSnapshotAt`, hold-window source, cost components, bridge cost, and reward haircut.
- Otherwise-ready hold entries are blocked if BTC price is missing, because a sats-first system must not admit USD-only EV.
- Proof-missing hold candidates can surface a ladder-bound graduation canary request through `src/executor/canary/proof-graduation-bridge.mjs`.
- Graduation canary requests must also pass the same tiny-canary EV floor used by the Merkl canary autopilot. If current inventory is below the computed profitable minimum, the allocator records the blocker and emits no request.
- Proof-missing candidates no longer emit capital refill jobs first. The proof loop comes before hold-capital routing.
- `all-chain-autopilot` and the Merkl portfolio orchestrator expose the graduation request count as summary-only data. They do not execute those requests directly.

## Constraints Kept

- Strategy caps remain committed config: per-tx, per-day, per-chain, and max daily loss caps are unchanged.
- `tinyLivePerTxUsd` remains the canary sizing clamp.
- `SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation` is the only automatic graduation ladder.
- The 20% BTC-denominated operating capital floor remains policy-owned and unchanged.
- Non-bluechip protocol concentration remains capped at 25% without a committed diff.
- CL exposure above 50% still requires live range, IL, and unwind monitoring.
- Reward haircut remains 50% for non-stable liquid rewards and 80-90% for pre-TGE or points-style rewards unless config says otherwise.
- `minEthereumNotionalUsd`, `minPositionUsd`, and `allowSmallEthereumProofBackedEntries` are unchanged.
- Kill-switch, dev-lock, auto-kill triggers, signer isolation, audit logs, and receipt-proof rules are untouched.
- Payback remains isolated and last priority. This allocator does not size from payback funds or change payback ratio/timing.
- Bridge/swap/gas costs come from committed measured fields or p90-style sizing defaults in `src/config/sizing.mjs`; no speculative route is introduced.

## Overfit Guards Kept

- New strategy evidence still requires walk-forward purged/embargoed CV plus at least one regime change in sample, per `docs/research/ops-costs.md`.
- Displayed APR is not enough. Candidates are compared over the same hold window after haircut, gas, bridge, claim/swap, slippage, and exit/unwind cost.
- Cost defaults stay pessimistic: same-chain tiny canary costs use the committed policy in `src/config/sizing.mjs`; unknown chains fall back to the existing conservative path.
- Reward-token exit liquidity proof remains required for explicit reward-token canaries. Entry inventory is not treated as reward proof.
- A single outlier campaign payout is evidence to build detection/execution support, not a baseline for cap increases.

## Not Changed

- No cap was raised.
- No environment variable was added to relax caps.
- No runtime LLM call was added.
- No bridge route, token, protocol, or chain was invented.
- No audit log was deleted, rewritten, or rotated.
- The signer path remains policy-gated. The new graduation request is a planner handoff, not a signer-ready transaction.
- The payback engine was not changed.

## Worked Snapshot

Latest local wallet slice at `dashboard/public/wallet-holdings.json` showed:

- Total: about USD 371.31
- Wallet inventory: about USD 303.33
- Protocol inventory: about USD 67.98
- Source: whole-wallet inventory

Latest follow-up Merkl portfolio allocator preview showed:

- Queue count: 29
- Active position value: about USD 27.75
- Entry-ready count: 0
- Graduation canary request count: 0
- Capital job count: 0
- The most important now-visible blocker is the tiny-canary EV floor, for example `same_chain_unprofitable:need_$9_on_sei` with inventory as the limiting factor.

With the new planner behavior, the already proof-backed Base hold can still be selected when BTC-first expected net is positive. Proof-missing candidates are not treated as hold entries and do not get refill jobs first; they surface graduation canary requests only when the committed ladder, tiny-live cap, inventory, auto-entry checks, and tiny-canary EV floor all clear.

Follow-up preview after the Yei binding fix showed:

- `Lend USDC on Yei` now resolves the existing `aave_v3_pool_supply_withdraw` binding with the pinned Sei/Yei USDC pool.
- `Borrow USDC from Yei` is no longer treated as a supply canary because its token is a variable-debt token and needs a separate collateral/HF borrow path.
- The Yei supply mini-canary is still blocked correctly: current inventory is about USD 3.31, while the same-chain tiny-canary EV floor requires about USD 8.95. The allocator reports `same_chain_unprofitable:need_$9_on_sei`, `graduationLimiters: ["inventory", "targetChainUsd"]`, and emits no graduation request.

That means the system can use the USD 303 wallet inventory more aggressively without pretending proof exists: proven candidates can enter, proof-missing opportunities get mini-canary requests, and idle inventory is reported instead of silently disappearing behind a generic blocked state.
