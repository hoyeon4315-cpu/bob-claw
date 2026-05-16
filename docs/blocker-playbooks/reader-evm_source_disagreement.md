# Playbook: reader-evm_source_disagreement / evm_scan_degraded

## When this appears
- `evmWallet` (live treasury scan) and `evmAutopilot` (latest autopilot snapshot) differ by more than 10% + $25 absolute.
- Triggers `evm_source_disagreement` flag. If scan errors are high on the live side, it becomes `evm_scan_degraded` instead of hard halt.

## Common Causes on Base
- Receipt ingestion failing or delayed on base (many "All RPC endpoints failed for chain: base").
- Recent capital movements (refills, claims, swaps) not yet reflected in autopilot summary.
- One side falling back to stale data.

## Resolution Path
1. **Immediate**
   - Run `npm run report:capital-audit -- --json` to force fresh reads.
   - Check recent `receipt_read_failed` on base.

2. **Short term**
   - Improve base RPC resilience (more reliable providers, better retry logic).
   - Make autopilot write capitalManager summary more frequently even on partial failures.

3. **Long term**
   - The unified reader now has tolerance via `evm_scan_degraded` + absolute floor. Monitor if this tolerance is being abused (too many degraded states).

## Related Changes (2026-05)
- Added $25 absolute floor + `evm_scan_degraded` path in `unified-nav-reader.mjs`.
- `reader:base_rpc_degraded` recipe now triggers capital audit.

## Success Criteria
- `evmDiscrepancyPct` drops below 10% + $25 after fresh audit.
- Hard "halted" state becomes rare; most cases are "degraded but usable".