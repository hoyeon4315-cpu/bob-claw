#!/usr/bin/env node
/**
 * Report: Aggressive Velocity Sleeve Status (Phase 6)
 *
 * Usage:
 *   node src/cli/report-aggressive-sleeve-status.mjs --json
 */

import { buildAggressiveSleeveStatus } from '../status/aggressive-sleeve-slice.mjs';

async function main() {
  const asJson = process.argv.includes('--json');
  const status = await buildAggressiveSleeveStatus();

  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log('Aggressive Velocity Sleeve Status');
    console.log('Sleeve:', status.sleeve);
    console.log('NAV (BTC):', status.navBtc);
    console.log('Positions:', status.positionCount);
    console.log('Ledger events:', status.ledgerEventCount);
    if (status.performance) {
      console.log('Realized BTC:', status.performance.realizedBtc);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
