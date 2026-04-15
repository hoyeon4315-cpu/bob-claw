# Native BTC Capital Allocator Plan

Last reviewed: 2026-04-14

## Objective

Build BOB Claw into a deterministic, phase-gated native BTC capital allocator that:

- starts from native BTC
- uses BOB Gateway / current swap surface as the transport rail
- scores multiple destination strategies across supported chains
- chooses among arbitrage, yield, lending, LP, and inventory-conversion paths
- stays blocked from live execution until evidence clears policy and anti-overfit gates

This plan is intentionally broader than the original BOB-local loop thesis.

## Session Protocol

Every implementation session must begin by reading:

1. this file
2. `data/native-btc-capital-allocator-plan-state.json`
3. `data/native-btc-opportunity-surface.json`
4. `docs/current-status.md`

Before moving to the next stage:

1. re-check the current live route surface
2. verify that no stale assumptions remain in the active stage
3. update the plan state if evidence changed
4. run the stage-specific verification commands
5. only then promote the next stage to `in_progress`

If fresh evidence contradicts an assumption in this file, update the plan document first, then update the state file, then continue coding.

## Ground Truth As Of 2026-04-14

Validated facts from live API and local reports:

- native BTC live route count: `21`
- supported destination chains from native BTC: `base`, `ethereum`, `bsc`, `bob`, `bera`, `unichain`, `avalanche`, `sonic`, `soneium`
- wrapped-BTC destination routes: `10`
- stablecoin destination routes: `5`
- ETH-like destination routes: `3`
- native BTC `2 BTC` quote support is real on most routes
- native BTC `2.1 BTC` exceeds the current route cap
- current exact canary remains economically blocked
- current BTC proxy spread family remains blocked by high overfit risk
- `solvBTC`, `LBTC`, `xSolvBTC`, `FBTC`, `SolvBTC.BBN`, and similar older watchlist ideas are not in the current live route inventory

## What This Project Is Now

The project is no longer just:

- find one profitable BOB-local loop

It is now:

- measure transport depth
- classify destination opportunity families
- score destination deployment opportunities
- model unwind back to BTC
- only then allow allocation planning

## Strategy Universe To Support

The allocator must eventually understand all of these families:

1. BTC -> wrapped BTC transport and hold
2. BTC-family closed-loop arbitrage
3. wrapped BTC proxy spread rebalance
4. wrapped BTC destination yield
5. wrapped BTC lending deployment
6. wrapped BTC LP deployment
7. BTC -> stablecoin treasury parking
8. BTC <-> stablecoin direct loop arbitrage
9. stablecoin lending carry
10. stablecoin LP or basis deployment
11. BTC -> ETH rotation
12. ETH destination deployment
13. BTC -> gold proxy rotation
14. BTC -> experimental destination assets
15. Gateway custom destination actions
16. partner fee monetization
17. referral revenue

These strategy families are not equivalent. The system must keep these categories separate:

- `transport`
- `arbitrage`
- `yield`
- `macro_rotation`
- `platform`
- `monetization`
- `experimental`

## What Counts As Progress

Progress does not mean:

- a marketing post exists
- a route appears in a blog
- a quote looks positive once

Progress does mean:

- the route is live in current inventory
- quote depth survives repeated checks
- destination venue exists and is allowlisted
- unwind cost is measured
- strategy family has correct classification
- overfit review passes for the relevant evidence type

## Stage Plan

### Stage 1. Live Route Surface

Goal:

- keep an always-current map of what native BTC can reach today

Deliverables:

- `data/native-btc-opportunity-surface.json`
- stale-assumption filter
- route family breakdown by destination asset type

Exit criteria:

- route inventory is reproducible from live API
- stale assumptions are separated from active opportunities

### Stage 2. Capacity And Quote Depth

Goal:

- prove route depth and quote caps are real, not inferred

Deliverables:

- repeated capacity scans at multiple BTC sizes
- route-level cap observations
- success / failure heatmap by destination route

Exit criteria:

- large-size quote support is measured on current live routes
- cap failures are recorded distinctly from execution failures

### Stage 3. Strategy Universe Classification

Goal:

- enumerate every strategy family the allocator may score

Deliverables:

- complete strategy family list
- category separation
- status fields: `supported_now`, `research_needed`, `measured_blocked`, `experimental_only`, `product_surface_supported`

Exit criteria:

- no active strategy relies on stale or removed route assumptions

### Stage 4. Destination Registry

Goal:

- build a deterministic registry of destination strategies by chain and asset family

Deliverables:

- chain-by-chain destination registry
- strategy metadata schema
- support for lending / LP / vault / custom action entries
- allowlist and denylist fields

Exit criteria:

- destination strategies can be represented without free-form memory

### Stage 5. Destination Scoring

Goal:

- score strategies after transport, before execution

Deliverables:

- transport cost model
- destination gross return model
- unwind back-to-BTC model
- confidence and evidence grading

Exit criteria:

- each destination candidate has deterministic estimated economics

### Stage 6. Overfit And Truthfulness Gates

Goal:

- prevent the allocator from treating sparse or stale signals as real edge

Deliverables:

- family-specific overfit checks
- stale evidence warnings
- source freshness requirements
- distinction between quote depth and realized depth

Exit criteria:

- no strategy family can become allocatable with single-snapshot evidence

### Stage 7. Allocation Planner

Goal:

- rank opportunities and produce a capital split plan

Deliverables:

- candidate ranking
- capital sizing rules
- hard exclusions for blocked families
- policy-aware allocation limits

Exit criteria:

- planner can recommend allocations without authorizing execution

### Stage 8. Reviewable Agent Loop

Goal:

- make the allocator persistent across sessions and reviewable by humans

Deliverables:

- session-safe progress tracker
- CLI reporting for current stage and remaining stages
- next-step command suggestions

Exit criteria:

- a fresh session can continue from current state without re-deriving context

### Stage 9. Execution Admission Preparation

Goal:

- prepare, but not auto-enable, execution

Deliverables:

- route-to-destination validation package
- receipt reconciliation hooks
- final manual review checklist

Exit criteria:

- execution remains blocked until policy, overfit, and validation gates are all satisfied

## Verification Rules

For every stage:

- verify live support before trusting a strategy family
- treat old blogs as hints, not truth
- treat quote support as transport evidence, not realized profitability
- keep realized, estimated, and paper PnL separated
- keep Ethereum L1 observe-only in the USD 300 phase unless re-approved
- update both the Markdown plan and the JSON state if assumptions change

## Immediate Next Build Focus

The next implementation focus after this planning setup is:

- `Stage 4. Destination Registry`

Because route surface and quote-cap evidence are now strong enough that the main blocker is no longer transport uncertainty. The blocker is missing destination strategy registry and deterministic scoring.
