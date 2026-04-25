# BOB Claw strategy system map

Date: 2026-04-15

## One-line conclusion

BOB Claw is not yet a live trading bot. It is currently a `native BTC -> destination asset/chain/platform` strategy measurement and admission system, and the official state remains `liveTrading=BLOCKED` with the active canary held at `hold_dex_quote`.

## Current official operating state

| Item | Current state |
| --- | --- |
| Official live state | `liveTrading=BLOCKED` |
| Shadow state | `shadowTrading=ALLOWED` |
| Prelive stage | `shadow_replay` |
| Active canary | `avalanche->bera wBTC.OFT->wBTC.OFT` |
| Current blocker | `blocked_nonrefreshable_input` |
| Next action | `hold_dex_quote` |
| Readiness | 0% |

## What the system is now

This system is no longer just "one arbitrage loop bot." It has effectively become four connected layers:

1. `native BTC` transport and destination routing
2. strategy family selection by destination asset type
3. destination deployment scoring across venues such as lending, LP, and yield
4. prelive admission and blocker truth surfaces

That means the dashboard should not describe only one canary route. It should describe the full strategy map from BTC into each asset rail, then into each chain and platform, then into each blocker or admission state.

## Top-level flow map

```text
native BTC
├─ 1) BTC -> wrapped BTC rail
│   ├─ wrapped BTC gateway loops
│   ├─ BTC proxy spread
│   ├─ wrapped BTC lending
│   ├─ wrapped BTC LP
│   └─ wrapped BTC destination yield
│
├─ 2) BTC -> stablecoin rail
│   ├─ stable entry/exit loops
│   ├─ treasury parking
│   ├─ stablecoin lending carry
│   └─ stablecoin LP / basis
│
├─ 3) BTC -> ETH-like rail
│   ├─ BTC -> ETH rotation
│   ├─ ETH destination deployment
│   ├─ ETH mixed triangle
│   └─ ETH mixed flash
│
└─ 4) BTC -> other / experimental rail
    ├─ gold proxy rotation
    ├─ custom destination actions
    ├─ partner monetization
    └─ referral monetization
```

## Live route inventory snapshot

Current measured route inventory from the native BTC opportunity surface:

- 21 live native BTC routes
- 9 destination chains: `base`, `ethereum`, `bsc`, `bob`, `bera`, `unichain`, `avalanche`, `sonic`, `soneium`
- destination family mix:
  - wrapped BTC: 10
  - stablecoin: 5
  - ETH-like: 3
  - gold/other: small tail

## Formal strategy catalog

### BTC branches

| Strategy code | Flow | Current status | Interpretation |
| --- | --- | --- | --- |
| `gateway_wrapped_btc_loops` | `BTC -> wrapped BTC -> BTC family` | `thin_coverage` | Loop surface exists, but measured coverage is still thin |
| `btc_proxy_spreads` | `stable -> BTC proxy -> rebalance` | `thin_coverage` | Some opportunities exist, but data density is weak |
| `stablecoin_entry_exit_loops` | `BTC <-> USDC/USDT` | `measured_below_policy` | Measured, but below minimum policy threshold |
| `triangular_flash_btc` | `USDC -> cbBTC/tBTC/LBTC -> USDC` | `measured_below_policy` | Experimented and measured, but not policy-passing |

### ETH branches

| Strategy code | Flow | Current status | Interpretation |
| --- | --- | --- | --- |
| `eth_family_gateway` | `BTC -> ETH-family asset` | `unobserved` | No measured multichain ETH-family gateway surface yet |
| `eth_mixed_stable_loops` | `ETH <-> stable` mixed loop | `unobserved` | No measured mixed ETH/stable closed loop yet |
| `eth_dex_spread_mixed` | ETH/BTC/stable mixed triangle | `analysis_only` | Investigated, but contract path is not generalized |
| `eth_mixed_flash` | mixed flash branch | `analysis_only` | Not promoted beyond analysis |

Important note: ETH was not skipped. It was investigated and currently has no confirmed measured edge, so it remains in observation and analysis states.

## Chain and platform map

| Chain | Main incoming asset rail | Example venues/platforms | Strategy use today | Current reading |
| --- | --- | --- | --- | --- |
| Base | `wBTC.OFT`, `USDC`, `ETH` | Moonwell, Aerodrome, Lombard/LBTC | lending, LP, stable loops, triangle/flash | highest strategy density, but many branches remain below policy or review-only |
| BSC | `wBTC.OFT`, `USDC/USDT`, `ETH` | Venus, PancakeSwap, THENA, xSolvBTC | lending, LP, stable loops, yield | broader surface than live readiness |
| BOB | `wBTC.OFT`, `uniBTC` | Avalon, Gamma | lending, LP, wrapped BTC deployment | central BTC destination, but some rate surfaces still incomplete |
| Berachain | `wBTC.OFT` | Dolomite, Kodiak, Solv-related candidates | lending, LP, destination yield candidates | promising destination side, but active route plumbing is still blocked |
| Avalanche | `wBTC.OFT` | BENQI, LFJ | lending, LP, active canary source side | economically blocked on the current canary path |
| Sonic | `wBTC.OFT` | Shadow | LP, route readiness checks | LP visible, lending venue still missing |
| Soneium | `wBTC.OFT` | KYO | LP candidate | LP visible, lending venue still missing |
| Unichain | `wBTC.OFT` | Catex | LP proxy candidate | proxy/LP surface exists, direct lender-facing venue is weak |
| Ethereum | `WBTC`, `USDC/USDT`, `ETH`, `PAXG/XAUT` | evidence-gated deployment surfaces | ETH-family, stable, gold proxy research | candidate lane once fee, unwind, and BTC return-path evidence clear |

