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
import { argv, exit, stdin, stdout, stderr } from "node:process";

function parseArgs(arr) {
  const out = {};
  for (const a of arr) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = true;
  }
  return out;
}

export function evaluateCoverage({ auditPositions, snapshotPositions, tolUsd = 1, tolPct = 0.005 }) {
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
  const track1Pass = missing.length === 0 && silentSkips === 0 && unlabeled.length === 0;

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
    },
    track2: {
      pass: track2Pass,
      tolerance: { usd: tolUsd, pct: tolPct },
      outOfTolerance,
    },
  };
}

async function readStdin() {
  let buf = "";
  for await (const chunk of stdin) buf += chunk;
  return buf;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  if (!args.audit) {
    stderr.write("[coverage] --audit=<path> required\n");
    exit(2);
  }
  const auditLines = readFileSync(args.audit, "utf8").split(/\n/).filter(Boolean);
  const auditPositions = [];
  for (const line of auditLines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.positionId) auditPositions.push(obj);
    } catch {
      // ignore bad lines
    }
  }

  const snapshot = args.snapshot
    ? JSON.parse(readFileSync(args.snapshot, "utf8"))
    : JSON.parse(await readStdin());

  const snapshotPositions = Array.isArray(snapshot.protocolPositions) ? snapshot.protocolPositions : [];
  const tolUsd = Number(args["tolerance-usd"] ?? 1);
  const tolPct = Number(args["tolerance-pct"] ?? 0.005);
  const result = evaluateCoverage({ auditPositions, snapshotPositions, tolUsd, tolPct });
  stdout.write(JSON.stringify(result, null, 2) + "\n");

  const t1 = result.track1;
  if (!t1.pass) {
    stderr.write(`[coverage] TRACK1 FAIL accounted=${t1.accounted}/${t1.total} missing=${t1.missing.length} silentSkips=${t1.silentSkips} unlabeled=${t1.unlabeled.length}\n`);
    exit(1);
  }
  if (!result.track2.pass) {
    stderr.write(`[coverage] TRACK1 PASS, TRACK2 WARN ${result.track2.outOfTolerance.length} positions outside tolerance\n`);
  } else {
    stderr.write(`[coverage] PASS ${t1.accounted} positions accounted, value drift within tolerance\n`);
  }
  exit(0);
}

const isMain = import.meta.url === `file://${argv[1]}`;
if (isMain) {
  main().catch((e) => {
    stderr.write(`[coverage] error: ${e.message}\n`);
    exit(2);
  });
}
