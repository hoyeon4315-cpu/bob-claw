import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateGasPriceCeiling,
  featureEnabled,
} from "../src/executor/policy/gas-price-ceiling.mjs";
import { writeGasSample } from "../src/executor/helpers/gas-history-writer.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "gas-ceiling-test-"));
}

function writeHistory(dir, chain, lines) {
  const path = join(dir, `gas-history-${chain}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

test("current gas above p90 -> BLOCK", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "base";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 0.1 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 0.2 },
    { observedAt: "2026-05-10T09:00:00.000Z", gasPriceGwei: 0.3 },
    { observedAt: "2026-05-10T08:00:00.000Z", gasPriceGwei: 0.4 },
    { observedAt: "2026-05-10T07:00:00.000Z", gasPriceGwei: 0.5 },
    { observedAt: "2026-05-10T06:00:00.000Z", gasPriceGwei: 0.6 },
    { observedAt: "2026-05-10T05:00:00.000Z", gasPriceGwei: 0.7 },
    { observedAt: "2026-05-10T04:00:00.000Z", gasPriceGwei: 0.8 },
    { observedAt: "2026-05-10T03:00:00.000Z", gasPriceGwei: 0.9 },
    { observedAt: "2026-05-10T02:00:00.000Z", gasPriceGwei: 1.0 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain, gasPriceGwei: 1.1 },
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("gas_price_above_ceiling"), true);
  assert.equal(result.metrics.p90GasPriceGwei, 0.9);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("current gas below p90 -> ALLOW", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "ethereum";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 10 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 15 },
    { observedAt: "2026-05-10T09:00:00.000Z", gasPriceGwei: 20 },
    { observedAt: "2026-05-10T08:00:00.000Z", gasPriceGwei: 25 },
    { observedAt: "2026-05-10T07:00:00.000Z", gasPriceGwei: 30 },
    { observedAt: "2026-05-10T06:00:00.000Z", gasPriceGwei: 35 },
    { observedAt: "2026-05-10T05:00:00.000Z", gasPriceGwei: 40 },
    { observedAt: "2026-05-10T04:00:00.000Z", gasPriceGwei: 45 },
    { observedAt: "2026-05-10T03:00:00.000Z", gasPriceGwei: 50 },
    { observedAt: "2026-05-10T02:00:00.000Z", gasPriceGwei: 55 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain, gasPriceGwei: 49 },
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.metrics.p90GasPriceGwei, 50);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("missing history file -> ALLOW", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "bob";

  const result = evaluateGasPriceCeiling({
    intent: { chain, gasPriceGwei: 100 },
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.metrics.historyEntriesCount, 0);
  assert.equal(result.metrics.p90GasPriceGwei, null);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("feature flag off -> ALLOW", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "base";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 1 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain, gasPriceGwei: 100 },
    now,
    profile: { gasPriceCeiling: false },
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.metrics.enabled, false);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("p90 calculation is correct for known dataset", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "arbitrum";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 1 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 2 },
    { observedAt: "2026-05-10T09:00:00.000Z", gasPriceGwei: 3 },
    { observedAt: "2026-05-10T08:00:00.000Z", gasPriceGwei: 4 },
    { observedAt: "2026-05-10T07:00:00.000Z", gasPriceGwei: 5 },
    { observedAt: "2026-05-10T06:00:00.000Z", gasPriceGwei: 6 },
    { observedAt: "2026-05-10T05:00:00.000Z", gasPriceGwei: 7 },
    { observedAt: "2026-05-10T04:00:00.000Z", gasPriceGwei: 8 },
    { observedAt: "2026-05-10T03:00:00.000Z", gasPriceGwei: 9 },
    { observedAt: "2026-05-10T02:00:00.000Z", gasPriceGwei: 10 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain, gasPriceGwei: 10 },
    now,
    dataDir: tmpDir,
  });

  // 10 entries sorted: [1,2,3,4,5,6,7,8,9,10]
  // p90 index = ceil(10 * 0.9) - 1 = 9 - 1 = 8 -> value at index 8 is 9
  assert.equal(result.metrics.p90GasPriceGwei, 9);
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("gas_price_above_ceiling"), true);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("writeGasSample appends line and creates data dir", () => {
  const tmpDir = makeTempDir();
  const chain = "base";
  const now = "2026-05-10T12:00:00.000Z";

  writeGasSample({ chain, gasPriceGwei: 0.42, now, dataDir: tmpDir });

  const filePath = join(tmpDir, `gas-history-${chain}.jsonl`);
  const raw = readFileSync(filePath, "utf8").trim();
  const lines = raw.split("\n");
  assert.equal(lines.length, 1);

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.observedAt, now);
  assert.equal(parsed.gasPriceGwei, 0.42);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("featureEnabled defaults to true", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ gasPriceCeiling: true }), true);
  assert.equal(featureEnabled({ gasPriceCeiling: false }), false);
});

test("entries older than 7 days are excluded from p90", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "base";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-03T12:00:00.000Z", gasPriceGwei: 1 },
    { observedAt: "2026-05-03T11:59:59.000Z", gasPriceGwei: 100 },
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 2 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 3 },
    { observedAt: "2026-05-10T09:00:00.000Z", gasPriceGwei: 4 },
    { observedAt: "2026-05-10T08:00:00.000Z", gasPriceGwei: 5 },
    { observedAt: "2026-05-10T07:00:00.000Z", gasPriceGwei: 6 },
    { observedAt: "2026-05-10T06:00:00.000Z", gasPriceGwei: 7 },
    { observedAt: "2026-05-10T05:00:00.000Z", gasPriceGwei: 8 },
    { observedAt: "2026-05-10T04:00:00.000Z", gasPriceGwei: 9 },
    { observedAt: "2026-05-10T03:00:00.000Z", gasPriceGwei: 10 },
    { observedAt: "2026-05-10T02:00:00.000Z", gasPriceGwei: 11 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain, gasPriceGwei: 10 },
    now,
    dataDir: tmpDir,
  });

  // 11 recent entries (excluding the 100 from just before 7d cutoff)
  // sorted recent: [2,3,4,5,6,7,8,9,10,11,1] wait no, 1 is from 2026-05-03T12:00:00 which is exactly 7 days before now, included
  // Actually: 2026-05-03T12:00:00 is exactly 7 days = 168 hours. cutoffMs = now - 7*24*60*60*1000.
  // 2026-05-03T12:00:00 >= cutoff, so it's included.
  // The 100 is from 2026-05-03T11:59:59, which is 1 second before cutoff, excluded.
  // Recent values: [1,2,3,4,5,6,7,8,9,10,11]
  // p90 index = ceil(11 * 0.9) - 1 = 10 - 1 = 9 -> value at index 9 is 10
  assert.equal(result.metrics.historyEntriesCount, 11);
  assert.equal(result.metrics.p90GasPriceGwei, 10);
  assert.equal(result.decision, "ALLOW");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("uses metadata.gasPriceGwei when intent.gasPriceGwei is missing", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "base";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 1 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain, metadata: { gasPriceGwei: 2 } },
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.metrics.currentGasPriceGwei, 2);
  assert.equal(result.decision, "BLOCK");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("allows when current gas price is not a finite number", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";
  const chain = "base";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 1 },
  ]);

  const result = evaluateGasPriceCeiling({
    intent: { chain },
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);

  rmSync(tmpDir, { recursive: true, force: true });
});
