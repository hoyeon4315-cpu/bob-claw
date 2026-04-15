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
  if (report.tinyCanaryAdmission) {
    console.log(`tinyCanaryAdmission=${report.tinyCanaryAdmission.decision}`);
    console.log(`tinyCanaryAdmissionStatus=${report.tinyCanaryAdmission.status}`);
    console.log(`tinyCanaryAdmissionBlockers=${report.tinyCanaryAdmission.blockers.join(",") || "none"}`);
  }
  if (report.remediationPlan) {
    console.log(
      `admissionRemediation=${report.remediationPlan.overallStatus} ready=${report.remediationPlan.readyCount} manual=${report.remediationPlan.manualCount} blocked=${report.remediationPlan.blockedCount}`,
    );
    console.log(`admissionRemediationRunner=${report.remediationPlan.runnerCommand || "n/a"}`);
    if (report.remediationPlan.nextAction) {
      console.log(
        `admissionRemediationNext=${report.remediationPlan.nextAction.code || "unknown"} status=${report.remediationPlan.nextAction.status || "unknown"} command=${report.remediationPlan.nextAction.command || "n/a"}`,
      );
    }
    for (const item of report.remediationPlan.items.slice(0, 3)) {
      console.log(
        `admissionRemediationItem rank=${item.rank ?? "n/a"} status=${item.status || "unknown"} code=${item.code || "unknown"} reason=${item.reason || "none"} command=${item.command || "n/a"}`,
      );
    }
  }
  if (report.manualReviewCandidate) {
    console.log(`candidate=${report.manualReviewCandidate.routeLabel} amount=${report.manualReviewCandidate.amount} readiness=${report.manualReviewCandidate.tradeReadiness}`);
  }
  if (report.measuredLeaderReview) {
    console.log(`measuredLeader=${report.measuredLeaderReview.routeLabel || report.measuredLeaderReview.routeKey} next=${report.measuredLeaderReview.nextActionCode || "none"}`);
  }
  if (report.strategySnapshot) {
    console.log(
      `strategySnapshot=${report.strategySnapshot.implementedStrategyCount || 0} top=${report.strategySnapshot.topImplementedStrategy?.id || "n/a"} pivot=${report.strategySnapshot.topPivot?.id || "n/a"}`,
    );
  }
  if (report.executionRunbook) {
    console.log(
      `executionRunbook=${report.executionRunbook.currentStageId || "n/a"} next=${report.executionRunbook.nextStageId || "n/a"} action=${report.executionRunbook.nextActionCode || "none"}`,
    );
    if (report.executionRunbook.exactRouteForkPlanStatus || report.executionRunbook.exactRouteForkPlanId) {
      console.log(
        `executionRunbookForkPlan=${report.executionRunbook.exactRouteForkPlanStatus || "n/a"} planId=${report.executionRunbook.exactRouteForkPlanId || "n/a"} submit=${report.executionRunbook.exactRouteForkSubmitCommand || "n/a"}`,
      );
    }
  }
  if (report.preliveValidation) {
    console.log(
      `preliveValidation=${report.preliveValidation.validationStatus || "n/a"} next=${report.preliveValidation.nextActionCode || "none"}`,
    );
  }
  if (report.connectedRefreshPackage) {
    console.log(
      `connectedRefresh=${report.connectedRefreshPackage.status || "n/a"} required=${report.connectedRefreshPackage.summary?.requiredRefreshCount ?? report.connectedRefreshPackage.requiredRefreshCount ?? 0} next=${report.connectedRefreshPackage.summary?.nextActionCode || report.connectedRefreshPackage.nextAction?.code || "none"}`,
    );
  }
  if (report.connectedRefreshExecution) {
    console.log(
      `connectedRefreshExecution=runs:${report.connectedRefreshExecution.runCount ?? 0} preview:${report.connectedRefreshExecution.previewCount ?? 0} success:${report.connectedRefreshExecution.successCount ?? 0} latest=${report.connectedRefreshExecution.latestStatus || "none"}`,
    );
  }
  if (report.currentRoutePrelivePass) {
    console.log(
      `currentRoutePrelivePass=runs:${report.currentRoutePrelivePass.runCount ?? 0} preview:${report.currentRoutePrelivePass.previewCount ?? 0} latest=${report.currentRoutePrelivePass.latestStatus || "none"} next=${report.currentRoutePrelivePass.nextAction?.code || "none"}`,
    );
  }
  if (report.exactRouteForkPackage) {
    console.log(
      `exactRouteForkPackage=${report.exactRouteForkPackage.status || "n/a"} planId=${report.exactRouteForkPackage.plan?.planId || report.exactRouteForkPackage.planId || "n/a"} economic=${report.exactRouteForkPackage.readiness?.economicStatus || report.exactRouteForkPackage.economicStatus || "n/a"}`,
    );
  }
  if (report.operationalJudgmentReview) {
    console.log(
      `operationalJudgment=${report.operationalJudgmentReview.status || "n/a"} issues=${report.operationalJudgmentReview.issueCount ?? 0} next=${report.operationalJudgmentReview.nextAction?.code || report.operationalJudgmentReview.nextActionCode || "none"}`,
    );
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
