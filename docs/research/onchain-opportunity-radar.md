# Onchain Opportunity Radar

Status: Phase 0-6 internal pipeline implemented; aggressive live-canary router is gated on `calibrated_aggressive_v1`, committed tiny caps, realized-net-PnL EV, reward-exit proof, radar lock, and the existing proposer -> policy -> signer path.

## Purpose

Onchain Opportunity Radar is a read-only discovery layer for observing strategy-like behavior across chains, protocols, wallets, and venues. It does not execute trades, mutate caps, flip `autoExecute`, decide payback timing, or call the signer.

The radar treats other users' transactions as evidence that behavior occurred. It does not treat those transactions as proof that BOB Claw can profit from the behavior.

## Scope Split

Discovery scope is deliberately broad:

- BOB Gateway destination chains.
- Non-Gateway EVM chains, marked as `post_gateway_manual_bridge` or `out_of_scope`.
- Non-EVM venues, marked observation-only until a deterministic policy/signer path exists.

Execution scope remains narrow:

- Existing proposer -> policy -> signer -> receipt ledger path only.
- Existing committed caps only.
- Existing kill-switch and auto-kill checks only.
- Realized net PnL must be positive after measured costs for strategy graduation.
- BTC/sats-first reporting and payback conversion remain mandatory; BTC-relative underperformance is reported but is not by itself a hard blocker when realized net PnL is positive and the payback conversion path is proven.

## Stage Model

| Stage | Meaning | Allowed Claim |
|---|---|---|
| `Observed` | Raw tx/log/source facts exist | The behavior happened |
| `Strategy Hypothesis` | Observations are grouped into an episode | The behavior resembles a known pattern |
| `Portable` | Replay and portability evidence are present | The behavior may be portable |
| `Executable` | Existing policy/executor path can express it | It is a tiny canary candidate |
| `Self-realized` | BOB Claw receipts close the loop | BOB Claw realized net PnL, with BTC conversion accounting |

External wallet PnL claims remain unverified unless the radar replay engine reconstructs the result from raw receipts. Phase 0 does not implement replay.

## Implemented Artifacts

- `src/config/radar-policy.mjs` records deterministic stage names and unresolved threshold slots.
- `src/config/radar-source-allowlist.mjs` records what each source can and cannot prove.
- `src/strategy/radar/schema/*.mjs` validates the first evidence packet shapes.
- `src/strategy/radar/observation-ingest.mjs` appends validated observations to private radar JSONL.
- `src/strategy/radar/strategy-episode-builder.mjs` builds provisional strategy episodes from observations.
- `src/strategy/radar/portable-packet-builder.mjs` requires closed positive self-replay evidence before portability.
- `src/strategy/radar/executable-candidate-gate.mjs` evaluates executable candidates without calling signer or mutating caps. It admits `gateway_destination`, `base_native_evm`, and `gateway_to_evm_bridged` only under aggressive calibration.
- `src/strategy/radar/family-binding-registry.mjs` maps portable families to existing strategy ids and explicitly blocks managed-only/point surfaces.
- `src/strategy/radar/pnl-ev-gate.mjs` computes realized-net-PnL EV after reward haircut and p90 costs.
- `src/strategy/radar/cost-ledger.mjs` builds sparse-sample-buffered p90 cost lookups from signer audit records.
- `src/strategy/radar/radar-candidate-router.mjs` builds `tiny_live_canary` intents for the existing queue path; it never signs.
- `src/strategy/radar/realization-record-ingest.mjs` folds realization records and separates strategy realization from payback delivery.
- `src/strategy/radar/cap-graduation-review.mjs` computes cap raise candidates from receipt-backed positive realized PnL without mutating caps.
- `src/strategy/radar/radar-board.mjs` builds a sanitized board summary.
- `src/status/radar-slice.mjs` converts the sanitized board into a public dashboard slice.
- `src/cli/radar-ingest.mjs` ingests an observation JSON file.
- `src/cli/radar-promote.mjs` previews or writes radar canary intents; `--execute` writes a queue file only and still does not call the signer.
- `src/cli/report-radar-board.mjs` reports the sanitized radar board.
- `src/cli/report-radar-cap-review.mjs` reports cap raise candidates; it never edits config.
- `src/status/current-dashboard-context.mjs` folds private `data/radar/*.jsonl` files into `dashboard-status.json` as aggregate counts only.
- `test/radar-*.test.mjs` locks schema, stage predicates, CLI behavior, and import boundaries.

