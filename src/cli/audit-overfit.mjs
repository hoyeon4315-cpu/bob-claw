#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildOverfitAuditArtifact } from "../strategy/phase1-revalidation.mjs";
import { formatAudit } from "../audit/overfit.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const audit = context.dashboardStatus?.audit || null;
  const artifact = buildOverfitAuditArtifact({
    audit,
    strategySnapshot: context.strategySnapshot,
    now: context.dashboardStatus?.generatedAt || new Date().toISOString(),
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "overfit-audit-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  console.log(formatAudit(audit));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
