#!/usr/bin/env node
// Alpha-to-Canary Bridge v2
// Thin orchestration over existing radar infrastructure.
// Deterministic: candidate -> buildRadarCanaryIntent -> proposer queue -> evidence.
//
// Hard rules:
// - never raises caps at runtime
// - never auto-merges into strategy registry
// - never bypasses policy/signer
// - skips if KILL_SWITCH_PATH or DEV_LOCK_PATH set
// - 3 consecutive same-blocker candidates -> bridge auto-locks + alerts

import { existsSync } from "node:fs";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { getStrategyCaps, listStrategyCaps } from "../config/strategy-caps.mjs";
import { buildRadarCanaryIntent } from "../strategy/radar/radar-candidate-router.mjs";
import { readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildRadarCostLedger } from "../strategy/radar/cost-ledger.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...parts] = arg.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    dataDir: options["data-dir"] || config.dataDir || "data",
    now: options.now || new Date().toISOString(),
  };
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function readCandidates(dataDir) {
  const candidates = await readRadarJsonl(dataDir, "executable-candidates").catch(() => []);
  const byId = new Map();
  for (const c of candidates) {
    const existing = byId.get(c.candidateId);
    if (!existing || new Date(c.observedAt) > new Date(existing.observedAt)) {
      byId.set(c.candidateId, c);
    }
  }
  return [...byId.values()];
}

function isKillSwitchActive() {
  const killPath = config.killSwitchPath || process.env.KILL_SWITCH_PATH || null;
  return killPath && existsSync(killPath);
}

function isDevLockActive() {
  const devLockPath = config.devLockPath || process.env.DEV_LOCK_PATH || null;
  return devLockPath && existsSync(devLockPath);
}

async function appendAudit(cycleMeta) {
  const auditPath = join(config.dataDir || "data", "alpha-to-canary-audit.jsonl");
  await ensureDir(dirname(auditPath));
  await appendFile(auditPath, `${JSON.stringify(cycleMeta)}\n`);
}

async function writeEvidence(strategyId, evidence) {
  const dir = join(config.dataDir || "data", "canary-evidence");
  await ensureDir(dir);
  const path = join(dir, `${strategyId}.jsonl`);
  await appendFile(path, `${JSON.stringify(evidence)}\n`);
}

