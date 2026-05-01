#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildRadarCostLedger } from "../strategy/radar/cost-ledger.mjs";
import { readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import { buildRadarCanaryIntent } from "../strategy/radar/radar-candidate-router.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function packetById(packets = []) {
  return new Map(packets.map((packet) => [packet.packetId, packet]));
}

function buildStrategyCapsById() {
  return Object.fromEntries(listStrategyCaps().map((config) => [config.strategyId, config]));
}

function candidateObservedAtMs(candidate = {}) {
  const parsed = Date.parse(candidate.observedAt || candidate.metadata?.syncedAt || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestCandidatesById(candidates = []) {
  const latest = new Map();
  for (const candidate of candidates) {
    const id = candidate?.candidateId;
    if (!id) continue;
    const existing = latest.get(id);
    if (!existing || candidateObservedAtMs(candidate) >= candidateObservedAtMs(existing)) {
      latest.set(id, candidate);
    }
  }
  return [...latest.values()];
}

async function fileExists(path) {
  if (!path || path === true) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs();
  const dataDir = resolve(args["data-dir"] || "data");
  const packets = await readRadarJsonl(dataDir, "portable-packets");
  const candidates = latestCandidatesById(await readRadarJsonl(dataDir, "executable-candidates"));
  const auditRecords = await readJsonl("logs", "signer-audit").catch(() => []);
  const packetsById = packetById(packets);
  const strategyCapsById = buildStrategyCapsById();
  const costLedger = buildRadarCostLedger({ auditRecords });
  const now = args.now === true ? new Date().toISOString() : args.now || new Date().toISOString();
  const radarLockPath = args["radar-lock-path"] || process.env.RADAR_LOCK_PATH || null;
  const radarLockOn = await fileExists(radarLockPath);

  const results = candidates.map((candidate) => buildRadarCanaryIntent({
    packet: packetsById.get(candidate.packetId) ?? { packetId: candidate.packetId ?? null },
    candidate,
    strategyCapsById,
    costLedger,
    radarLockOn,
    now,
  }));
  const intents = results
    .filter((result) => result.status === "ready")
    .map((result) => result.intent);
  const blocked = results
    .filter((result) => result.status !== "ready")
    .map((result, index) => ({
      candidateId: candidates[index]?.candidateId ?? null,
      blockers: result.blockers ?? [],
      ev: result.ev ?? null,
    }));
  const mode = args.execute ? "execute" : "preview";
  const queue = {
    generatedAt: now,
    mode,
    signed: false,
    radarLockOn,
    radarLockPath,
    intents,
    blocked,
  };

  if (args.write && args.write !== true) {
    const outputPath = resolve(args.write);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(queue, null, 2)}\n`);
    console.log(`wrote=${outputPath}`);
  } else if (!args.execute) {
    console.log(JSON.stringify(queue, null, 2));
  }

  console.log(`mode=${mode}`);
  console.log(`ready=${intents.length}`);
  console.log(`blocked=${blocked.length}`);
  console.log("signed=false");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
