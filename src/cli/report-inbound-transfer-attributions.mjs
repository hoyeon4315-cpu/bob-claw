#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { buildCapitalForensicsReport } from "../audit/capital-forensics.mjs";
import { buildInboundTransferAttributionReport } from "../audit/inbound-transfer-attribution-runner.mjs";
import { buildTransactionLedger } from "../audit/transaction-ledger.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";

function parseArgs(argv = []) {
  const out = {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
    allCandidates: argv.includes("--all-candidates"),
    limit: Infinity,
    eventId: null,
  };
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isInteger(value) && value >= 0) out.limit = value;
    }
    if (arg.startsWith("--event-id=")) {
      out.eventId = arg.slice("--event-id=".length).trim() || null;
    }
  }
  return out;
}

async function readOptionalJsonl(dir, name) {
  return readJsonl(dir, name).catch(() => []);
}

function ledgerUnattributedEventIds({
  inventoryRecords,
  receiptRecords,
  signerAuditRecords,
  gatewayOfframpRecords,
  inboundEvents,
  transferAttributionRecords,
} = {}) {
  const forensics = buildCapitalForensicsReport({ inventoryRecords, receiptRecords, inboundEvents });
  const ledger = buildTransactionLedger({
    receiptRecords,
    signerAuditRecords,
    gatewayOfframpRecords,
    inboundEvents,
    transferAttributionRecords,
    currentNav: forensics.current,
  });
  return new Set(
    ledger.rows
      .filter((row) => row.rowType === "inbound_event")
      .filter((row) => row.confidence === "balance_diff_not_tx_attributed")
      .map((row) => row.eventId)
      .filter(Boolean),
  );
}

function recordKey(record = {}) {
  return [
    record.eventId || "",
    String(record.chain || "").toLowerCase(),
    String(record.token || "").toLowerCase(),
    String(record.txHash || "").toLowerCase(),
    record.logIndex ?? "",
  ].join(":");
}

async function appendNewRecords(records, existingAttributions) {
  const existingKeys = new Set(existingAttributions.map(recordKey));
  const store = new JsonlStore(config.dataDir);
  let appended = 0;
  for (const record of records) {
    const key = recordKey(record);
    if (existingKeys.has(key)) continue;
    await store.append("treasury/inbound-transfer-attributions", record);
    existingKeys.add(key);
    appended += 1;
  }
  return appended;
}

function fmt(value) {
  return Number.isFinite(value) ? String(value) : "all";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [
    inventoryRecords,
    receiptRecords,
    signerAuditRecords,
    gatewayOfframpRecords,
    inboundEvents,
    existingAttributions,
    nativeTransactionRecords,
  ] = await Promise.all([
    readOptionalJsonl(config.dataDir, "whole-wallet-inventory"),
    readOptionalJsonl(config.dataDir, "receipt-reconciliations"),
    readOptionalJsonl("./logs", "signer-audit"),
    readOptionalJsonl(config.dataDir, "gateway-btc-offramp-executions"),
    readOptionalJsonl(`${config.dataDir}/treasury`, "inbound-events"),
    readOptionalJsonl(`${config.dataDir}/treasury`, "inbound-transfer-attributions"),
    readOptionalJsonl(`${config.dataDir}/treasury`, "inbound-native-transfer-history"),
  ]);
  const unattributedEventIds = args.allCandidates
    ? null
    : ledgerUnattributedEventIds({
      inventoryRecords,
      receiptRecords,
      signerAuditRecords,
      gatewayOfframpRecords,
      inboundEvents,
      transferAttributionRecords: existingAttributions,
    });
  const candidateInboundEvents = args.allCandidates
    ? inboundEvents
    : inboundEvents.filter((event) => unattributedEventIds.has(event.eventId));
  const report = await buildInboundTransferAttributionReport({
    inboundEvents: candidateInboundEvents,
    existingAttributions,
    nativeTransactionRecords,
    limit: args.limit,
    eventId: args.eventId,
  });
  let appended = 0;
  if (args.write) {
    appended = await appendNewRecords(report.records, existingAttributions);
  }
  const output = {
    ...report,
    summary: {
      ...report.summary,
      appendedCount: appended,
      write: args.write,
      allCandidates: args.allCandidates,
    },
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`candidateEvents=${output.summary.candidateEventCount} attributed=${output.summary.attributedCount} misses=${output.summary.missCount} failures=${output.summary.failureCount} appended=${output.summary.appendedCount} limit=${fmt(args.limit)}`);
  for (const record of output.records) {
    console.log(`- attributed eventId=${record.eventId} chain=${record.chain} token=${record.token} amount=${record.amount} tx=${record.txHash} block=${record.blockNumber} logIndex=${record.logIndex}`);
  }
  for (const miss of output.misses) {
    console.log(`- miss eventId=${miss.eventId} chain=${miss.chain} token=${miss.token}`);
  }
  for (const failure of output.failures) {
    console.log(`- failure eventId=${failure.eventId} chain=${failure.chain} token=${failure.token} error=${failure.error}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
