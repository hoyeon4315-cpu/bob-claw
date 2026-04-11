# Gateway Chain Comparison

Last updated: 2026-04-10

## Live Route Inventory

Current BOB Gateway route inventory:

- Total routes: 113
- Unique chains: 10
- Chains: avalanche, base, bera, bitcoin, bob, bsc, ethereum, soneium, sonic, unichain
- BTC-family routes: 95
- BOB-touching routes: 19

The current live route inventory does not show Arbitrum. Arbitrum should remain a DEX/RPC strategy candidate, not a Gateway-first candidate, unless it appears in Gateway route data later.

## BOB-Centered BTC Route Samples

Sample amount: 10,000 token base units, generally equivalent to 10,000 sats for BTC-family tokens.

| Route | Quote Type | Output | Est. Time | Extra Native Cost | Early Read |
|---|---:|---:|---:|---:|---|
| bitcoin -> bob | onramp | ~9,950 | ~514s | n/a | usable quote, slow settlement |
| bob -> bitcoin | offramp | ~9,531 | ~386s | n/a | too expensive for normal exit |
| bob -> base | layerZero | 10,000 | 60s | ~$0.77 | viable movement, not profit alone |
| base -> bob | layerZero | 10,000 | 60s | ~$0.75 | viable movement, prior fast polling caused failures |
| bob -> avalanche | layerZero | 10,000 | 60s | ~$0.76 | comparable to Base |
| avalanche -> bob | layerZero | 10,000 | 60s | ~$0.75 | comparable to Base |
| bob -> bera | layerZero | 10,000 | 60s | ~$0.76 | comparable to Base |
| bera -> bob | layerZero | 10,000 | 60s | ~$0.76 | comparable to Base |
| bob -> bsc | layerZero | 10,000 | 60s | ~$0.78 | comparable, BNB funding needed for reverse |
| bsc -> bob | layerZero | 10,000 | 60s | ~$0.74 | comparable |
| bob -> ethereum | layerZero | 10,000 | 60s | ~$0.84 | observe only in USD 300 phase |
| ethereum -> bob | layerZero | 10,000 | 60s | ~$0.75 | observe only in USD 300 phase |
| bob -> soneium | layerZero | 10,000 | 60s | ~$0.76 | comparable |
| soneium -> bob | layerZero | 10,000 | 60s | ~$0.77 | comparable |
| bob -> sonic | layerZero | 10,000 | 60s | ~$0.76 | comparable |
| sonic -> bob | layerZero | 10,000 | 60s | ~$0.73 | comparable |
| bob -> unichain | layerZero | 10,000 | 60s | ~$0.76 | comparable |
| unichain -> bob | layerZero | 10,000 | 60s | ~$0.77 | comparable |

Native cost uses a live CoinGecko spot check during reporting. Treat it as approximate and refresh before scoring opportunities.

## Objective Takeaways

1. BOB Gateway is useful for moving BTC-family liquidity across many chains, but layerZero routes are not profit by themselves.
2. For USD 300, a ~$0.75 route cost is material. A round trip is roughly $1.5 before any external swap fees or gas.
3. At around 200,000 sats, roughly USD 143 in the latest sample, one-way LayerZero break-even costs were roughly 0.51-0.59 percent.
4. The `bob -> bitcoin` route is currently unattractive for arbitrage at small size because quoted output was only ~95.31 percent at 10,000 sats. At 200,000 sats it improved, but still needed roughly 0.63 percent before other risks.
5. Bitcoin onramp/offramp settlement times can be several minutes, which makes stale-price risk too high for tight arbitrage.
6. The better Phase 0 target is not "bridge everywhere"; it is "find chains where local DEX price dislocation exceeds Gateway movement cost."

## Current Ranking For Further Shadow Research

1. BOB <-> Sonic
2. BOB <-> BSC
3. BOB <-> Avalanche
4. BOB <-> Base
5. BOB <-> Soneium
6. BOB <-> Unichain
7. BOB <-> Bera
8. BOB <-> Ethereum, observe only
9. BOB <-> Bitcoin native, observe only

This ranking is based only on the first route-cost and latency samples. It is not a live trading ranking yet.

## Harness Issues Found And Fixed

- Added route selection modes for all routes, BTC-family routes, and BOB-neighbor routes.
- Added one-route-per-chain-pair selection to avoid duplicated token variants when comparing chains.
- Added Bitcoin recipient support so `dstChain=bitcoin` quotes do not fail with an EVM address.
- Added route inventory reporting.
- Added native-cost USD conversion in the gateway report.
- Kept request delay because fast polling triggered Cloudflare challenge responses.
