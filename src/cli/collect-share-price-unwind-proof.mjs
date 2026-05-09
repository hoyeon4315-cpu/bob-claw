#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import {
  collectSharePriceUnwindProofRecords,
  writeSharePriceUnwindProofRecords,
} from "../executor/proof/share-price-unwind-proof.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function optionValue(argv, name) {
  const prefix = `${name}=`;
  const raw = argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function parseArgs(argv = []) {
  return {
    json: hasFlag(argv, "--json"),
    candidateId: optionValue(argv, "--candidate-id"),
    limit: Number(optionValue(argv, "--limit") || Number.POSITIVE_INFINITY),
    proofPath: optionValue(argv, "--proof-path"),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function runCollectSharePriceUnwindProofCli(
  argv = process.argv.slice(2),
  { cwd = process.cwd(), now = new Date().toISOString() } = {},
) {
  const args = parseArgs(argv);
  const dataDir = resolve(cwd, config.dataDir);
  const proofPath = args.proofPath ? resolve(cwd, args.proofPath) : join(dataDir, "share-price-unwind-proofs.jsonl");
  const [candidates, merklQueue] = await Promise.all([
    readRadarJsonl(dataDir, "executable-candidates").catch(() => []),
    readJsonIfExists(join(dataDir, "merkl-canary-queue.json")),
  ]);
  const collection = collectSharePriceUnwindProofRecords({
    candidates,
    merklQueue,
    candidateId: args.candidateId,
    limit: args.limit,
    now,
  });
  const writeResult = await writeSharePriceUnwindProofRecords(proofPath, collection.records);
  const payload = {
    ...collection,
    proofPath,
    writeResult,
  };
  const stdout = args.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : [
        `collected=${payload.collectedCount}`,
        `skipped=${payload.skippedCount}`,
        `proofPath=${proofPath}`,
      ].join("\n") + "\n";
  return { exitCode: 0, stdout, payload };
}

if (IS_MAIN) {
  runCollectSharePriceUnwindProofCli().then((result) => {
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
