#!/usr/bin/env node

import {
  buildLiveReadinessRefreshPlan,
  runLiveReadinessRefreshPlan,
  summarizeLiveReadinessRefreshPlan,
} from "../session/live-readiness-refresh.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildLiveReadinessRefreshPlan();

  if (!args.write) {
    if (args.json) {
      console.log(JSON.stringify({ plan, commands: summarizeLiveReadinessRefreshPlan(plan) }, null, 2));
      return;
    }
    for (const command of summarizeLiveReadinessRefreshPlan(plan)) {
      console.log(command);
    }
    return;
  }

  const results = runLiveReadinessRefreshPlan({ plan });
  if (args.json) {
    console.log(JSON.stringify({ plan, results }, null, 2));
    return;
  }
  console.log(`refreshed=${results.length}`);
  console.log(`firstStep=${results[0]?.script || "n/a"}`);
  console.log(`lastStep=${results.at(-1)?.script || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stderr || error.stack || error.message);
  process.exitCode = 1;
});
