# Research Pass - 2026-04-12

## Scope

- Goal: reassess whether BOB Gateway / Instant Swap can still support a profitable, automatable strategy under the current USD 300 ring-fenced phase.
- Constraint: live trading remains `BLOCKED`.
- Starting point: the currently measured BTC-family closed-loop universe is already in a `measured no-edge universe` state.

## Current Situation

Local repo facts already measured:

- Closed measured loops: 49
- Profitable closed loops: 0
- Loop-observable routes: 10
- Durable no-edge routes: 10
- Best measured loop: still about `$0.89` below policy
- Current canary route: blocked by `reject_no_net_edge`, not by missing inputs

Live Gateway inventory rechecked on 2026-04-12:

- Routes: 113
- Chains: 10
- BTC-family routes: 95
- BOB-touching routes: 19
- No new chains or assets appeared relative to the latest local snapshot

Important interpretation:

- The current negative result is real for the currently measurable BTC-family loop universe.
- It is not yet a proof that every possible Gateway monetization path is dead.
- It is strong evidence that the original pure cross-chain wrapper-BTC loop thesis is weak under the current fee and size constraints.

## Fresh Quote Spot Checks

Fresh live quotes were sampled directly from Gateway on 2026-04-12 using the current public API and a BTC mark near `$73,547`.

### BTC -> Base USDC

- `10,000 sats` in -> `6.404741 USDC` out
  - about `-12.92%`
- `50,000 sats` in -> `35.831023 USDC` out
  - about `-2.56%`
- `200,000 sats` in -> `146.172075 USDC` out
  - about `-0.63%`
- `400,000 sats` in -> `293.237954 USDC` out
  - about `-0.32%`

### Base USDC -> BTC

- `10 USDC` in -> about `$9.50` BTC out
  - about `-5.01%`
- `50 USDC` in -> about `$49.44` BTC out
  - about `-1.12%`
- `100 USDC` in -> about `$99.36` BTC out
  - about `-0.64%`
- `250 USDC` in -> about `$249.14` BTC out
  - about `-0.34%`

### BTC -> BSC USDT

- `10,000 sats` in -> `6.38433914710711 USDT` out
  - about `-13.19%`
- `50,000 sats` in -> `35.78291597687495 USDT` out
  - about `-2.69%`
- `200,000 sats` in -> `146.01682245030202 USDT` out
  - about `-0.73%`

### BSC USDT -> BTC

- `10 USDT` in -> about `$9.51` BTC out
  - about `-4.93%`
- `50 USDT` in -> about `$49.47` BTC out
  - about `-1.06%`
- `100 USDT` in -> about `$99.42` BTC out
  - about `-0.58%`

Main takeaway:

- On low-fee chains, the new BTC swap routes do improve materially with size.
- Even near the current ring-fenced bankroll ceiling, the one-way haircut is still roughly `0.3%` to `0.7%`.
- A closed round trip on the same asset pair is therefore still roughly `0.7%` to `1.4%` negative before extra gas, execution slippage, or safety margin.
- That does not clear policy.

## Fresh BTC Proxy Spread Rerun And Overfit Audit

After refreshing Gateway BTC-family quotes and rerunning DEX stable-entry / stable-exit quotes on 2026-04-12, the new inventory-arbitrage surface looks worse than the earlier stale sample:

- `buyQuotes=11`
- `sellQuotes=46`
- `freshBuyQuotes=10`
- `freshSellQuotes=40`
- observed proxy groups:
  - buy side: `1`
  - sell side: `2`
  - matched opportunity groups: `1`
- `rawPositive=0`
- `rebalancePositive=0`
- `policyReady=0`
- overfit assessment: `moderate_overfit_risk`
- remaining overfit risks:
  - `thin_buy_quote_coverage`
  - `single_proxy_group`

Important interpretation:

