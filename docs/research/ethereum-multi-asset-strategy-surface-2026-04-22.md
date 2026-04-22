# Ethereum + Multi-Asset Strategy Surface

Date: 2026-04-22

## Executive summary

BOB Claw should stay BTC-denominated for accounting and payback, but it should not stay BTC-only in intermediate operating inventory. ETH, stablecoins, tokenized gold, tokenized reserve assets, and selected bluechips can all be valid intermediate sleeves when three conditions hold:

1. entry and unwind are deterministic
2. risk caps and liquidation rules are codified
3. the return path back to BTC is measured, not assumed

This means Ethereum L1 is no longer a blanket `observe-only` lane in planning. It becomes an evidence-gated candidate lane: allowed when fee domain, slippage, unwind latency, and BTC return-path cost are positive-EV after measurement.

## Protocol research notes

### Aave

- Aave documents that V3 `E-mode` increases borrowing efficiency within asset categories and explicitly binds category-specific LTV, liquidation threshold, and borrowing permissions. This makes ETH-collateral to stable-borrow loops structurally relevant when health-factor policy is strict enough.
- Aave also documents GHO borrowing through the Ethereum V3 pool with protocol-managed risk features such as E-mode, isolation mode, and supply caps.
- Official sources:
  - [Aave E-mode](https://aave.com/help/borrowing/e-mode)
  - [Aave GHO](https://aave.com/gho)

### Morpho

- Morpho documents that its markets are isolated and defined by collateral asset, loan asset, LLTV, oracle, and IRM, and that these parameters persist once the market is created.
- Morpho liquidation math is explicit and LTV-driven, which fits deterministic policy enforcement for aggressive but bounded leverage loops.
- Morpho Vaults also expose per-market caps and permissionless isolated market composition, which is useful for ETH collateral, stable borrow, and asset-specific sleeves.
- Official sources:
  - [Morpho market overview](https://legacy.docs.morpho.org/morpho/concepts/overview)
  - [Morpho liquidation](https://legacy.docs.morpho.org/morpho/concepts/liquidation/)
  - [Morpho vaults overview](https://legacy.docs.morpho.org/morpho-vaults/contracts/overview/)

### Euler

- Euler documents two useful surfaces:
  - EVK vaults for lending/borrowing against collateral
  - Euler Earn vaults for capped, queue-managed ERC-4626 allocation
- Euler Earn explicitly exposes per-strategy caps, ordered supply/withdraw queues, and timelocked increases with immediate decreases, which fits a controlled multi-asset sleeve better than ad hoc vault chasing.
- Official sources:
  - [Euler vaults](https://docs.euler.finance/concepts/core/vaults/)
  - [Euler Earn overview](https://docs.euler.finance/developers/euler-earn/)
  - [Euler allocator handbook](https://docs.euler.finance/developers/euler-earn/allocator-handbook/)

### Pendle

- Pendle documents fixed-expiry yield tokenization into PT and YT. PT is the principal claim; YT is the yield-and-reward claim until expiry.
- This gives us a clean fixed-yield or known-expiry sleeve for ETH-family or stable inventory, but the maturity clock means campaign/expiry timing must be modeled directly in policy.
- Official sources:
  - [Pendle yield tokenization](https://docs.pendle.finance/pendle-v2/Developers/Contracts/YieldTokenization)
  - [Pendle yield trading concepts](https://docs.pendle.finance/pendle-academy/optimizing-yields-with-pendle/chapter-5-important-concepts-in-yield-trading)

### Tokenized gold

- Paxos states that each PAXG token is backed by one fine troy ounce of gold in LBMA vaults and highlights redemption pathways.
- Tether Gold's January 27, 2025 relevant information document states that one XAUt token corresponds to one fine troy ounce of gold, primary issuance/redemption is KYC-gated, and the transparency page is updated daily. It also documents that redemption is operationally constrained around full-bar handling and fee schedules.
- That means PAXG/XAUT are valid reserve candidates only if on-chain exit liquidity and BTC return-path cost are measured; issuer and redemption constraints must stay explicit in policy.
- Official sources:
  - [PAXG overview](https://www.paxos.com/pax-gold)
  - [Tether Gold relevant information document, January 27, 2025](https://gold.tether.to/Relevant%20Information%20Document%20-%20TG%20Commodities%2C%20S.A.%20de%20C.V.%20%28ENG%29.pdf)
  - [Tether Gold attestation page](https://gold.tether.to/docs/reports/attestations/ISAE_3000R_-_Opinion_TGRR_30.06.2025_RC187322025BD0179.pdf)

## Strategy families to build

### 1. ETH collateral -> stable borrow

- Base lanes: Aave, Morpho, Euler
- Chains: Ethereum, Base, BSC where route and gas economics justify it
- Why it matters:
  - lets BTC-arrived capital pivot into ETH-family collateral when ETH-side yields or borrow terms are better than wrapped-BTC loops
  - creates a reusable path for ETH directional sleeves plus stable deployment
- Required controls:
  - `healthFactorMin`
  - `liquidationBufferPct`
  - borrow-asset allowlist
  - BTC return-path measurement

### 2. ETH destination lending / fixed-yield sleeve

- Base lanes: Morpho supply, Euler Earn / EVK, Pendle PT
- Why it matters:
  - allows direct deployment of ETH-family arrival assets without forced conversion back into wrapped BTC first
  - broadens the strategy set when BTC-specific carry is weak
- Required controls:
  - maturity-aware unwind policy for Pendle
  - queue liquidity checks for Euler Earn
  - per-market LLTV/oracle reviews for Morpho

### 3. Stable treasury carry / fixed-yield sleeve

- Base lanes: Aave, Morpho, Euler, Pendle
- Why it matters:
  - stable inventory is often the cleanest staging asset for rotating back to BTC
  - can exploit short-lived incentive or borrow-carry windows without forcing BTC wrapper exposure
- Required controls:
  - depeg guard
  - borrow spread floor
  - exact exit liquidity sampling

### 4. Tokenized gold / reserve sleeve

- Base lanes: PAXG, XAUT, USDY, bIB01
- Why it matters:
  - gives a non-BTC, non-fiat reserve sleeve for diversification during thin crypto-native carry regimes
- Required controls:
  - issuer allowlist
  - custody / redemption review
  - on-chain exit liquidity measurements
  - max holding window and market-risk budget

### 5. Other approved bluechip rotation sleeve

- Example families:
  - ETH LST/LRT inventory
  - carefully allowlisted large-cap non-stable assets
- Why it matters:
  - keeps the allocator flexible for temporary incentives without overfitting to one wrapper or one venue
- Required controls:
  - strict allowlist
  - explicit holding cap and duration cap
  - BTC return cost budget

## Coding plan

### Phase A. Strategy scaffolds and classification

- widen discovery/classification from BTC-only to multi-asset but BTC-payback-compatible
- implement repo-native scaffolds for:
  - `eth_destination_deployment`
  - `gateway_native_asset_conversion_sleeve`
  - keep `tokenized_reserve_sleeve` as the reserve / gold sleeve
- map Merkl and other opportunity feeds into these strategy families

### Phase B. Deterministic policy layer

- every non-BTC sleeve needs:
  - unwind route template
  - BTC return-path id
  - max exit slippage
  - max hold time
  - trust-tier / allowlist decision
- ETH leverage sleeves additionally need:
  - health-factor pre/post checks
  - liquidation buffer checks
  - borrow rate spike guard

### Phase C. Measurement + tiny live proofs

- do not rely on dry-run alone
- collect small real receipts for:
  - same-chain entry
  - same-chain unwind
  - destination asset -> BTC return
- promotion rule:
  - transport proof alone is insufficient
  - destination-side position receipt plus unwind receipt plus BTC return-cost measurement are all required

### Phase D. Rotation engine

- discover new opportunities continuously
- rank by:
  - expected net carry after gas/slippage
  - campaign time remaining
  - unwind quality
  - trust tier
  - overfit risk
- rotate only when replacement beats current sleeve after full unwind + re-entry cost

## What changed in repo design from this note

- ETH is treated as an evidence-gated candidate lane, not as a permanent observe-only lane.
- Multi-asset opportunity intake should now accept ETH, stables, gold, reserve assets, and approved bluechips as intermediate inventory.
- BTC remains the accounting and payback unit.

## Objective next steps

1. finish executor adapters for `eth_destination_deployment`
2. finish generic `gateway_native_asset_conversion_sleeve` executor + receipt schema
3. attach BTC return-path scoring to every non-BTC sleeve before promotion
