#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCapitalAuditReport, collectCapitalAuditInputs } from "../audit/capital-audit.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

function formatUsd(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "n/a";
}

function ignoredTreasuryAddressesForCurrentCapital() {
  return !config.estimateFrom && config.verifyRecipient ? [config.verifyRecipient] : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputs = await collectCapitalAuditInputs({
    dataDir: config.dataDir,
  });
  const report = buildCapitalAuditReport({
    ...inputs,
    ignoredTreasuryAddresses: ignoredTreasuryAddressesForCurrentCapital(),
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "capital-audit.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`status=${report.status}`);
  console.log(`broadcastCount=${report.summary.broadcastCount}`);
  console.log(`helperMatchedCount=${report.summary.helperMatchedCount}`);
  console.log(`unmatchedBroadcastCount=${report.summary.unmatchedBroadcastCount}`);
  console.log(`bitcoinMatchedSettlementCount=${report.summary.bitcoinMatchedSettlementCount}`);
  console.log(`bitcoinUnmatchedTxCount=${report.summary.bitcoinUnmatchedTxCount}`);
  console.log(`totalGasUsd=${formatUsd(report.summary.totalGasUsd)}`);
  console.log(`gatewayFeeSats=${report.summary.totalQuotedGatewayFeeSats}`);
  console.log(`gatewayResidualSats=${report.summary.totalQuotedGatewayResidualSats}`);
  console.log(`observedBtcSats=${report.summary.totalObservedBtcSats}`);
  console.log(`currentNativeBtcSats=${report.summary.currentNativeBtcSats}`);
  console.log(`currentNativeBtcUsd=${formatUsd(report.summary.currentNativeBtcUsd)}`);
  console.log(`nativeDexOutputDriftUsd=${formatUsd(report.summary.totalNativeDexOutputDriftUsd)}`);
  console.log(`treasuryStartUsd=${formatUsd(report.summary.treasuryStartUsd)}`);
  console.log(`treasuryEndUsd=${formatUsd(report.summary.treasuryEndUsd)}`);
  console.log(`currentCombinedUsd=${formatUsd(report.summary.currentCombinedUsd)}`);
  console.log(`treasuryDeltaUsd=${formatUsd(report.summary.treasuryDeltaUsd)}`);
  console.log(`combinedDeltaUsd=${formatUsd(report.summary.combinedDeltaUsd)}`);
  console.log(`issueCount=${report.summary.issueCount}`);

  for (const address of report.bitcoinAddresses) {
    console.log(
      `btcAddress=${address.address} txCount=${address.txCount} currentBalanceSats=${address.currentBalanceSats ?? "n/a"} unmatchedTxs=${address.unmatchedTxs.length}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