- The earlier `raw positive` hint was not durable under fresher quotes.
- That means at least some earlier optimism was sensitive to stale samples and should not be trusted.
- At the same time, the negative result is still not a universal proof across every BTC derivative proxy because observed buy coverage is thin.
- Specifically, `solvBTC` now appears on the observed sell surface, but no matching observed stable-entry buy surface exists yet, so it is underobserved rather than disproven.

Updated takeaway:

- For the currently observable `wBTC / wBTC.OFT` inventory-arbitrage surface, the result has strengthened from `weakly negative after rebalance` to `no raw edge even before rebalance`.
- For non-`wBTC` BTC derivatives, the right status is still `underexplored / not fully measurable`, not `confirmed dead`.

## 1. Already Well-Tested And Likely Dead Ends

### A. Wrapped-BTC closed loops across currently measurable Gateway + DEX routes

Why this is likely dead:

- 49 closed measured loops
- 0 profitable
- best route still materially below policy
- 10 durable no-edge routes
- the current canary blocker is economic, not observability

Conclusion:

- This universe should be treated as structurally weak, not merely under-sampled.

### B. BTC <-> stablecoin direct swap loops on currently launched low-fee chains

Why this is likely dead:

- Fresh live samples on Base and BSC still show one-way loss even near the USD 250-300 size band.
- The effective round-trip drag remains too high for the current minimum profit policy.

Conclusion:

- This universe is worth one final systematic ladder test for documentation, but it should not be the main hope line anymore.

### C. Ethereum L1 routes in the USD 300 phase

Why this is likely dead:

- Project rules already disable Ethereum L1 trading in the ring-fenced phase.
- Current measured quotes to Ethereum assets are materially worse than Base/BSC.

Conclusion:

- Keep observe-only.

### D. Gold-token routes like `PAXG` and `XAUT`

Why this is likely dead:

- Only a tiny route set exists.
- Current measured economics are clearly negative.
- They sit on Ethereum, which is already the wrong fee domain for this phase.

Conclusion:

- Do not prioritize.

## 2. Underexplored But Plausible Universes

### A. New Gateway asset and chain inventory as it expands

Why still plausible:

- Official BOB materials now position Gateway as a broader BTC swap product and say more assets and chains are rolling out.
- The current live API still shows only 113 routes across 10 chains.

Interpretation:

- The current dead-end result applies to the current live inventory, not to assets that have not appeared yet.
- The highest-probability source of a new edge is a new route family, not another pass over the same route family.

### B. Gateway custom destination actions

Why still plausible:

- Official BOB Gateway materials now support custom destination-chain actions.
- This opens routes such as BTC -> destination-chain position deployment, LP entry, lending, or collateralization in a single flow.

Caution:

- This is not pure arbitrage.
- It is closer to yield, incentive capture, or inventory transformation.
- It must not be misclassified as non-directional route profit.

### C. Integrator / referral monetization

Why still plausible:

- Gateway now supports configurable partner monetization.
- BOB has also launched a referral revenue-share model.

Caution:

- This is a distribution business, not a trading bot.
- It may be more viable than self-funded arbitrage at USD 300, but it requires traffic or integration partners.

### D. Cross-venue hedged BTC flow, not pure onchain loop

Example shape:

- Gateway quote on one side
- external CEX or offchain spot inventory on the other side
- pre-positioned balances to avoid waiting for a full closed loop

Why still plausible:

- Gateway now supports CEX-friendly and hardware-wallet-friendly flows.

Caution:

- This is a strategy change.
- It increases operational complexity, counterparty exposure, and inventory management burden.
- It is unlikely to be the first thing to build under the current project boundary.

### E. Dynamic matched-amount cross-asset loops

Why still plausible:

- The current loop engine mostly focuses on BTC-family closed loops and exact sampled amount matches.
- Stablecoin/BTC routes are underrepresented in the current closed-loop summary because the amount ladder is sparse and mismatched.

Caution:

- Fresh live spot checks already suggest the economics remain weak even when size is pushed higher.
- This is a documentation / falsification experiment now, not the main growth thesis.

## 3. Concrete Next Experiments With Highest Information Value

