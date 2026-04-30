# Onchain Opportunity Radar

Status: Phase 0-5 internal pipeline implemented.

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
- BTC/sats-first accounting only.

## Stage Model

| Stage | Meaning | Allowed Claim |
|---|---|---|
| `Observed` | Raw tx/log/source facts exist | The behavior happened |
| `Strategy Hypothesis` | Observations are grouped into an episode | The behavior resembles a known pattern |
| `Portable` | Replay and portability evidence are present | The behavior may be portable |
| `Executable` | Existing policy/executor path can express it | It is a tiny canary candidate |
| `Self-realized` | BOB Claw receipts close the loop | BOB Claw realized sats-first PnL |

External wallet PnL claims remain unverified unless the radar replay engine reconstructs the result from raw receipts. Phase 0 does not implement replay.

## Implemented Artifacts

- `src/config/radar-policy.mjs` records deterministic stage names and unresolved threshold slots.
- `src/config/radar-source-allowlist.mjs` records what each source can and cannot prove.
- `src/strategy/radar/schema/*.mjs` validates the first evidence packet shapes.
- `src/strategy/radar/observation-ingest.mjs` appends validated observations to private radar JSONL.
- `src/strategy/radar/strategy-episode-builder.mjs` builds provisional strategy episodes from observations.
- `src/strategy/radar/portable-packet-builder.mjs` requires closed positive self-replay evidence before portability.
- `src/strategy/radar/executable-candidate-gate.mjs` evaluates executable candidates without calling signer or mutating caps.
- `src/strategy/radar/realization-record-ingest.mjs` folds realization records and separates strategy realization from payback delivery.
- `src/strategy/radar/radar-board.mjs` builds a sanitized board summary.
- `src/cli/radar-ingest.mjs` ingests an observation JSON file.
- `src/cli/report-radar-board.mjs` reports the sanitized radar board.
- `test/radar-*.test.mjs` locks schema, stage predicates, CLI behavior, and import boundaries.

Threshold values such as `clusterConfidenceMin`, `portableWalletSetMin`, `protocolAgeDaysMin`, TVL floors, slippage floors, and MEV scores are intentionally `null` in Phase 0. The current repository does not contain calibration data that justifies concrete values.

## Realization vs Payback

`strategyRealized` and `paybackDelivered` are separate lifecycle states.

- `strategyRealized` means entry/claim/exit/swap receipts close with non-null BTC-denominated net realized PnL.
- `paybackDelivered` means Bitcoin L1 destination delivery proof exists.

Do not require payback delivery before recording a strategy realization. Do not call a payback delivered until Bitcoin L1 destination proof exists.

## Source Provenance

Every source must state:

- `proves`
- `cannotProve`
- `freshnessFields`
- `reconciliationRequired`
- provider access status

Provider-backed labels such as Nansen, Arkham, and Cielo are Phase 0 placeholders with `unverified_provider_access`. They cannot drive promotion until access, freshness, and terms are verified.

## Explicit Non-Goals

- No live execution.
- No source adapters.
- No external API calls.
- No dashboard raw JSONL exposure.
- No strategy cap changes.
- No payback policy changes.
- No auto-whitelisting unknown tokens.
- No Solana, Hyperliquid, or other non-EVM executor code.

## Remaining Unknowns

- Concrete thresholds remain `null` because no calibration dataset has been accepted.
- External provider access for Nansen, Arkham, and Cielo is unverified.
- Replay engine integration with raw chain RPC is not implemented.
- Existing policy/executor adapters are not invoked by Radar.
- Payback policy is unchanged.

## Next Build Step

The next step is a replay-engine prototype that reconstructs closed reference-wallet episodes from raw receipts only. It should still emit `unknown` when attribution crosses CEX, mixer, Lightning, or unlabeled hops.
