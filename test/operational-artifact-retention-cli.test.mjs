import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function withTempRoot(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-artifact-retention-"));
  try {
    await mkdir(join(rootDir, "data", "cache"), { recursive: true });
    await mkdir(join(rootDir, "logs"), { recursive: true });
    await mkdir(join(rootDir, "dashboard", "public"), { recursive: true });
    await fn(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writeSizedFile(path, size, fill = "x") {
  await writeFile(path, fill.repeat(size), "utf8");
}

async function makeOld(path, days = 45) {
  const timestamp = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await utimes(path, timestamp, timestamp);
}

async function runCli(rootDir, extraArgs = []) {
  const scriptPath = join(process.cwd(), "src", "cli", "report-operational-artifact-retention.mjs");
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      scriptPath,
      "--json",
      `--data-dir=${join(rootDir, "data")}`,
      `--logs-dir=${join(rootDir, "logs")}`,
      `--dashboard-dir=${join(rootDir, "dashboard", "public")}`,
      `--archive-dir=${join(rootDir, "archive", "operational-artifacts")}`,
      ...extraArgs,
    ],
    { cwd: rootDir },
  );
  return JSON.parse(stdout);
}

test("retention audit classifies protected, archive, disposable, and unknown artifacts without mutating by default", async () => {
  await withTempRoot(async (rootDir) => {
    const liveTruthPath = join(rootDir, "data", "all-chain-autopilot-latest.json");
    const dashboardTruthPath = join(rootDir, "dashboard", "public", "dashboard-status.json");
    const auditPath = join(rootDir, "logs", "signer-audit.jsonl");
    const receiptPath = join(rootDir, "data", "receipt-reconciliations.jsonl");
    const archiveCandidatePath = join(rootDir, "data", "all-chain-autopilot-runs.jsonl");
    const disposablePath = join(rootDir, "data", "cache", "shadow-refresh.tmp.json");
    const unknownPath = join(rootDir, "data", "manual-review-surface.json");

    await writeFile(liveTruthPath, JSON.stringify({ ok: true }), "utf8");
    await writeFile(dashboardTruthPath, JSON.stringify({ ready: true }), "utf8");
    await writeFile(auditPath, `${JSON.stringify({ event: "signed" })}\n`, "utf8");
    await writeFile(receiptPath, `${JSON.stringify({ txHash: "0xabc" })}\n`, "utf8");
    await writeSizedFile(archiveCandidatePath, 4096, "a");
    await writeSizedFile(disposablePath, 2048, "b");
    await writeFile(unknownPath, JSON.stringify({ note: "inspect me" }), "utf8");

    await makeOld(archiveCandidatePath, 45);
    await makeOld(disposablePath, 10);

    const beforeArchiveStat = await stat(archiveCandidatePath);
    const beforeDisposableStat = await stat(disposablePath);

    const result = await runCli(rootDir);

    assert.equal(result.dryRun, true);
    assert.equal(result.archiveEnabled, false);
    assert.equal(
      result.totalBytes,
      beforeArchiveStat.size +
        beforeDisposableStat.size +
        (await stat(liveTruthPath)).size +
        (await stat(dashboardTruthPath)).size +
        (await stat(auditPath)).size +
        (await stat(receiptPath)).size +
        (await stat(unknownPath)).size,
    );
    assert.equal(result.byCategory.preserve_live_truth.fileCount, 2);
    assert.equal(result.byCategory.preserve_audit_receipt.fileCount, 2);
    assert.equal(result.byCategory.archive_candidate.fileCount, 1);
    assert.equal(result.byCategory.disposable_cache.fileCount, 1);
    assert.equal(result.byCategory.unknown_manual_review.fileCount, 1);
    assert.equal(result.reclaimableBytes, beforeArchiveStat.size + beforeDisposableStat.size);
    assert.deepEqual(
      result.topFiles.slice(0, 2).map((item) => ({ path: item.relativePath, category: item.category })),
      [
        { path: "data/all-chain-autopilot-runs.jsonl", category: "archive_candidate" },
        { path: "data/cache/shadow-refresh.tmp.json", category: "disposable_cache" },
      ],
    );
    assert.ok(
      result.plannedActions.some(
        (item) => item.action === "archive_gzip" && item.relativePath === "data/all-chain-autopilot-runs.jsonl",
      ),
    );
    assert.ok(
      result.plannedActions.some(
        (item) => item.action === "delete_disposable" && item.relativePath === "data/cache/shadow-refresh.tmp.json",
      ),
    );
    assert.ok(
      result.skippedReasons.some(
        (item) => item.relativePath === "logs/signer-audit.jsonl" && item.reason === "preserve_audit_receipt",
      ),
    );
    assert.ok(
      result.skippedReasons.some(
        (item) => item.relativePath === "data/manual-review-surface.json" && item.reason === "unknown_manual_review",
      ),
    );

    assert.equal(await readFile(archiveCandidatePath, "utf8"), "a".repeat(4096));
    assert.equal(await readFile(disposablePath, "utf8"), "b".repeat(2048));
    await assert.rejects(
      stat(join(rootDir, "archive", "operational-artifacts", "data", "all-chain-autopilot-runs.jsonl.gz")),
    );
  });
});

test("archive mode gzips only eligible archive candidates and leaves protected files in place", async () => {
  await withTempRoot(async (rootDir) => {
    const archiveCandidatePath = join(rootDir, "data", "gateway-update-autopilot-runs.jsonl");
    const protectedAuditPath = join(rootDir, "logs", "signer-audit.jsonl");
    const protectedLiveTruthPath = join(rootDir, "data", "gateway-update-autopilot-latest.json");
    const unknownPath = join(rootDir, "data", "mystery-snapshot.json");

    await writeFile(archiveCandidatePath, `${JSON.stringify({ run: 1 })}\n${JSON.stringify({ run: 2 })}\n`, "utf8");
    await writeFile(protectedAuditPath, `${JSON.stringify({ event: "rejected" })}\n`, "utf8");
    await writeFile(protectedLiveTruthPath, JSON.stringify({ status: "current" }), "utf8");
    await writeFile(unknownPath, JSON.stringify({ status: "unknown" }), "utf8");
    await makeOld(archiveCandidatePath, 60);
    await makeOld(unknownPath, 60);

    const result = await runCli(rootDir, ["--archive"]);

    assert.equal(result.dryRun, false);
    assert.equal(result.archiveEnabled, true);
    assert.ok(
      result.archiveResults.some(
        (item) => item.relativePath === "data/gateway-update-autopilot-runs.jsonl" && item.status === "archived",
      ),
    );
    assert.ok(
      result.skippedReasons.some(
        (item) => item.relativePath === "logs/signer-audit.jsonl" && item.reason === "preserve_audit_receipt",
      ),
    );
    assert.ok(
      result.skippedReasons.some(
        (item) => item.relativePath === "data/mystery-snapshot.json" && item.reason === "unknown_manual_review",
      ),
    );

    const archivePath = join(
      rootDir,
      "archive",
      "operational-artifacts",
      "data",
      "gateway-update-autopilot-runs.jsonl.gz",
    );
    const archived = gunzipSync(await readFile(archivePath)).toString("utf8");
    assert.equal(archived, `${JSON.stringify({ run: 1 })}\n${JSON.stringify({ run: 2 })}\n`);

    await assert.rejects(stat(archiveCandidatePath));
    assert.equal(await readFile(protectedAuditPath, "utf8"), `${JSON.stringify({ event: "rejected" })}\n`);
    assert.equal(await readFile(protectedLiveTruthPath, "utf8"), JSON.stringify({ status: "current" }));
    assert.equal(await readFile(unknownPath, "utf8"), JSON.stringify({ status: "unknown" }));
  });
});
