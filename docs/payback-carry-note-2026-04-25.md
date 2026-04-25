# Payback Carry Note — 2026-04-25

The current `601` sats pending payback carry is not a code defect.

`src/config/payback.mjs` keeps `minPaybackBtc` at `0.0005 BTC` (`50,000` sats), so a weekly decision below that threshold must accrue instead of forcing a Gateway offramp. This preserves the configured cost guard and avoids spending a disproportionate share of the payback amount on round-trip settlement.

Expected resolution: as representative capital spreads across more live-validated chains and harvest size grows, the accumulator should naturally cross the minimum payback threshold. Do not add a runtime force-flush or LLM-decided payback override.
