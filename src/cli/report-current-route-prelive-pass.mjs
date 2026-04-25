#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildCurrentRoutePrelivePassSummary } from "../prelive/current-route-prelive-pass.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = await readJsonl(config.dataDir, "current-route-prelive-passes");
  const summary = buildCurrentRoutePrelivePassSummary(records);

  if (args.write) {
    const outputPath = join(config.dataDir, "current-route-prelive-pass-summary.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`runCount=${summary.runCount ?? 0}`);
  console.log(`previewCount=${summary.previewCount ?? 0}`);
  console.log(`readyForSignerCount=${summary.readyForSignerCount ?? 0}`);
  console.log(`provenCount=${summary.provenCount ?? 0}`);
  console.log(`blockedCount=${summary.blockedCount ?? 0}`);
  console.log(`partialCount=${summary.partialCount ?? 0}`);
  console.log(`failureCount=${summary.failureCount ?? 0}`);
  console.log(`latestStatus=${summary.latestStatus || "none"}`);
  console.log(`latestMode=${summary.latestMode || "none"}`);
  console.log(`nextAction=${summary.nextAction?.code || "none"}${summary.nextAction?.command ? ` command=${summary.nextAction.command}` : ""}`);
  console.log(`submitCommand=${summary.submitCommand || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
