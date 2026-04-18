#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import {
  buildRecursiveLendingLoopDryRunPacket,
  recursiveLendingLoopDryRunSessionName,
} from "../strategy/recursive-lending-loop-dry-run.mjs";
import {
  buildDefaultRecursiveLendingLoopConfig,
  buildRecursiveLendingLoopScaffold,
  listRecursiveLendingLoopStrategyIds,
} from "../strategy/recursive-lending-loop-slice.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    strategy: options.strategy || "recursive_wrapped_btc_lending_loop",
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!listRecursiveLendingLoopStrategyIds().includes(args.strategy)) {
    throw new Error(`Unsupported strategy: ${args.strategy}`);
  }
  const strategyConfig = buildDefaultRecursiveLendingLoopConfig(args.strategy);
  const scaffold =
    (await readJsonIfExists(join(config.dataDir, `${strategyConfig.id}-scaffold.json`))) ||
    buildRecursiveLendingLoopScaffold({
      strategyId: strategyConfig.id,
      strategyConfig,
    });
  const latestDryRun = await readJsonIfExists(join(config.dataDir, `${strategyConfig.id}-dry-run-latest.json`));
  const report = buildRecursiveLendingLoopDryRunPacket({ scaffold });

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, `${strategyConfig.id}-dry-run.json`), `${JSON.stringify(report, null, 2)}\n`, {
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

  console.log(`strategy=${strategyConfig.id}`);
  console.log(`session=${recursiveLendingLoopDryRunSessionName(strategyConfig.id)}`);
  console.log(`technicalStatus=${report.readiness?.technicalStatus || "n/a"}`);
  console.log(`evidenceStatus=${report.readiness?.evidenceStatus || "n/a"}`);
  if (latestDryRun) {
    console.log(
      `latestReceipt=${latestDryRun.latestRun?.result || "n/a"} signerBackedRunCount=${latestDryRun.signerBackedRunCount ?? 0} recorded=${latestDryRun.dryRunReceiptRecorded === true ? "yes" : "no"}`,
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
