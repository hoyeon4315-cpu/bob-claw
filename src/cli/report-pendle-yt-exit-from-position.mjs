#!/usr/bin/env node

// True read-only producer CLI for `pendle_yt_exit_from_position`.
// Reads protocol-position-marks.jsonl + merkl-canary-queue.json, derives
// exit EV from actual open YT balance × Pendle fair-value spot quote,
// minus chain-specific exit + gas cost floor. Never calls the signer.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildPendleYtExitFromPositionReport } from "../strategy/pendle-yt-exit-from-position.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const protocolPositionMarks = await readJsonl(config.dataDir, "protocol-position-marks");
  const canaryQueue = await readJsonIfExists(join(config.dataDir, "merkl-canary-queue.json"));
  const report = buildPendleYtExitFromPositionReport({
    protocolPositionMarks,
    canaryQueue,
    now: new Date().toISOString(),
  });

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "pendle-yt-exit-from-position-latest.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`openPositionCount=${report.openPositionCount}`);
  console.log(`evidencedCount=${report.evidencedCount}`);
  for (const row of report.results) {
    if (row.evidenced) {
      console.log(
        `${row.chain}/${row.opportunityId} ytAmount=${row.ytAmount} ytPriceInAsset=${row.ytPriceInAsset} expectedNetUsd=${row.expectedNetUsd?.toFixed(4)} costFloor=${row.costFloorUsd}`,
      );
    } else {
      console.log(`${row.chain || "?"}/${row.opportunityId} MISSING ${row.missingFields.join(",")}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
