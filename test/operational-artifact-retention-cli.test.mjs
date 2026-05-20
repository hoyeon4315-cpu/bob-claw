import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
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

async function writeJsonl(path, rows) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
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

test("retention audit reports protected files and tail-preserving compact candidates without mutating by default", async () => {
  await withTempRoot(async (rootDir) => {
    const compactCandidatePath = join(rootDir, "data", "treasury-inventory.jsonl");
    const liveTruthPath = join(rootDir, "data", "all-chain-autopilot-latest.json");
    const dashboardTruthPath = join(rootDir, "dashboard", "public", "dashboard-status.json");
    const auditPath = join(rootDir, "logs", "signer-audit.jsonl");
    const receiptPath = join(rootDir, "data", "receipt-reconciliations.jsonl");
    const archiveCandidatePath = join(rootDir, "data", "quote-surface-scans.jsonl");
    const disposablePath = join(rootDir, "data", "cache", "shadow-refresh.tmp.json");
    const unknownPath = join(rootDir, "data", "manual-review-surface.json");

    await writeJsonl(compactCandidatePath, [
      { observedAt: "2026-05-19T00:00:00.000Z", usd: 1, note: "a".repeat(64) },
      { observedAt: "2026-05-19T01:00:00.000Z", usd: 2, note: "b".repeat(64) },
      { observedAt: "2026-05-19T02:00:00.000Z", usd: 3, note: "c".repeat(64) },
      { observedAt: "2026-05-19T03:00:00.000Z", usd: 4, note: "d".repeat(64) },
    ]);
    await writeFile(liveTruthPath, JSON.stringify({ ok: true }), "utf8");
    await writeFile(dashboardTruthPath, JSON.stringify({ ready: true }), "utf8");
    await writeFile(auditPath, `${JSON.stringify({ event: "signed" })}\n`, "utf8");
    await writeFile(receiptPath, `${JSON.stringify({ txHash: "0xabc" })}\n`, "utf8");
    await writeSizedFile(archiveCandidatePath, 4096, "a");
    await writeSizedFile(disposablePath, 2048, "b");
    await writeFile(unknownPath, JSON.stringify({ note: "inspect me" }), "utf8");

    await makeOld(archiveCandidatePath, 45);
    await makeOld(disposablePath, 10);

    const result = await runCli(rootDir, ["--compact-min-bytes=1", "--retain-lines=2"]);

    assert.equal(result.dryRun, true);
    assert.equal(result.archiveEnabled, false);
    assert.equal(result.compactEnabled, false);
    assert.equal(result.byCategory.preserve_live_truth.fileCount, 2);
    assert.equal(result.byCategory.preserve_audit_receipt.fileCount, 2);
    assert.equal(result.byCategory.compact_candidate.fileCount, 1);
    assert.equal(result.byCategory.archive_candidate.fileCount, 1);
    assert.equal(result.byCategory.disposable_cache.fileCount, 1);
    assert.equal(result.byCategory.unknown_manual_review.fileCount, 1);
    assert.ok(
      result.plannedActions.some(
        (item) =>
          item.action === "compact_jsonl_tail" &&
          item.relativePath === "data/treasury-inventory.jsonl" &&
          item.retainedLines === 2 &&
          item.archivedLines === 2,
      ),
    );
    assert.ok(
      result.plannedActions.some(
        (item) => item.action === "archive_gzip" && item.relativePath === "data/quote-surface-scans.jsonl",
      ),
    );
    assert.ok(
      result.skippedReasons.some(
        (item) => item.relativePath === "logs/signer-audit.jsonl" && item.reason === "preserve_audit_receipt",
      ),
    );
    assert.equal((await readFile(compactCandidatePath, "utf8")).trim().split("\n").length, 4);
    await assert.rejects(stat(join(rootDir, "archive", "operational-artifacts", "archive-manifest.jsonl")));
  });
});

