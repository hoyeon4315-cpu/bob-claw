#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

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
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.reviewPackage;

  if (args.write) {
    const outputPath = join(config.dataDir, "prelive-review-package.json");
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

  console.log(`packageStatus=${report.packageStatus}`);
  console.log(`readyForManualReview=${report.readyForManualReview}`);
  console.log(`currentStage=${report.currentStage}`);
  console.log(`reviewDecision=${report.reviewDecision}`);
  console.log(`reviewBlockers=${report.reviewBlockers.join(",") || "none"}`);
  console.log(`liveDecision=${report.liveDecision}`);
  console.log(`liveBlockers=${report.liveBlockers.join(",") || "none"}`);
  if (report.manualReviewCandidate) {
    console.log(`candidate=${report.manualReviewCandidate.routeLabel} amount=${report.manualReviewCandidate.amount} readiness=${report.manualReviewCandidate.tradeReadiness}`);
  }
  if (report.measuredLeaderReview) {
    console.log(`measuredLeader=${report.measuredLeaderReview.routeLabel || report.measuredLeaderReview.routeKey} next=${report.measuredLeaderReview.nextActionCode || "none"}`);
  }
  console.log(
    `simulationProgress=${report.preliveEvidence?.mechanicalSimulation?.successCount || 0}/${report.preliveEvidence?.mechanicalSimulation?.targetSuccessCount || 0}`,
  );
  console.log(
    `forkProgress=${report.preliveEvidence?.forkExecution?.confirmedCount || 0}/${report.preliveEvidence?.forkExecution?.targetConfirmedCount || 0}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
