# Strategy Reset - 2026-04-12

## Why This Exists

This document translates the original BOB Claw v5 vision into the current evidence-based operating plan.

It is not a rejection of the original idea.

It is a reset from:

- architecture-first optimism

to:

- evidence-first route validation

## What Still Holds

- The USD 300 ring-fenced wallet rule is still correct.
- Ethereum L1 should remain excluded in this phase.
- BOB Gateway remains a core execution surface worth monitoring.
- DEX legs remain necessary for executable route validation.
- Stablecoin legs matter because they close real loops.
- Cloudflare should stay dashboard-only.
- Signer isolation, no unlimited approvals, and emergency-stop gating remain mandatory.

## What Changed

### 1. Gateway is a route surface, not automatic proof of edge

The original framing treated Gateway as an execution engine and assumed that this made many route ideas naturally actionable.

Current evidence says:

- a Gateway route can be mechanically executable
- and still fail the economic test
- and still fail prep viability
- and still fail overfit gates

Updated rule:

- Gateway quote availability is necessary
- not sufficient

### 2. The active canary is not the whole strategy universe

Current best-prepared route:

- `bob->base wBTC.OFT->wBTC.OFT`

Current decision:

- `reject_no_net_edge`

This does not prove every strategy is dead.

It proves:

- the current prep-viable baseline route is not good enough

Updated rule:

- keep one active canary
- expand many shadow candidates

### 3. Positive measured routes are still hypotheses until prep-complete

Some routes can look very positive in measured summaries, especially:

- `ethereum->base WBTC->wBTC.OFT`

But those numbers are not yet execution permission because they may still lack:

- wallet readiness
- exact gas
- allowance readiness
- fresh executable DEX support
- full route viability

Updated rule:

- measured positive != executable positive

### 4. Stable and DEX-assisted loops are still in scope

The project should not collapse into only one thesis.

Still in scope:

- wrapped-BTC transfer routes
- stable-entry / stable-exit loops
- BTC proxy spread observation
- Gateway plus DEX combined loops
- broader BTC-derivative coverage

Updated rule:

- search broadly in shadow mode
- trade narrowly in live mode

## What The Original Plan Missed

The original plan was strongest on architecture and weakest on evidence accounting.

The missing layer was route-by-route proof quality:

- sample count
- quote success rate
- failure rate
- latency
- fees
- exact gas freshness
- amount ladder coverage
- quote decay survival
- hour bucket diversity
- durable no-edge evidence

Updated rule:

- the evidence system is the product before the executor is the product

## Current Operating Model

### Active execution posture

- `liveTrading=BLOCKED`
- `shadowTrading=ALLOWED`
- one active canary only
- multiple shadow candidates monitored in parallel

### Active canary role

The active canary is the baseline route that is most operationally prepared.

It is not necessarily the route with the highest measured edge.

### Multi-shadow roster role

The shadow roster exists to prevent local overfitting.

Candidate groups to keep tracking:

- `bob->base wBTC.OFT->wBTC.OFT`
- `ethereum->base WBTC->wBTC.OFT`
- `base->avalanche wBTC.OFT->wBTC.OFT`
- `base->sonic wBTC.OFT->wBTC.OFT`
- `base->unichain wBTC.OFT->wBTC.OFT`
- BTC proxy spread ladders
- stable-entry and stable-exit loops where amount matching can be measured

## Updated Priorities

### Priority 1. Hardening

Before expanding execution logic:

- eliminate metadata errors
- harden watcher and scoring assumptions
- add guards for stale, missing, or non-finite inputs

### Priority 2. Multi-shadow candidate expansion

Do not only refresh the current canary.

Also build evidence for:

- alternative prep candidates
- tx-ready shadow candidates
- research candidates with missing readiness

### Priority 3. Replay and shadow failure-case coverage

Add tests that make false positives harder:

- stale positive route should not look tradeable
- missing DEX legs should not look executable
- mixed freshness should not promote a route
- partial route refresh should not silently narrow scope incorrectly

### Priority 4. Overfit-resistant evidence accumulation

Do not advance because a route looks exciting once.

Advance only when evidence becomes durable across:

- time
- amount
- route
- freshness

## Explicit Anti-Overfit Rules

- Do not infer profit from architecture elegance.
- Do not infer readiness from one positive measurement.
- Do not infer universal failure from one negative canary.
- Do not infer token metadata from memory when on-chain checks are available.
- Do not let affiliate revenue justify a weak trade.
- Do not treat directional BTC exposure as route profit.

## Execution Plan From Here

### Now

- keep live blocked
- commit the current hardening changes
- surface the multi-shadow roster in status outputs

### Next

- expand shadow candidate tracking
- expand replay and shadow failure tests
- keep amount ladder and quote-decay evidence growing

### Later

- only revisit canary escalation after:
  - objective blocker clears
  - overfit time gates clear
  - route evidence remains durable

## Bottom Line

The original idea was directionally useful.

The current system is now more objective:

- less thesis-driven
- more route-driven
- less architecture-first
- more evidence-first

That is progress, not retreat.
