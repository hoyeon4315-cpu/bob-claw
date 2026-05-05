# Wrapped BTC Loop Finalization Postmortem

Date: 2026-05-05

## Summary

A one-dollar Base Moonwell wrapped-BTC loop roundtrip completed on-chain and unwound successfully, but the live CLI did not exit after the receipt was recorded. The kill-switch was re-armed with reason `wrapped-btc-loop-roundtrip-confirmed-cli-finalization-hung`, and the stuck CLI process was terminated with `SIGTERM` after confirming all broadcast rows had reached `confirmed`.

## Confirmed Transactions

- approve initial collateral: `0xbcc6db28a0d6d1ea00400a7fca6a0cbe3c5c926d99f62d5accc20e610c649f9f`
- enter collateral market: `0xebdea96cea7a55f162174f3ab5ab8dfcdd3a0df2edb9c76a1b24b1769e0f1365`
- mint initial collateral: `0x250c30ab7a7e2d959112b006621bc1faeafc3b20931fd19cd1bd8c3ba7b70d3d`
- redeem initial collateral: `0x380a7711e5878f4badc3ab3d707328e8c6c6bd48a875436480f8fb82bc4acd1a`

The receipt row was appended to `data/wrapped-btc-loop-dry-runs.jsonl` with `result=passed`, `watcherStatus=healthy`, no triggers, `actualLoopFeesUsd=0.0045`, `actualUnwindCostUsd=0.0059`, and `realizedNetCarryUsd=0`.

## Root Cause

The parent CLI awaited wrapped-loop receipt auto-ingest. Auto-ingest spawned `npm run ingest:wrapped-btc-loop-receipt -- --write`, which records the receipt and then defaults into a full live-readiness packet refresh. That refresh fans out through multiple synchronous report scripts and can block the live executor finalization path even after on-chain execution and receipt append have completed.

## Mitigation

- Wrapped-loop auto-ingest now passes `--no-refresh-live-packet`, so live executor finalization records the receipt without running the heavy refresh packet.
- Receipt auto-ingest now has a bounded timeout. If auto-ingest times out, the live proof is still written with `receiptAutoIngest.reason=auto_ingest_timeout` instead of hanging indefinitely.
- Timeout/failed auto-ingest no longer marks the proof `oosReceiptStatus=ingested`.

## Recovery Evidence

After the incident, `npm run aggregate:auto-kill-inputs` refreshed `data/price-samples.json` from the latest market price snapshot. `npm run risk:auto-kill-check:json` then reported `triggered=false`, `triggers=[]`, while the operator hold kill-switch remained active.