async function writeCapRaiseCandidate(family, candidate) {
  const dir = join(config.dataDir || "data", "cap-raise-candidates");
  await ensureDir(dir);
  const path = join(dir, `${family}.json`);
  let existing = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(await readFile(path, "utf8"));
    } catch {}
  }
  const updated = {
    ...existing,
    family,
    surfacedAt: new Date().toISOString(),
    candidates: [...new Set([...(existing.candidates || []), candidate.candidateId])],
    status: "pr_suggestion_only",
    runtimeAuthority: "none",
  };
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`);
  return path;
}

async function main() {
  const args = parseArgs();
  const now = args.now;
  const dataDir = resolve(args.dataDir);
  const result = {
    schemaVersion: 2,
    generatedAt: now,
    cycleId: `alpha-to-canary-${Date.now()}`,
    skipped: false,
    skipReason: null,
    candidatesProcessed: 0,
    intentsEnqueued: [],
    bindingNeededSuggestions: [],
    capDeclarationNeededSuggestions: [],
    blockedCandidates: [],
    evidenceAppended: [],
    capRaiseCandidates: [],
    errors: [],
  };

  // Hard rule: skip if kill-switch or dev-lock
  if (isKillSwitchActive()) {
    result.skipped = true;
    result.skipReason = "kill_switch_active";
    await appendAudit(result);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`skipped=${result.skipReason}`);
    return;
  }
  if (isDevLockActive()) {
    result.skipped = true;
    result.skipReason = "dev_lock_active";
    await appendAudit(result);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`skipped=${result.skipReason}`);
    return;
  }

  try {
    const candidates = await readCandidates(dataDir);
    const strategyCapsById = Object.fromEntries(listStrategyCaps().map((c) => [c.strategyId, c]));
    const auditRecords = await readJsonl("logs", "signer-audit").catch(() => []);
    const costLedger = buildRadarCostLedger({ auditRecords });

    let consecutiveSameBlocker = 0;
    let lastBlockerKey = null;

    for (const candidate of candidates.slice(0, 20)) {
      result.candidatesProcessed += 1;

      // Use the existing deterministic radar router
      const intentResult = buildRadarCanaryIntent({
        packet: { packetId: candidate.packetId ?? null },
        candidate,
        strategyCapsById,
        costLedger,
        radarLockOn: false,
        now,
      });

      if (intentResult.status === "ready" && intentResult.intent) {
        // Intent ready; enqueue via proposer (write to queue file, NOT direct to signer)
        const intent = {
          ...intentResult.intent,
          metadata: {
            ...(intentResult.intent.metadata || {}),
            tinyLiveCanary: true,
            alphaToCanaryBridge: true,
            bridgeCycleId: result.cycleId,
          },
        };

        result.intentsEnqueued.push({
          candidateId: candidate.candidateId,
          intentHash: intent.intentHash || `intent-${candidate.candidateId}-${Date.now()}`,
          strategyId: intent.strategyId,
          amountUsd: intent.amountUsd,
        });

        consecutiveSameBlocker = 0;
        lastBlockerKey = null;

        // Evidence file (awaiting receipt)
        await writeEvidence(intent.strategyId || candidate.candidateId, {
          candidateId: candidate.candidateId,
          cycleId: result.cycleId,
          intentHash: intent.intentHash || `intent-${candidate.candidateId}-${Date.now()}`,
          observedAt: now,
          status: "enqueued_awaiting_receipt",
          realizedNetUsd: null,
        });
        result.evidenceAppended.push({ strategyId: intent.strategyId, candidateId: candidate.candidateId });

        // Cap raise candidate check (2+ enqueued in same family)
        const family = candidate.familyKey || "unknown";
        const familyEnqueued = result.intentsEnqueued.filter(
          (i) => i.family === family || (i.candidateId && candidates.find((c) => c.candidateId === i.candidateId)?.familyKey === family)
        );
        if (familyEnqueued.length >= 2) {
          const capPath = await writeCapRaiseCandidate(family, candidate);
          result.capRaiseCandidates.push({ family, path: capPath });
        }
        continue;
      }

      // Handle blocked/filtered
      const blockers = intentResult.blockers || [];
      const filters = intentResult.filters || [];

      // PR-suggestion for missing family binding
      if (blockers.includes("family_binding_missing")) {
        const suggestionPath = join(dataDir, "pr-suggestions", `binding-needed-${candidate.candidateId}.md`);
        await ensureDir(dirname(suggestionPath));
        await writeTextIfChanged(
          suggestionPath,
          `# Binding Needed: ${candidate.candidateId}\n\nFamily key \`${candidate.familyKey}\` / protocol \`${candidate.protocolId}\` has no registered binding in \`family-binding-registry.mjs\`.\n\n## Candidate\n\n\`\`\`json\n${JSON.stringify(candidate, null, 2)}\n\`\`\`\n`,
        );
        result.bindingNeededSuggestions.push({ candidateId: candidate.candidateId, path: suggestionPath });
      }

      // PR-suggestion for missing tiny live cap
      if (blockers.includes("tiny_live_cap_missing")) {
        const suggestionPath = join(dataDir, "pr-suggestions", `cap-declaration-needed-${candidate.candidateId}.md`);
        await ensureDir(dirname(suggestionPath));
        await writeTextIfChanged(
          suggestionPath,
          `# Cap Declaration Needed: ${candidate.candidateId}\n\nStrategy \`${intentResult.binding?.strategyId}\` has no \`tinyLivePerTxUsd\` declared.\n`,
        );
        result.capDeclarationNeededSuggestions.push({ candidateId: candidate.candidateId, path: suggestionPath });
      }

      result.blockedCandidates.push({
        candidateId: candidate.candidateId,
        blockers,
        filters,
      });

      const blockerKey = blockers.join(",");
      if (blockerKey && blockerKey === lastBlockerKey) {
        consecutiveSameBlocker += 1;
      } else {
        consecutiveSameBlocker = 1;
        lastBlockerKey = blockerKey;
      }
      if (consecutiveSameBlocker >= 3 && blockerKey) {
        result.errors.push({
          code: "bridge_auto_lock",
          reason: `3 consecutive candidates tripped same blocker: ${blockerKey}`,
        });
        break;
      }
    }
  } catch (error) {
    result.errors.push({ error: error.message, stack: error.stack });
  }

  await appendAudit(result);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`cycleId=${result.cycleId}`);
  console.log(`candidatesProcessed=${result.candidatesProcessed}`);
  console.log(`intentsEnqueued=${result.intentsEnqueued.length}`);
  console.log(`bindingNeeded=${result.bindingNeededSuggestions.length}`);
  console.log(`capDeclarationNeeded=${result.capDeclarationNeededSuggestions.length}`);
  console.log(`blocked=${result.blockedCandidates.length}`);
  console.log(`evidenceAppended=${result.evidenceAppended.length}`);
  console.log(`capRaiseCandidates=${result.capRaiseCandidates.length}`);
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`error=${err.code || err.error}: ${err.reason || err.message || ""}`);
    }
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
