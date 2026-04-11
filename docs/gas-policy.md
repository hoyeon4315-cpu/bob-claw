# Gas Policy

Last updated: 2026-04-11

## Rule

No route is executable unless expected profit remains positive after:

- Gateway token fee
- Gateway `tx.value` / messaging cost
- source-chain transaction gas
- Bitcoin network fee when a native Bitcoin leg is involved
- destination-chain execution cost when exposed
- DEX swap gas
- DEX swap fee
- price impact
- failed transaction expected cost
- gas shock buffer

## Current Implementation

Implemented now:

- `npm run gas:snapshot` collects live `eth_gasPrice` and latest block from configured public RPC endpoints.
- `npm run estimate:gateway-gas` attempts read-only `eth_estimateGas` against stored Gateway quote transactions when `tx.data` is available.
- `npm run check:estimator-wallet` checks whether the public estimator address has enough native balance, source-token balance, and allowance for the stored Gateway quote set.
- `npm run bitcoin:fees` collects a live Bitcoin fee recommendation from mempool.space and converts the selected sat/vB rate into an estimated USD cost.
- `npm run score:gateway` uses successful Gateway gas estimates first, then falls back to source-chain gas snapshots for cost display.
- The scoring layer applies a 2x gas buffer to the sampled source-chain fallback transaction gas.
- The Bitcoin fee model uses `halfHourFee` by default and a 180 vbyte single-input/single-output estimate unless overridden with `--vbytes=`.
- EVM routes without successful exact Gateway gas estimates are blocked from candidate readiness with `exact_src_execution_gas_not_estimated`.
- Estimator-wallet readiness is tracked separately so `insufficient_funds` and missing allowance are not confused with route profitability.

Not implemented yet:

- successful exact `eth_estimateGas` across each Gateway quote transaction with a funded sender and required token balances/allowances
- exact DEX swap gas
- exact native Bitcoin transaction weight for each future wallet UTXO set
- destination-chain execution receipt reconciliation
- gas percentile history

## Execution Gate

Before live execution, the bot must run a fresh gas check immediately before signing.

Required conditions:

1. Fresh Gateway quote is available.
2. Fresh gas snapshot is available for the source chain.
3. Exact `eth_estimateGas` succeeds for the transaction when possible.
4. A fresh Bitcoin fee snapshot exists when the route touches native Bitcoin.
5. Net profit remains above both thresholds:
   - `MIN_NET_PROFIT_USD`
   - `MIN_NET_PROFIT_PCT`
6. Net profit also survives the configured gas shock buffer.

If gas spikes between detection and execution, the trade is skipped.

## Early Observation

In the first gas snapshot, normal EVM source transaction gas was mostly much smaller than Gateway `tx.value` movement cost. This does not make gas irrelevant. It means the current dominant route cost is Gateway/messaging cost, while EVM gas still needs a shock buffer and execution-time check.
