import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs as parseGasZipArgs } from "../src/cli/run-gas-zip-refuel.mjs";
import { parseArgs as parseCapitalManagerArgs } from "../src/cli/plan-capital-manager-refill-jobs.mjs";
import {
  parseArgs as parsePaybackSchedulerArgs,
  paybackDisbursementRecordFromTickResult,
  persistResult as persistPaybackSchedulerResult,
} from "../src/cli/run-payback-scheduler.mjs";

test("run-gas-zip-refuel parseArgs reads execution and settlement options", () => {
  const args = parseGasZipArgs([
    "--json",
    "--write",
    "--execute",
    "--src-chain=base",
    "--dst-chain=sonic",
    "--amount-wei=1000000000000000",
    "--sender=0x1111111111111111111111111111111111111111",
    "--recipient=0x2222222222222222222222222222222222222222",
    "--strategy-id=gas-zip-smoke",
    "--socket-path=/tmp/bob-signer.sock",
    "--timeout-ms=45000",
    "--confirmations=3",
    "--confirmation-timeout-ms=600000",
    "--destination-timeout-ms=120000",
    "--destination-poll-interval-ms=2500",
    "--gas-buffer-bps=1750",
    "--no-await-confirmation",
    "--no-await-destination-settlement",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.write, true);
  assert.equal(args.execute, true);
  assert.equal(args.srcChain, "base");
  assert.equal(args.dstChain, "sonic");
  assert.equal(args.amountWei, "1000000000000000");
  assert.equal(args.sender, "0x1111111111111111111111111111111111111111");
  assert.equal(args.recipient, "0x2222222222222222222222222222222222222222");
  assert.equal(args.strategyId, "gas-zip-smoke");
  assert.equal(args.socketPath, "/tmp/bob-signer.sock");
  assert.equal(args.timeoutMs, 45000);
  assert.equal(args.awaitConfirmation, false);
  assert.equal(args.awaitDestinationSettlement, false);
  assert.equal(args.confirmations, 3);
  assert.equal(args.confirmationTimeoutMs, 600000);
  assert.equal(args.destinationSettlementTimeoutMs, 120000);
  assert.equal(args.destinationPollIntervalMs, 2500);
  assert.equal(args.gasBufferBps, 1750);
});

test("plan-capital-manager-refill-jobs parseArgs reads planner flags", () => {
  const args = parseCapitalManagerArgs([
    "--json",
    "--write",
    "--refresh-inventory",
    "--include-inactive",
    "--address=0x3333333333333333333333333333333333333333",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.write, true);
  assert.equal(args.refreshInventory, true);
  assert.equal(args.includeInactive, true);
  assert.equal(args.address, "0x3333333333333333333333333333333333333333");
});

test("run-payback-scheduler parseArgs reads loop and poll settings", () => {
  const args = parsePaybackSchedulerArgs([
    "--json",
    "--write",
    "--loop",
    "--execute",
    "--socket-path=/tmp/payback-signer.sock",
    "--timeout-ms=45000",
    "--confirmations=2",
    "--confirmation-timeout-ms=180000",
    "--destination-timeout-ms=240000",
    "--destination-poll-interval-ms=3000",
    "--bitcoin-settlement-timeout-ms=600000",
    "--bitcoin-poll-interval-ms=15000",
    "--poll-interval-ms=900000",
    "--no-await-confirmation",
    "--no-await-destination-settlement",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.write, true);
  assert.equal(args.loop, true);
  assert.equal(args.once, false);
  assert.equal(args.execute, true);
  assert.equal(args.socketPath, "/tmp/payback-signer.sock");
  assert.equal(args.timeoutMs, 45000);
  assert.equal(args.awaitConfirmation, false);
  assert.equal(args.awaitDestinationSettlement, false);
  assert.equal(args.confirmations, 2);
  assert.equal(args.confirmationTimeoutMs, 180000);
  assert.equal(args.destinationSettlementTimeoutMs, 240000);
  assert.equal(args.destinationPollIntervalMs, 3000);
  assert.equal(args.bitcoinSettlementTimeoutMs, 600000);
  assert.equal(args.bitcoinPollIntervalMs, 15000);
  assert.equal(args.pollIntervalMs, 900000);
});

test("run-payback-scheduler parseArgs defaults to once mode", () => {
  const args = parsePaybackSchedulerArgs([]);

  assert.equal(args.loop, false);
  assert.equal(args.once, true);
  assert.equal(args.execute, false);
  assert.equal(args.pollIntervalMs, undefined);
});

test("run-payback-scheduler persists executed payback disbursements to signer audit log", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-persist-"));
  const dataDir = join(tempDir, "data");
  const logsDir = join(tempDir, "logs");
  const disbursementRecord = {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    kind: "payback_disbursement",
    strategyId: "gateway-btc-offramp",
    periodId: "week-2026-17",
    plannedPaybackSats: 60_000,
    settledBalanceDeltaSats: 58_000,
    gatewayOrderId: "order-1",
    bitcoinTxid: "btc-tx-1",
  };
  const result = {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    status: "submitted",
    execution: {
      status: "submitted",
      disbursementRecord,
    },
  };

  assert.deepEqual(paybackDisbursementRecordFromTickResult(result), disbursementRecord);

  await persistPaybackSchedulerResult(result, { dataDir, logsDir });

  const tickLatest = JSON.parse(await readFile(join(dataDir, "payback-scheduler-tick-latest.json"), "utf8"));
  const tickLines = (await readFile(join(dataDir, "payback-scheduler-ticks.jsonl"), "utf8")).trim().split("\n");
  const auditLines = (await readFile(join(logsDir, "signer-audit.jsonl"), "utf8")).trim().split("\n");

  assert.equal(tickLatest.status, "submitted");
  assert.equal(tickLines.length, 1);
  assert.deepEqual(JSON.parse(auditLines[0]), disbursementRecord);
});
