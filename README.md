# BOB Claw

BOB Claw is a native-BTC payback agent. Operator BTC enters through BOB Gateway, is deployed into destination-chain strategies under committed caps, and realized profit is accounted in sats first before the payback scheduler sends eligible profit share back to Bitcoin L1.

The runtime is deterministic: LLMs may edit code and configs, but they do not decide trades, payback timing, or signing. Live execution flows through strategy caps, policy checks, signer approval, kill-switch checks, and receipt proof.

## Current Operating Loop

Run the unattended multichain loop:

```bash
npm run executor:all-chain-autopilot -- --json --write --execute
```

The loop refreshes gas, optionally bootstraps BTC-L1 capital into a score-weighted multichain target vector, plans treasury/capital refills (bidirectional: shortfall refill + over-target drain), executes auto-eligible refills, runs live canaries, refreshes Merkl and destination allocator state, runs representative destination canaries, dispatches strategy surfaces, ticks payback, snapshots BTC oracles, and evaluates auto-kill triggers.

To bootstrap from BTC-only on Bitcoin L1, pass the wallet sats and the current BTC price; the autopilot computes a score-weighted target across promotable chain × strategy candidates and routes capital accordingly:

```bash
npm run executor:all-chain-autopilot -- --execute --write \
  --bootstrap-btc-sats=<sats> --bootstrap-btc-price-usd=<usd>
```

Or compute the bootstrap plan in isolation:

```bash
npm run executor:bootstrap-from-btc -- --total-capital-usd=<usd> --write
```

Already-scattered assets (e.g., USDC dropped on BSC, surplus wBTC.OFT on a chain with no target) drain back to score-weighted targets via `capital_drain` actions emitted by the same loop.

For readiness only:

```bash
npm run gas:snapshot
npm run ops:full-automation-readiness -- --json
npm run report:allocator-core -- --json --write
npm run report:strategy-execution-surfaces -- --json --write
```

## Allocation Model

Allocator scoring is deterministic and evidence-bound. Candidates are scored across:

- evidence quality
- execution readiness
- protocol/chain risk
- expected return
- diversification value

As of the latest operating pass, active allocation is aimed at Base, BSC, and Unichain stable carry plus Base wrapped-BTC lending when cbBTC collateral is actually present. Avalanche and Berachain remain review-only until repeated unwind/slippage observations clear. Sonic, Soneium, and other indirect stable lanes stay blocked until their local trusted DEX conversion paths are proven live.

## Safety Invariants

- Caps live in committed config, not runtime env.
- The signer holds keys; strategy modules emit intents only.
- The kill switch file halts signer broadcasts and payback offramps.
- Unknown inbound tokens go to pending whitelist, never auto-whitelist.
- Payback is sats-first and remains carry-only until the configured minimum is reached.

## Useful Commands

```bash
npm run report:strategy-catalog -- --json
npm run report:payback-status -- --json
npm run plan:treasury-refill-jobs -- --json
npm run plan:capital-manager-refill-jobs -- --json --write
npm run executor:merkl-portfolio-orchestrator -- --json --write --execute
npm run executor:wrapped-btc-loop-handoff -- --amount-sats=<sats> --json
npm run status:dashboard
npm run graph:focus -- status
```

Detailed documentation starts in [docs/README.md](docs/README.md).
