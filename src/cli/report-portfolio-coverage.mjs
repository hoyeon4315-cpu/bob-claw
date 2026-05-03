#!/usr/bin/env node
// Phase 1.7: Portfolio coverage report.
// Two-track verification:
//   Track 1 (HARD gate, exit 1 on violation):
//     - every position from audit log is "accounted" in RPC snapshot,
//     - no reader returned a silent skip,
//     - every position has a labeled binding/protocol.
//   Track 2 (SOFT warn, exit 0 with warning):
//     - per-position USD/BTC delta within max($1, 0.5%).
//
// Inputs:
//   --audit=<path>     audit log JSONL of live positions (positionId, valueUsd, ...)
//   --snapshot=<path>  pre-fetched RPC snapshot JSON (optional; if omitted reads stdin)
//   --tolerance-usd=<n> default 1
//   --tolerance-pct=<n> default 0.005

import { readFileSync } from "node:fs";
import { argv, exit, stdout, stderr } from "node:process";
import { bootstrapReaders } from "../protocol-readers/bootstrap.mjs";

bootstrapReaders();

function parseArgs(arr) {
  const out = {};
  for (const a of arr) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = true;
  }
  return out;
}

export function evaluateCoverage({
  auditPositions,
  snapshotPositions,
  readerErrors = [],
  totals = null,
  tolUsd = 1,
  tolPct = 0.005,
}) {
  const snapById = new Map();
  for (const p of snapshotPositions) {
    if (p && p.positionId) snapById.set(p.positionId, p);
  }
  const missing = [];
  const unlabeled = [];
  let silentSkips = 0;

  for (const a of auditPositions) {
    if (!snapById.has(a.positionId)) missing.push(a.positionId);
    const matched = snapById.get(a.positionId);
    if (matched && (matched.silent === true || matched.skipped === true)) silentSkips++;
    if (matched && (!matched.bindingKind || !matched.protocolId)) unlabeled.push(a.positionId);
  }
  for (const p of snapshotPositions) {
    if (!p.bindingKind || !p.protocolId) unlabeled.push(p.positionId || "<no-id>");
  }
  const accounted = auditPositions.length - missing.length;
  // Reader-error count = positions with no reader-or-legacy hit. These count
  // as track1 violations because they represent "ledger position with no
  // explicit coverage". Never silent-skip.
  const readerErrorCount = Array.isArray(readerErrors) ? readerErrors.length : 0;
  const readerErrorByCode = new Map();
  for (const err of readerErrors || []) {
    const code = err?.code || "unknown";
    readerErrorByCode.set(code, (readerErrorByCode.get(code) || 0) + 1);
  }
  const protocolUsd = Number.isFinite(totals?.protocolUsd) ? Number(totals.protocolUsd) : null;
  const protocolPositionCount = snapshotPositions.length;
  const protocolUsdViolation =
    totals !== null && protocolPositionCount > 0 && (!Number.isFinite(protocolUsd) || protocolUsd <= 0);

  const track1Pass =
    missing.length === 0
    && silentSkips === 0
    && unlabeled.length === 0
    && readerErrorCount === 0
    && !protocolUsdViolation;

  const outOfTolerance = [];
  for (const a of auditPositions) {
    const m = snapById.get(a.positionId);
    if (!m) continue;
    const aUsd = Number(a.valueUsd);
    const mUsd = Number(m.valueUsd);
    if (Number.isFinite(aUsd) && Number.isFinite(mUsd)) {
      const diff = Math.abs(aUsd - mUsd);
      const tol = Math.max(tolUsd, Math.abs(aUsd) * tolPct);
      if (diff > tol) {
        outOfTolerance.push({ positionId: a.positionId, auditUsd: aUsd, snapshotUsd: mUsd, diff, tolerance: tol });
      }
    }
  }
  const track2Pass = outOfTolerance.length === 0;
  return {
    generatedAt: new Date().toISOString(),
    track1: {
      pass: track1Pass,
      total: auditPositions.length,
      accounted,
      missing,
      silentSkips,
      unlabeled: [...new Set(unlabeled)],
      readerErrorCount,
      readerErrorByCode: [...readerErrorByCode.entries()].map(([code, count]) => ({ code, count })),
      protocolPositionCount,
      protocolUsd,
      protocolUsdViolation,
    },
    track2: {
      pass: track2Pass,
      tolerance: { usd: tolUsd, pct: tolPct },
      outOfTolerance,
    },
  };
}

async function main() {
  const args = parseArgs(argv.slice(2));
  let auditPositions = [];
  if (args.audit) {
    try {
      const auditLines = readFileSync(args.audit, "utf8").split(/\n/).filter(Boolean);
      for (const line of auditLines) {
        try {
          const obj = JSON.parse(line);
          if (obj && obj.positionId) auditPositions.push(obj);
        } catch {
          // ignore bad lines
        }
      }
    } catch (error) {
      stderr.write(`[coverage] could not read audit ${args.audit}: ${error.message}\n`);
    }
  }

  if (!args.snapshot) {
    stderr.write("[coverage] --snapshot=<path> required\n");
    exit(1);
  }
  const snapshot = JSON.parse(readFileSync(args.snapshot, "utf8"));

  const snapshotPositions = Array.isArray(snapshot.protocolPositions) ? snapshot.protocolPositions : [];
  const readerErrors = Array.isArray(snapshot.reader_errors) ? snapshot.reader_errors : [];
  const totals = snapshot.totals || null;
  const tolUsd = Number(args["tolerance-usd"] ?? 1);
  const tolPct = Number(args["tolerance-pct"] ?? 0.005);
  const result = evaluateCoverage({
    auditPositions,
    snapshotPositions,
    readerErrors,
    totals,
    tolUsd,
    tolPct,
  });
  stdout.write(JSON.stringify(result, null, 2) + "\n");

  const t1 = result.track1;
  if (!t1.pass) {
    stderr.write(
      `[coverage] TRACK1 FAIL accounted=${t1.accounted}/${t1.total} missing=${t1.missing.length} silentSkips=${t1.silentSkips} unlabeled=${t1.unlabeled.length} readerErrors=${t1.readerErrorCount} protocolUsd=${t1.protocolUsd}\n`,
    );
  } else if (!result.track2.pass) {
    stderr.write(`[coverage] TRACK1 PASS, TRACK2 WARN ${result.track2.outOfTolerance.length} positions outside tolerance\n`);
  } else {
    stderr.write(`[coverage] PASS ${t1.accounted} positions accounted, value drift within tolerance\n`);
  }

  // Machine-parsable final line.
  stdout.write(`${JSON.stringify({ track: "track1", pass: t1.pass, ...t1 })}\n`);

  exit(t1.pass ? 0 : 2);
}

const isMain = import.meta.url === `file://${argv[1]}`;
if (isMain) {
  main().catch((e) => {
    stderr.write(`[coverage] error: ${e.message}\n`);
    exit(2);
  });
}
