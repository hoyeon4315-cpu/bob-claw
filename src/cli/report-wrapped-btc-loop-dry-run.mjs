#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../strategy/wrapped-btc-lending-loop-slice.mjs";
import { buildWrappedBtcLendingLoopDryRunPacket } from "../strategy/wrapped-btc-lending-loop-dry-run.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scaffold =
    (await readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json"))) || buildWrappedBtcLendingLoopScaffold();
  const latestDryRun = await readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-dry-run-latest.json"));
  const report = buildWrappedBtcLendingLoopDryRunPacket({ scaffold });

  if (args.write) {
    const outputPath = join(config.dataDir, "wrapped-btc-lending-loop-dry-run.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`technicalStatus=${report.readiness?.technicalStatus || "n/a"}`);
  console.log(`evidenceStatus=${report.readiness?.evidenceStatus || "n/a"}`);
  if (latestDryRun) {
    console.log(
      `latestReceipt=${latestDryRun.latestRun?.result || "n/a"} autoUnwindPassCount=${latestDryRun.autoUnwindPassCount ?? 0} recorded=${latestDryRun.dryRunReceiptRecorded === true ? "yes" : "no"}`,
    );
  }
  console.log(`entryActions=${report.executionPreview?.entryActionCount ?? 0} unwindActions=${report.executionPreview?.unwindActionCount ?? 0}`);
  for (const item of report.watcherScenarios || []) {
    console.log(`${item.id} watcherStatus=${item.watcherStatus} autoUnwind=${item.shouldAutoUnwind}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
