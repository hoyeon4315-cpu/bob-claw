# BSC Venus First-Canary Readiness

Date: 2026-05-08

This is a report-only scaffold for assessing a BSC Venus first canary through the existing Merkl/campaign orchestration surface. It does not create a new strategy lane, does not enter catalog dispatch, and does not change caps, payback ratio, payback timing, or payback trigger logic.

## Runtime Boundary

- `autoExecute`: false
- `catalogDispatchEligible`: false
- `strategyLaneCreated`: false
- Runtime authority: none
- Mapped surface: existing Merkl canary queue and campaign-aware destination-yield review

## Required Proofs

- Current Merkl campaign data for the BSC opportunity.
- Venus binding and reader return explicit ok/error envelopes.
- Supported executor binding exists before any live intent can be considered.
- Deterministic entry, exit, reward claim, reward swap, and unwind paths are specified.
- Reward-token haircut and exit-liquidity proof are present at canary notional.
- Gas, claim, swap, bridge, and exit costs are measured before EV admission.
- Entry and exit/unwind receipt proof path is committed.
- Standard kill-switch, policy engine, signer isolation, audit log, and no-LLM-signing rules remain unchanged.

## Current Readiness

The scaffold is intentionally non-executable. Its only purpose is to keep BSC Venus evidence visible without opening a side-channel around the existing catalog, Merkl orchestrator, or radar policy surfaces.
