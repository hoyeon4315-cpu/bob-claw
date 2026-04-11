# Objective Gate - 2026-04-10

## Decision

Proceed to the next stage: DEX executable quote integration and longer shadow scanning.

Do not proceed to live trading.

After the overfit audit and first net-edge scoring pass, the next stage is refined further: build shadow scanning depth and external executable pricing before any canary.

## Evidence

- Syntax checks pass.
- BOB Gateway API is reachable.
- Current live route inventory has 113 routes across 10 chains.
- BOB public copy has described 11 connected EVM chains, including Optimism and Sei, but the current live Gateway route API returns 10 chains and omits Optimism and Sei.
- BOB-neighbor route sampling works with slow polling.
- Quote response shapes are now separated into `onramp`, `offramp`, and `layerZero`.
- Bitcoin destination routes now use a Bitcoin recipient address for quote validation.
- Native transaction value is now converted into approximate USD cost.
- Live gas snapshots are now collected separately and included in Gateway scoring with a buffer.
- Token decimals are now resolved per token instead of assuming every quote is BTC-denominated.
- Net-edge scoring now applies conservative token pricing, tx value, execution gas, gas shock buffer, stale-gas blocking, and value-ratio sanity checks.
- Route-level quote failure rate now blocks otherwise positive candidates when failures exceed the review threshold.
- `data/gateway-scores.json` is written by `npm run score:gateway`.
- Dashboard status now exposes an announced-chain gap so Optimism/Sei absence is visible without drawing inactive routes.
- Odos read-only executable DEX quotes are now collected with `npm run quote:dex` and stored in `data/dex-quotes.jsonl` / `data/dex-quote-failures.jsonl`.
- Gateway scoring now attaches matching destination-leg DEX quotes and calculates executable output/net-edge fields separately from reference-price fields.
- Bitcoin fee snapshots are now collected with `npm run bitcoin:fees` from mempool.space recommended fees and included in Gateway scoring for routes touching native Bitcoin.
- Gateway quote records now store EVM transaction calldata when the API returns it, and `npm run estimate:gateway-gas` performs read-only gas preflight attempts.

## Current Net-Edge Result

Latest read-only score pass:

- Scored quotes: 63
- Shadow candidates: 0
- Stale gas: 0 after refreshing gas snapshots
- Missing decimals: 0
- DEX-backed scores: 4
- Exact Gateway gas estimate successes: 0
- Exact Gateway gas preflight failures: 8
- High-failure routes: 10
- Rejected by net cost: 0 after exact-gas gating
- Insufficient data: 47

The best-looking positive line was not a candidate. A `solvBTC` quote produced an implausible USD value ratio after on-chain decimals resolution, so the scorer marks it as `implausible_quote_value_ratio`.

Bitcoin onramp/offramp routes no longer carry the generic `bitcoin_network_fee_not_modelled` gap after a fresh Bitcoin fee snapshot exists. Latest snapshot: 4 sat/vB, 180 vbytes, 720 sats, about USD 0.53 at BTC/USD 72,988. They still remain observe-only because the model is an estimate, not a wallet/UTXO-specific execution cost or settlement-risk proof.

EVM-to-EVM Gateway movement routes with fresh gas were rejected by net edge; sampled one-way movement was negative after native tx value and gas buffer.

Exact EVM gas remains a hard gate. The preflight can only succeed when the simulated sender also satisfies the quote's value, token balance, and allowance assumptions. With the current verification address, failures are expected and are recorded instead of being treated as executable proof. Latest preflight result: 7 older quotes lacked stored `tx.data`; 1 fresh BOB -> Base quote had calldata but failed with `insufficient_funds`.

Estimator-wallet readiness is now measured separately from gas preflight. This keeps route quality and wallet readiness from being mixed together: a route may still be unattractive even when the wallet is ready, and a route may stay blocked simply because the estimator address lacks native balance or ERC20 allowance.

First Odos executable quote pass:

- Provider: Odos `/sor/quote/v3`
- Successful DEX quotes: Ethereum, Base, and BSC samples
- Expected skips: Bitcoin legs and stablecoin-to-itself legs
- Observed failure: one Ethereum native ETH quote failed at provider level

These DEX quotes are reference execution prices only. They do not authorize live trading.

The scorer keeps reference and executable values separate:

- `netEdgeUsd`: CoinGecko/reference-price view
- `executableNetEdgeUsd`: DEX quote backed view when a matching destination-leg quote exists

Routes without matched DEX quotes are not promoted by this step; they remain observable data.

## Current Cost Reality

At 10,000 sats, most BOB-neighbor EVM routes have break-even costs around 10-12 percent because the fixed native cost dominates.

At 200,000 sats, roughly USD 143 at the sampled BTC price, most BOB-neighbor EVM routes have one-way break-even costs around:

- best observed: about 0.51 percent
- common range: about 0.52-0.54 percent
- higher observed: about 0.59 percent

This means a round trip needs roughly 1.0-1.2 percent before external swap fees, DEX price impact, failed transaction expectation, and safety margin.

## Objective Blockers Before Live Trading

1. External DEX executable quote coverage is partial; the first Odos pass has only four matched Gateway destination-leg quotes.
2. No independent pool liquidity, depth, or price-impact history check is integrated yet.
3. Exact `eth_estimateGas` preflight exists, but successful estimates require a funded/approved canary sender.
4. Bitcoin network fee is estimated, but settlement-risk and UTXO-specific execution cost are not proven yet.
5. No wallet, signer, or allowance logic exists yet.
6. Current Gateway samples are too few for reliability.
7. Ethereum L1 routes remain observe-only for the USD 300 phase.
8. Native Bitcoin onramp/offramp routes remain observe-only because settlement time and exit cost are not yet attractive.

## Next Stage Scope

Build a shadow opportunity scanner that combines:

- Gateway quote cost
- BTC reference price
- source-chain and destination-chain DEX reference prices
- estimated swap fees
- estimated price impact
- route latency
- quote failure rate
- gas percentile history
- quote decay
- amount ladder coverage
- token decimal verification
- quote value-ratio sanity checks

The output should be:

- `tradeable=false` by default
- required edge percent
- observed edge percent
- reason codes for rejection
- mobile dashboard status JSON
- overfit audit status

Do not promote any route to canary review until the net edge survives executable DEX quotes, p95 gas, Bitcoin network fee if relevant, quote failure probability, amount-ladder checks, and wallet/UTXO-specific Bitcoin cost checks.

## Capital Rule

The USD 300 ring-fenced wallet rule remains active.

If capital grows later, sizing may increase only when route capacity and realized PnL prove that the edge scales. Compounding is allowed only after realized positive expectancy, not paper expectancy.
