import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildAutoPromotionPreviewReport,
  loadEvidenceRecords,
} from "../src/cli/promotion-pr-preview.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function passingEvidence(overrides = {}) {
  return {
    strategyId: "candidate-strategy",
    walkForward: {
      sharpe: 1.5,
      maxDrawdownPct: 10,
      regimeChanges: 2,
      samplePeriods: 24,
    },
    oosHoldout: {
      holdoutDays: 30,
      netPositive: true,
    },
    regimeBreakdown: {
      bear: { sampleCount: 5, netPnlUsd: 10 },
      neutral: { sampleCount: 8, netPnlUsd: 25 },
      bull_peak: { sampleCount: 3, netPnlUsd: 7 },
    },
    shadow: {
      consecutivePositivePeriods: 10,
      netOfMeasuredCost: true,
      quoteSuccessRate: 0.95,
    },
    execution: {
      oracleDivergencePct: 0.5,
      slippagePct: 0.2,
      edgeAboveCostVariance: true,
    },
    ...overrides,
  };
}

test("auto-promotion preview blocks candidates when evidence is missing", () => {
  const report = buildAutoPromotionPreviewReport({
    evidenceRecords: [],
    nowMs: Date.parse("2026-05-03T00:00:00Z"),
    strategyIds: ["candidate-strategy"],
  });
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.source, "auto_promotion_evidence");
  assert.equal(report.advisoryOnly, true);
  assert.equal(report.summary.eligibleCount, 0);
  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.reports[0].evidenceProvided, false);
  assert.ok(report.reports[0].blockers.some((b) => b.startsWith("walk_forward_sharpe_below_min")));
});

test("auto-promotion preview passes clean deterministic evidence", () => {
  const report = buildAutoPromotionPreviewReport({
    evidenceRecords: [passingEvidence()],
    nowMs: Date.parse("2026-05-03T00:00:00Z"),
    strategyIds: ["candidate-strategy"],
  });
  assert.equal(report.summary.eligibleCount, 1);
  assert.equal(report.summary.blockedCount, 0);
  assert.equal(report.summary.evidenceProvidedCount, 1);
  assert.equal(report.reports[0].passed, true);
  assert.equal(report.reports[0].eligible, true);
  assert.deepEqual(report.reports[0].blockers, []);
});

test("promotion preview CLI writes the auto-promotion report", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-promotion-preview-"));
  const evidencePath = join(cwd, "evidence.json");
  const outPath = join(cwd, "promotion-latest.json");
  await writeFile(evidencePath, JSON.stringify(passingEvidence(), null, 2), "utf8");

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/promotion-pr-preview.mjs"),
      "--strategy=candidate-strategy",
      `--evidence=${evidencePath}`,
      `--write=${outPath}`,
      "--quiet",
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(report.source, "auto_promotion_evidence");
  assert.equal(report.summary.eligibleCount, 1);
  assert.equal(report.reports[0].strategyId, "candidate-strategy");
});

test("loadEvidenceRecords accepts single objects and arrays", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-promotion-records-"));
  const objectPath = join(cwd, "one.json");
  const arrayPath = join(cwd, "many.json");
  await mkdir(cwd, { recursive: true });
  await writeFile(objectPath, JSON.stringify(passingEvidence({ strategyId: "one" })), "utf8");
  await writeFile(arrayPath, JSON.stringify([
    passingEvidence({ strategyId: "two" }),
    passingEvidence({ strategyId: "three" }),
  ]), "utf8");

  const records = loadEvidenceRecords([objectPath, arrayPath]);
  assert.deepEqual(records.map((record) => record.strategyId), ["one", "two", "three"]);
});