Thresholds are now committed under `RADAR_POLICY.calibrationStatus === "calibrated_aggressive_v1"` as an operator-risk-defined v1. They are not a claim of statistical finality. Changing them still requires a committed diff.

## Realization vs Payback

`strategyRealized`, positive realized PnL, and `paybackDelivered` are separate lifecycle states.

- `strategyRealized` means entry/claim/exit/swap receipts close with non-null measured PnL.
- `positiveRealizedPnl` means realized net PnL is positive after all measured costs. USD/NAV PnL can be positive even when BTC-relative sats PnL is negative during a BTC rally; that is not a hard blocker for cap graduation.
- `paybackDelivered` means Bitcoin L1 destination delivery proof exists.

Do not require payback delivery before recording a strategy realization. Do not call a payback delivered until Bitcoin L1 destination proof exists.

## Aggressive Live-Canary Router (Phase 6)

When `RADAR_POLICY.calibrationStatus === "calibrated_aggressive_v1"`, the router may take an `Executable` candidate whose family resolves to a registered binding and emit a sized canary intent. The router does not call the signer directly; it writes an intent into the existing proposer queue. Sizing path:

1. Resolve `familyBinding(candidate) -> strategyId`.
2. Require `tinyLivePerTxUsd` on that strategy's caps; never fall back to `perTxUsd`.
3. Compute expected realized net PnL after reward haircut, p90 gas/bridge/claim/swap costs, and dynamic hold time.
4. Require reward-token exit liquidity proof for non-stable rewards at least 3x canary notional.
5. Reject if expected realized net PnL is not positive after the measured cost variance buffer.
6. Emit intent with `mode: "live"` and `metadata.radarCandidateId`.
7. On receipt, call `realization-record-ingest` and later `cap-graduation-review`.

BTC accounting is still required: the realized positive PnL share selected by payback policy is converted into native BTC and logged as the payback leg. The router is read-only against caps and policy: it never raises a cap, never bypasses a blocker, and never decides runtime signing.

## Committed Canary Ladder

Radar is not observation-only. Once a candidate becomes executable, the Merkl/radar canary autopilot uses `SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation` as a committed sizing ladder:

- Start at the first rung for Base-style entries, with an Ethereum gas-efficiency floor.
- Move to higher rungs only from receipt evidence: delivered txs, positive realized net PnL, and distinct campaign/opportunity windows.
- Treat no-tx policy rejections as neutral so cooldown or kill-switch guards do not poison the ladder.
- Pause the ladder after substantive on-chain failures or realized loss lock breach.
- Clamp every rung by `tinyLivePerTxUsd`, per-chain caps, inventory, and the policy engine.

This is automatic execution sizing inside predeclared caps, not a runtime cap mutation. Raising strategy caps above the committed ladder remains a committed diff.

## Cap Graduation Memory

The operator does not need to remember when to raise caps. `npm run radar:cap-review` reads radar realization records and surfaces cap raise candidates only when:

- At least two live canaries in the same strategy/family closed with positive realized net PnL.
- Entry and exit/unwind receipts exist.
- At least two distinct campaign windows or opportunity ids are represented.
- The radar lane has not tripped its 24h realized-loss lock.
- The strategy has a committed `tinyLivePerTxUsd`.

The output is advisory. Any cap increase remains a committed diff to `src/config/strategy-caps.mjs`.

## Source Provenance

Every source must state:

- `proves`
- `cannotProve`
- `freshnessFields`
- `reconciliationRequired`
- provider access status

Provider-backed labels such as Nansen, Arkham, and Cielo are Phase 0 placeholders with `unverified_provider_access`. They cannot drive promotion until access, freshness, and terms are verified.

## Explicit Non-Goals

- No direct signer calls or policy bypass from radar.
- No uncapped live execution.
- No source adapters.
- No external API calls.
- No dashboard raw JSONL exposure.
- No automatic strategy cap changes above the committed canary ladder.
- No payback policy changes.
- No auto-whitelisting unknown tokens.
- No Solana, Hyperliquid, or other non-EVM executor code.

## Remaining Unknowns

- External provider access for Nansen, Arkham, and Cielo is unverified.
- Replay engine integration with raw chain RPC is not implemented.
- Direct executor adapters are not called by Radar; Radar emits intents/queues for the existing deterministic execution path.
- Payback policy is unchanged; only the interpretation of strategy PnL vs BTC payback conversion is clarified.

## Next Build Step

The next step is a replay-engine prototype that reconstructs closed reference-wallet episodes from raw receipts only. It should still emit `unknown` when attribution crosses CEX, mixer, Lightning, or unlabeled hops.