### Experiment 1. Build a dynamic quote-surface scanner for all non-wrapper route families

Priority: highest

What to test:

- `btc->stablecoin`
- `stablecoin->btc`
- `btc->native_or_wrapped`
- `native_or_wrapped->btc`
- `btc->other`
- `other->btc`

How:

- fixed USD ladder targets such as `25 / 50 / 100 / 250`
- live one-way haircut vs external mark
- p50 / p95 latency
- quote success rate
- route availability drift

Decision rule:

- if one-way haircut does not approach `<= 0.20%` on low-fee chains near canary size, stop treating that family as a serious arbitrage candidate

### Experiment 2. Extend the route-universe classification beyond BTC-family closed loops

Priority: highest

What to change:

- separate route families into:
  - `closed_loop_arb`
  - `inventory_conversion`
  - `yield_action`
  - `integrator_revenue`
- do not let `measured no-edge universe` imply that all Gateway business models are dead

Why:

- current reporting is correct for the current BTC-family loop universe
- current reporting is too narrow for deciding the whole project direction

### Experiment 3. Add a route-addition watcher

Priority: high

What it should do:

- diff live `/v1/get-routes`
- alert on new chains
- alert on new token families
- alert on new low-fee stablecoin destinations
- automatically schedule surface scans on newly added routes

Why:

- the most likely source of future edge is a new route family, not another rescore of the same dead family

### Experiment 4. Run one final systematic low-fee swap falsification pass

Priority: high

Scope:

- Base USDC
- BSC USDT
- optionally Base ETH if it remains low enough to compare

What to measure:

- both directions
- matched USD ladders
- same-day repeated samples
- latency consistency

Expected result:

- likely final confirmation that current low-fee BTC swap routes are still sub-policy for arbitrage

### Experiment 5. If arbitrage remains dead, explicitly pivot to a non-arb Gateway monetization track

Priority: high

Possible tracks:

- partner/referral revenue
- Gateway-integrated yield workflows
- dashboard / routing product for BTC users

Condition:

- only after the falsification pass confirms no viable low-fee swap edge

## What This Means Strategically

### Honest answer under current constraints

If the question is:

- "Is there good evidence that a USD 300 pure cross-chain arbitrage bot using the current BOB Gateway route universe can find durable edge today?"

The answer is:

- no, not from the current measured evidence

### Stronger answer

The current strategy space is probably not viable in its original narrow form:

- pure closed-loop BTC-family chain arbitrage
- current live route inventory
- current fee structure
- current USD 300 bankroll

That does not mean the broader BOB Gateway opportunity is dead.

It means the project should likely pivot from:

- "find another BTC-family loop"

to:

- "monitor for new route families, formally falsify currently launched BTC swap routes, and prepare a second monetization track"

## Recommended Build Order From Here

### Phase 1. Research infrastructure

Build next:

- quote-surface scanner for all route families
- universe classifier upgrade
- route-addition watcher

Do not build next:

- autonomous live executor for the current strategy

### Phase 2. Final arbitrage falsification

Run:

- matched-size ladder scans on Base USDC and BSC USDT
- repeated intraday samples
- one-page route-family summary

Exit condition:

- if no low-fee family gets close enough to policy, end the pure arbitrage line

### Phase 3. Conditional pivot

If pure arbitrage fails:

- keep live trading blocked
- preserve the observer, scorer, dashboard, and safety stack
- redirect execution effort into:
  - integrator/referral automation, or
  - Gateway-powered yield / position workflows

## Bottom Line

- The original wrapper-BTC cross-chain arbitrage thesis looks mostly exhausted under current constraints.
- The newly launched BTC swap routes on low-fee chains are better than the early slow BTC routes, but still not good enough for policy-ready arbitrage at the current bankroll ceiling.
- The most rational next step is not a live canary.
- The most rational next step is to widen the measured universe correctly, falsify the newly launched low-fee swap routes decisively, and prepare a pivot path if they remain sub-policy.
