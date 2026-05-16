# Yield Lane Capital & Refill Impact Modeling
**Date**: 2026-05-17
**Owner**: Capital & Treasury Domain Lead
**Context**: DefiLlama yield-portfolio lane revival (Joint Session pilot, now shadow_ready per diagnostics). Receipt-backed (evidenceClass), sleeve-native stable/wrapped_btc on 11 Gateway chains.
**Status**: Modeling only — no code changes yet. Evidence-complete from diagnostics + source review.

## Mandatory Diagnostics Executed (AGENTS.md + B-Model Protocol — Raw Outputs)
Before any treasury analysis or modeling:

1. `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
   - Full inventory snapshot (493 lines). Key signals (excerpted raw):
     - Many chains with critically low native gas (base ETH ~0.00127 BTC-equivalent ~$2.84; bob ~$4.58; soneium ~$0.57; unichain ~$1.08).
     - wBTC.OFT sleeve balances thin: bob=0, bsc=39 sat (~$0.03), base=3 sat, ethereum WBTC target 0.0001 (10k sat) ready.
     - Some tokens have explicit `targetBalance` / `refillToTarget` (e.g. bob wBTC.OFT min 0.0001 target 0.0003 "Current 10k sat canary-prep route plus retry margin.").
     - Multiple yield-category entries (apxUSD etc.) with strategyPolicy perTradeCapUsd=10 or 3.
   - Decision surface inferred: REFILL_REQUIRED already active (matches automation-readiness).

2. `node src/cli/check-full-automation-readiness.mjs --json` (verbatim key block):
   ```
   "capitalManager": {
     "rebalanceDecision": "REBALANCE_REQUIRED",
     "capitalPlanDecision": "REFILL_REQUIRED",
     "refillJobCount": 3,
     "autoRefillJobCount": 1,
     "ready": true
   },
   ...
   "strategyDispatch": {
     ...
     {
       "strategyId": "defillama-yield-portfolio",
       "selectedMode": "shadow",
       "status": "shadow_ready",
       "reason": "receipt_bound_pools_via_snapshot_evidenceClass",
       "blockers": [ "shadow_only", "live_executor_not_bound" ]
     },
     ...
   }
   ```
   Overall: ready=false (payback timeout, runtime not ready, strategy_dispatch_not_ready). defillama lane now advanced past analysis_only.

3. `npm run report:payback-status -- --json` (raw key excerpts):
   ```
   "payback": {
     "accumulatorPendingSats": 586,
     "grossProfitSatsPeriod": 586,
     "paidBackSatsLifetime": 0,
     ...
     "scheduler": { "status": "carry", "reason": "planned_payback_below_minimum", ... },
     "minimumReview": {
       "status": "propose_patch",
       "reason": "both_profiles_non_positive_run_rate",
       "currentMinPaybackSats": 50000,
       "proposedMinPaybackSats": 5000,
       ...
     },
     "estimatedPeriodsToFirstPayback": { ... "realizedGrossProfitPeriodMedian": -387, ... "non_positive_realized_run_rate" }
   },
   "policy": { "operatingCapitalSats": 721441, "minPaybackSats": 5000, "staticMinPaybackSats": 50000, ... }
   ```
   Current: 0.24% progress to min (remaining ~49,880 sats), carry scheduler, non-positive run rate on both smallCapital_v1 and aggressive profiles. Bitcoin native balance ~0.00234 BTC (~$185) + thin gas float across 11 chains.

4. `npm run report:capital-audit -- --json`
   - **데이터 부족** (command produced only 34 bytes under 15s shell timeout; heavy 7MB+ report as noted in prior session). Prior evidence (session memory): receipt_read_failed on base (RPC), bitcoin_history_read_failed (high sev, 2 addresses), gateway_quote_residual_unexplained (low sev). Operating capital and inventory data present; no pre-existing defillama-yield-portfolio line items.

Additional context (current-status.md Treasury Triage verbatim):
```
## Treasury Triage
- Wallet mode: `single_wallet`. Budget derived from real-time wallet inventory. `dual_wallet` remains later-phase reserve tooling, not the current blocker.
- Do now: keep reserve-replenishment modeling and refill-cost accounting inside the single-wallet path so system PnL includes treasury maintenance.
- Under-modelled gap: non-BTC cross-chain native/token refill stays conditional until a dedicated executor exists. Currently no active lane requires it — all active strategies are BTC-family-based.
- Later: consider `dual_wallet` reserve transfers only after measured positive expectancy and reserve replenishment are both confirmed.
```
Yield paper lanes (current-status): pilot=$105, diversified=$205, default=$338.33. Capital mode: per_strategy_caps.

## Expected Capital Allocation (Pilot vs Diversified)
- **Pilot (shadow → first live_candidate, receipt-bound pools only)**: $50–105 total sleeve capital.
  - 2–4 top pools (e.g. aave-v3 / morpho / beefy / erc4626 on base/bob/ethereum where receipt proofs exist via canary helpers).
  - Per position: $15–35 (fits SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE microMaxUsd=50, initialMicroUsd=10; opportunisticMaxUsd=125).
  - Allocation weights from adapter (maxSameChainSharePct=50, maxSameProtocolSharePct=30, maxPoolSharePct=5).
  - Source: BTC → Gateway sleeve (wBTC.OFT or stable) on dest. Fits existing canary-prep wBTC.OFT targets (e.g. bob 10k–30k sat).
- **Diversified (post 3+ proven receipt chains, liveCapable)**: $150–250 total open yield NAV.
  - 6–10 chains, 8–12 protocols, respecting adapter diversification + SMALL_CAPITAL_RADAR_CAPS_BASELINE (cumulativeOpenUsd=200, maxConcurrentOpen=6).
  - Per-chain sleeve target uplift: +0.0002–0.0005 wBTC.OFT or equiv stable (adds to existing bob/ethereum targets).
  - Budget source: 20–30% of opportunistic + micro envelopes in small-capital-campaign-mode (current operating ~$721k sats native + ~$150–200 stable/gas inventory from inventory snapshot).
- **Invariant preserved**: perTradeCapUsd remains code-committed (strategy-caps/registry or adapter DEFAULT). Currently 0 in adapter (shadow). No escalation of sizing for payback.

## New Refill Triggers & Cost Accounting for Cross-Chain Yield Positions
Current state (refill-job.mjs + discretionary-budget-guard + target-balances):
- Refill driven by minBalance/targetBalance per (chain, token) in inventory (e.g. wBTC.OFT on bob has explicit targets for canary).
- 3 refill jobs, 1 auto; many "bridge_quote_cost_above_discretionary_ceiling" or "route_refill_economically_unjustified".
- Under-modelled: non-BTC cross-chain token refill (stables/wbtc sleeves) conditional; no dedicated executor yet. All current active lanes BTC-family.

**Impact of defillama-yield-portfolio**:
- **New triggers**:
  - Protocol position mark (via protocol-position-marker + adapters aave/erc4626) shows yield sleeve (aUSDC, wbtc share, mToken) balance < computed "yield_sleeve_target" (derived from top-k rotator + adapter allocation weight + horizon).
  - Gas float keeper must now cover harvest/claim + exit txs on 11 chains (currently thin gas on 8+ chains → more "gas_zips" or native refuel jobs).
  - EvidenceClass="receipt_bound_pools_via_snapshot_evidenceClass" can relax economic review threshold (similar to existing canary carve-out in refill-job.mjs lines 84–93: "small-capital scale multipliers still apply... skip the economic review reason for these cases").
- **New cost accounting needed** (single-wallet treasury maintenance):
  - `yield_position_maintenance_usd` = (expected harvest gas 30–90d) + (exit roundtrip slippage + bridge via Gateway BTC-intermediate) + (locked capital opportunity at risk-free).
  - Add to effectiveSystemNetPnlUsd calc in capital-routing-plan / scored-target-balances (currently yield-focused scoring already penalizes pure transport; yield positions need +alpha credit once receipt proven).
  - Cross-chain sleeve funding cost must be attributed to the yield lane (not pure payback or canary) so PnL includes treasury drag.
  - Dashboard / capital-audit must surface "yield_locked_nav_usd" vs liquid for payback runway.
- **Small-capital interaction**: discretionary-budget.mjs bridgeMaxCostUsd=2.5 (raised for small-cap); sizing.mjs has aggressive reductions on base/bsc. New lane will increase "route_refill_economically_unjustified" count unless yield-specific carve-out added (higher tolerance when evidenceClass receipt_bound + projectedNetUsd >0).

This directly surfaces the "under-modelled gap" in current-status Treasury Triage — yield lane is the first non-BTC-family sleeve-heavy lane.

## Risk to Payback Minimum from Yield Volatility
- **Current payback invariants** (verbatim from diagnostics): carry scheduler, 586 sats accumulated (gross 586 lifetime), min 50k sats (proposed patch to 5k due to non-positive run rate, median period -387 sats), operatingCapitalSats=721441, 8 expansion periods remaining, 0.24% progress. Payback never escalates sizing.
- **Yield volatility exposure**:
  - Positions are sleeve-native (stable/wbtc share tokens stay on dest until unwind). Profit repatriation requires Gateway off-ramp or DEX → BTC (adds roundtrip cost 70–100bps in adapter gates + bridge fees).
  - Risks that hit payback: APY collapse, smart-contract loss, bridge (wBTC.OFT) depeg/lock, exit slippage > maxExitSlippageBps=50, harvest failure. Any principal loss > maxDailyLossUsd (lane default 50) triggers auto-kill or pause_new_entries (see current-status auto-unwind runtime).
  - Locked capital on 11 chains reduces liquid float for immediate payback or emergency refill. If multiple positions unwind negative net, extends "planned_payback_below_minimum" carry indefinitely.
  - Evidence requirement (receipt-backed entry/exit + balance delta via settlement-proof) is the mitigation: only proven +EV sleeves get allocation. Volatility still possible post-proof (APY is variable).
- **Quantified risk in small-cap**: With ~$200–300 diversified yield open, a 5–8% adverse move (realistic for some DeFi vaults in stress) = $10–24 loss, comparable to current per-period negative realized. Could wipe multiple periods of grossProfitSats progress.
- **Treasury cost amplification**: 11-chain monitoring + harvest txs increase gas burn (already receipt_read_failed issues noted in capital-audit). Single-wallet means every sat of maintenance directly competes with payback accumulator.

**Invariant**: All NAV/balance queries live-read (same tick). Yield positions must appear in protocol-position-ledger + universal-position-aggregator so capital-audit sees true "committed" vs liquid.

## Recommendations for Refill & Capital Automation Engineer
(Direct ownership per your role: refill-job planning, blocker-resolution/recipes, gas-float-keeper, capital-routing-plan, inventory triggers.)

**Immediate (no PR yet — model only)**:
1. Review this doc + active-work/defillama-yield-lane-revival.md. Confirm whether "yield_sleeve" fundingSource type + dedicated cost guard belongs in discretionary-budget-guard.mjs or new yield-refill-policy.mjs.
2. Propose extension to target-balances / scored-target-balances: compute dynamic yield_sleeve_target per (chain, family) from adapter snapshot + evidenceClass freshness (coordinate Evidence/Receipt).
3. Add to refill blocker taxonomy: new reason "yield_sleeve_refill_economically_unjustified" with carve-out when receipt_bound + projectedNetUsd > cost ceiling (raise discretionary for proven lanes only).
4. Update gas-float-keeper to reserve harvest gas budget (e.g. +$2–4 per active yield chain, 30d horizon) on top of existing canary targets.
5. Model "effective_payback_runway_sats" = operatingCapitalSats - yield_locked_nav_usd (converted) - pending_refill_costs. Feed into payback-status and minimumReview logic (currently both profiles unavailable due to non-positive rate).

**Pilot guardrails (when caps added to registry)**:
- Register "defillama-yield-portfolio" in src/config/strategy-caps/registry.mjs with:
  - perTradeCapUsd: 35 (pilot), perDayCapUsd: 150, maxDailyLossUsd: 25 (small-capital clamped), tinyLivePerTxUsd: 15.
  - gasFloat per chain: min 4–6 USD (harvest + exit buffer) for all 11.
- Keep autoExecute: false until 3+ chains have proven receipt + positive 7d realized net after costs.
- Add test coverage in test/capital-manager-refill-plan.test.mjs and refill-job-store.test.mjs for yield sleeve scenarios.

**Coordination**:
- Pull Allocation & Rebalancing Specialist for scored allocation weights that include yield NAV.
- With Evidence/Receipt: ensure protocol-position-mark for yield pools feeds capital-audit in <1h freshness.
- If specific blocker recipe or cost guard change is ready, I (Capital Lead) will Direct Call you with fork_context + this file + template.

This keeps treasury invariants (BTC-denominated first, single-wallet full cost accounting, caps as code, small-capital safety, live on-chain reads) while enabling the new opportunity lane without leaking capital or delaying payback runway.

**Next for Capital Domain**: Wait for Receipt/Yield Engineer receipt proof artifacts → then define exact sleeve targets + PR to caps + refill logic. All in active-work/.

— Capital & Treasury Domain Lead