test("compact mode preserves the tail, writes a gzip archive, and appends an archive manifest", async () => {
  await withTempRoot(async (rootDir) => {
    const compactCandidatePath = join(rootDir, "data", "all-chain-autopilot-runs.jsonl");
    await writeJsonl(compactCandidatePath, [
      { observedAt: "2026-05-19T00:00:00.000Z", run: 1 },
      { observedAt: "2026-05-19T01:00:00.000Z", run: 2 },
      { observedAt: "2026-05-19T02:00:00.000Z", run: 3 },
      { observedAt: "2026-05-19T03:00:00.000Z", run: 4 },
      { observedAt: "2026-05-19T04:00:00.000Z", run: 5 },
    ]);

    const result = await runCli(rootDir, ["--compact", "--compact-min-bytes=1", "--retain-lines=2"]);

    assert.equal(result.dryRun, false);
    assert.equal(result.compactEnabled, true);
    const compacted = result.archiveResults.find(
      (item) => item.relativePath === "data/all-chain-autopilot-runs.jsonl" && item.status === "compacted",
    );
    assert.ok(compacted);
    assert.equal(compacted.archivedLines, 3);
    assert.equal(compacted.retainedLines, 2);
    assert.ok(compacted.sha256);

    const archivePath = compacted.archivePath.replaceAll("/", sep);
    const retained = (await readFile(compactCandidatePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      retained.map((row) => row.run),
      [4, 5],
    );

    const archived = gunzipSync(await readFile(archivePath)).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      archived.map((row) => row.run),
      [1, 2, 3],
    );

    const manifestLines = (await readFile(join(rootDir, "archive", "operational-artifacts", "archive-manifest.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(manifestLines.length, 1);
    assert.equal(manifestLines[0].originalPath, "data/all-chain-autopilot-runs.jsonl");
    assert.equal(manifestLines[0].archivedLines, 3);
    assert.equal(manifestLines[0].retainedLines, 2);
    assert.equal(manifestLines[0].firstObservedAt, "2026-05-19T00:00:00.000Z");
    assert.equal(manifestLines[0].lastObservedAt, "2026-05-19T02:00:00.000Z");
    assert.ok(manifestLines[0].sha256);
  });
});

test("compact mode can be scoped to a single non-audit JSONL path", async () => {
  await withTempRoot(async (rootDir) => {
    const selectedPath = join(rootDir, "data", "all-chain-autopilot-runs.jsonl");
    const unselectedPath = join(rootDir, "data", "treasury-inventory.jsonl");
    await writeJsonl(selectedPath, [
      { observedAt: "2026-05-19T00:00:00.000Z", run: 1, payload: "a".repeat(64) },
      { observedAt: "2026-05-19T01:00:00.000Z", run: 2, payload: "b".repeat(64) },
      { observedAt: "2026-05-19T02:00:00.000Z", run: 3, payload: "c".repeat(64) },
    ]);
    await writeJsonl(unselectedPath, [
      { observedAt: "2026-05-19T00:00:00.000Z", run: 1, payload: "d".repeat(64) },
      { observedAt: "2026-05-19T01:00:00.000Z", run: 2, payload: "e".repeat(64) },
      { observedAt: "2026-05-19T02:00:00.000Z", run: 3, payload: "f".repeat(64) },
    ]);

    const result = await runCli(rootDir, [
      "--compact",
      "--compact-min-bytes=1",
      "--retain-lines=1",
      "--compact-path=data/all-chain-autopilot-runs.jsonl",
    ]);

    assert.deepEqual(result.thresholds.compactPaths, ["data/all-chain-autopilot-runs.jsonl"]);
    assert.ok(
      result.archiveResults.some(
        (item) =>
          item.relativePath === "data/all-chain-autopilot-runs.jsonl" &&
          item.status === "compacted" &&
          item.archivedLines === 2,
      ),
    );
    assert.ok(
      result.skippedReasons.some(
        (item) => item.relativePath === "data/treasury-inventory.jsonl" && item.reason === "outside_compact_path_filter",
      ),
    );
    assert.equal((await readFile(selectedPath, "utf8")).trim().split("\n").length, 1);
    assert.equal((await readFile(unselectedPath, "utf8")).trim().split("\n").length, 3);
  });
});

test("archive mode gzips eligible whole-file archive candidates and deletes disposable caches", async () => {
  await withTempRoot(async (rootDir) => {
    const archiveCandidatePath = join(rootDir, "data", "quote-surface-scans.jsonl");
    const disposablePath = join(rootDir, "logs", "strategy-evidence-refresh.err.log");
    const protectedAuditPath = join(rootDir, "logs", "signer-audit.jsonl");

    await writeFile(archiveCandidatePath, `${JSON.stringify({ run: 1 })}\n${JSON.stringify({ run: 2 })}\n`, "utf8");
    await writeFile(disposablePath, "temporary log output\n", "utf8");
    await writeFile(protectedAuditPath, `${JSON.stringify({ event: "rejected" })}\n`, "utf8");
    await makeOld(archiveCandidatePath, 60);
    await makeOld(disposablePath, 10);

    const result = await runCli(rootDir, ["--archive"]);

    assert.equal(result.dryRun, false);
    assert.equal(result.archiveEnabled, true);
    assert.ok(result.archiveResults.some((item) => item.relativePath === "data/quote-surface-scans.jsonl" && item.status === "archived"));
    assert.ok(result.archiveResults.some((item) => item.relativePath === "logs/strategy-evidence-refresh.err.log" && item.status === "deleted"));
    await assert.rejects(stat(disposablePath));
    assert.equal(await readFile(protectedAuditPath, "utf8"), `${JSON.stringify({ event: "rejected" })}\n`);
  });
});
