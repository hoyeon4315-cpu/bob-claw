import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendInventoryWatcherReport,
  buildInventoryWatcherReport,
  diffInventorySnapshots,
} from "../src/treasury/inventory-watcher.mjs";

function snapshot({ observedAt, usdc = "0", unknown = "0" } = {}) {
  return {
    observedAt,
    address: "0xabc",
    native: [],
    tokens: [
      {
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        actual: usdc,
        actualDecimal: Number(usdc) / 1e6,
        priceUsd: 1,
        estimatedUsd: Number(usdc) / 1e6,
      },
      {
        chain: "base",
        ticker: "Token",
        token: "0x9999999999999999999999999999999999999999",
        actual: unknown,
        actualDecimal: Number(unknown),
        estimatedUsd: null,
      },
    ],
  };
}

test("inventory watcher emits only positive balance deltas", () => {
  const events = diffInventorySnapshots({
    previousSnapshot: snapshot({ observedAt: "2026-04-25T00:00:00.000Z", usdc: "1000000" }),
    currentSnapshot: snapshot({ observedAt: "2026-04-25T00:01:00.000Z", usdc: "2500000" }),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].amount, "1500000");
  assert.equal(events[0].amountDecimal, 1.5);
  assert.equal(events[0].estimatedUsd, 1.5);
});

test("inventory watcher report classifies routable and pending whitelist deposits", () => {
  const report = buildInventoryWatcherReport({
    previousSnapshot: snapshot({ observedAt: "2026-04-25T00:00:00.000Z", usdc: "0", unknown: "0" }),
    currentSnapshot: snapshot({ observedAt: "2026-04-25T00:01:00.000Z", usdc: "1000000", unknown: "1" }),
  });

  assert.equal(report.summary.inboundEventCount, 2);
  assert.equal(report.summary.operatingCapitalIngressCount, 2);
  assert.equal(report.summary.paybackExcludedCount, 2);
  assert.equal(report.summary.routeReadyCount, 1);
  assert.equal(report.summary.manualReviewCount, 1);
  assert.equal(report.events[0].capitalSource, "operating_capital");
  assert.equal(report.events[0].paybackExclusion, true);
  assert.equal(report.routingPlan.jobs[0].capitalSource, "operating_capital");
  assert.equal(report.routingPlan.jobs[0].paybackExclusion, true);
});

test("appendInventoryWatcherReport writes event, refill job, and whitelist queues", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-inbound-"));
  try {
    const report = buildInventoryWatcherReport({
      previousSnapshot: snapshot({ observedAt: "2026-04-25T00:00:00.000Z", usdc: "0", unknown: "0" }),
      currentSnapshot: snapshot({ observedAt: "2026-04-25T00:01:00.000Z", usdc: "1000000", unknown: "1" }),
    });
    const appended = await appendInventoryWatcherReport(report, { dataDir: dir, existingEvents: [] });

    assert.deepEqual(appended, { events: 2, jobs: 1, pendingWhitelist: 1 });
    const eventLines = (await readFile(join(dir, "treasury", "inbound-events.jsonl"), "utf8")).trim().split("\n");
    const jobLines = (await readFile(join(dir, "treasury-refill-jobs.jsonl"), "utf8")).trim().split("\n");
    const whitelistLines = (await readFile(join(dir, "treasury", "pending-whitelist.jsonl"), "utf8")).trim().split("\n");
    assert.equal(eventLines.length, 2);
    assert.equal(jobLines.length, 1);
    assert.equal(whitelistLines.length, 1);

    const duplicate = await appendInventoryWatcherReport(report, { dataDir: dir });
    assert.deepEqual(duplicate, { events: 0, jobs: 0, pendingWhitelist: 0 });
    assert.equal((await readFile(join(dir, "treasury-refill-jobs.jsonl"), "utf8")).trim().split("\n").length, 1);
    assert.equal((await readFile(join(dir, "treasury", "pending-whitelist.jsonl"), "utf8")).trim().split("\n").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