## Destination deployment layer

The allocator has moved beyond simple route counting. It now scores destination families such as:

- wrapped BTC lending
- wrapped BTC LP
- wrapped BTC destination yield
- stablecoin lending carry
- stablecoin LP / basis
- treasury parking
- rotation and monetization branches

Current allocator snapshot:

| Metric | Value |
| --- | --- |
| allocator stage | `stage_5_destination_scoring` |
| plan progress | `8/9` stages complete |
| promotable count | 14 |
| allocation-ready count | 4 |
| review-only count | 10 |

This distinction matters. "Promotable" does not mean "ready for real capital." A large share of the surface is still blocked by repeated-observation requirements on volatile fields such as return and unwind slippage.

## Reality check on recent onchain activity

There is evidence of recent experimental onchain transactions in `data/canary-session.jsonl`, including `dryRun:false` rows with transaction hashes on 2026-04-13 for Base BTC-derivative triangle or flash-style experiments such as:

- `USDC -> tBTC -> LBTC -> USDC`
- `USDC -> cbBTC -> tBTC -> USDC`
- `USDC -> LBTC -> cbBTC -> USDC`

However, this must not be interpreted as official live approval.

### Correct interpretation

| Statement | True or false |
| --- | --- |
| Some recent onchain experimental transactions happened | True |
| The main system is currently live-approved | False |
| The active gateway canary is still blocked | True |
| The project is currently operating in official live mode | False |

## Why the active canary is still blocked

The active route is `avalanche->bera wBTC.OFT->wBTC.OFT`.

Two truths matter at the same time:

1. the route can look operationally advanced
2. it is still not admissible

The current reasons are:

- net edge is negative on the active path
- destination DEX quote coverage is structurally blocked for the current surface
- the correct operator instruction is therefore `hold_dex_quote`, not endless quote refresh

This blocker classification is important because it keeps the dashboard truthful. The system should show that the route is blocked, not merely stale.

## What is easy to misunderstand today

### 1. The active canary is not the whole system

If the dashboard over-focuses on the single active canary, the system looks much smaller than it really is. The active route is only one validation path inside a larger BTC allocator and strategy evidence framework.

### 2. Promotable is not allocation-ready

The dashboard should separate:

- promising and measurable
- review-only
- allocation-ready
- prelive-blocked
- live-blocked

Without this, users may confuse "good candidate" with "ready for money."

### 3. Not all blockers mean the same thing

The dashboard should distinguish at least these blocker types:

- below policy or no net edge
- no current destination venue
- no official rate surface
- route plumbing or DEX quote blocker

These should not be collapsed into one generic red state.

### 4. ETH should be shown as investigated, not ignored

The correct ETH explanation is:

- no measured multichain ETH-family gateway surface yet
- no measured mixed ETH/stable closed loop yet
- ETH mixed triangle and flash remain analysis-only
- Ethereum L1 is allowed when positive EV clears measured fee and unwind thresholds
- therefore `liveTrading` remains `BLOCKED`

## Recommended dashboard structure

The clearest information architecture is:

1. starting asset: `native BTC`
2. destination asset rail: wrapped BTC, stablecoin, ETH-like, other
3. strategy family: loops, spreads, lending, LP, yield, rotation, monetization
4. execution state: research, measured_below_policy, review_only, allocation_ready, prelive_blocked, live_blocked

Each strategy card should show:

- starting asset
- converted asset
- destination chain
- venue/platform
- unwind-back-to-BTC path
- evidence sample count
- freshness
- blocker
- current stage
- next action

## Objective assessment

### Strengths

- The system is structurally richer than a simple arbitrage bot.
- Native BTC allocation logic is now broad enough that one blocked route does not define the whole system.
- Blocker truth has improved: `hold_dex_quote` is a better operator state than an endless refresh loop.

### Weaknesses

- The dashboard mental model still overweights the active canary.
- Evidence quality is weaker than strategy naming density.
- Experimental onchain history can be mistaken for official live status.
- ETH can be misread as unbuilt when it is actually measured-and-not-confirmed.

### Final evaluation

The system should currently be described as a `BTC allocator + strategy evidence gate`, not as an already-running live strategy engine. The right next step is not dashboard optimism but clearer separation between:

- what exists conceptually
- what is measured
- what is promotable
- what is allocation-ready
- what is still blocked

## Dashboard copy draft

### System description

BOB Claw routes native BTC into multiple destination chains and asset rails, then scores arbitrage, yield, lending, LP, and rotation strategies by measured unwind-back-to-BTC economics.

### Current state

The system is currently in shadow/prelive validation, not in live operation. `liveTrading` remains `BLOCKED`, and the active canary is held by negative net edge and blocked destination DEX quote coverage.

### Active canary note

The current active canary is `avalanche -> bera wBTC.OFT`. It is one validation route within a larger strategy universe, not the entire system.
