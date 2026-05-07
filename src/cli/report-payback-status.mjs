#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { PAYBACK_CONFIG } from "../config/payback.mjs";
import { loadLivePaybackReceiptStore, loadPaybackAuditLog } from "../executor/ingestor/execution-receipt-ingest.mjs";
import { buildPaybackDashboardSlice } from "../executor/payback/dashboard.mjs";
import { buildPaybackDeliveryRunway } from "../executor/payback/delivery-runway.mjs";
import {
  buildCompositePaybackPlan,
  buildPaybackDecision,
  buildPreMinimumPaybackCostPreview,
  loadPaybackPolicyConfig,
} from "../executor/payback/scheduler.mjs";

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
    btcDestination: options["btc-destination"] || null,
  };
}

function withTemporaryEnv(name, value, fn) {
  if (value == null || value === "") {
    return Promise.resolve().then(fn);
  }
  const hadOwn = Object.prototype.hasOwnProperty.call(process.env, name);
  const previous = process.env[name];
  process.env[name] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (hadOwn) {
        process.env[name] = previous;
      } else {
        delete process.env[name];
      }
    });
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function collectPaybackStatus({ btcDestination = null } = {}) {
  const policy = loadPaybackPolicyConfig(PAYBACK_CONFIG);
  const recipientEnvName = policy.destinationPath.bitcoinDestAddressEnv;
  return withTemporaryEnv(recipientEnvName, btcDestination, async () => {
    const [auditLogLines, receiptStore, merklAllocatorReport, merklCanaryReport, allChainReport] = await Promise.all([
      loadPaybackAuditLog(),
      loadLivePaybackReceiptStore({ dataDir: config.dataDir }),
      readJsonIfExists(join(config.dataDir, "merkl-portfolio-allocator-latest.json")),
      readJsonIfExists(join(config.dataDir, "merkl-canary-autopilot-latest.json")),
      readJsonIfExists(join(config.dataDir, "all-chain-autopilot-latest.json")),
    ]);
    const payback = await buildPaybackDashboardSlice({
      dataDir: config.dataDir,
      auditLogLines,
      receiptStore,
    });
    const decision = await buildPaybackDecision({
      auditLogLines,
      receiptStore,
    });
    let compositePreview = null;
    let preMinimumCompositePreview = null;
    if (decision.status === "plan") {
      try {
        compositePreview = await buildCompositePaybackPlan({
          decision,
        });
      } catch (error) {
        compositePreview = {
          status: "blocked",
          reason: "composite_preview_failed",
          error: error.message,
          compositePlan: null,
        };
      }
    } else if (decision.status === "carry" && decision.reason === "planned_payback_below_minimum") {
      try {
        preMinimumCompositePreview = await buildPreMinimumPaybackCostPreview({
          decision,
        });
      } catch (error) {
        preMinimumCompositePreview = {
          status: "blocked",
          reason: "pre_minimum_preview_failed",
          error: error.message,
          executionEligible: false,
          intentEligible: false,
        };
      }
    }
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      policy: {
        bitcoinDestAddressEnv: recipientEnvName,
        profitReserveChain: policy.destinationPath.profitReserveChain,
        minPaybackSats: policy.minPaybackSats,
        perPeriodMaxSats: policy.perPeriodMaxSats,
      },
      override: {
        btcDestinationApplied: btcDestination || null,
      },
      payback,
      decision: {
        status: decision.status,
        reason: decision.reason,
        snapshot: decision.snapshot,
      },
      compositePreview: compositePreview
        ? {
            status: compositePreview.status,
            reason: compositePreview.reason,
            error: compositePreview.error || null,
            stepCount: compositePreview.compositePlan?.steps?.length || 0,
            plannedPaybackSats: compositePreview.compositePlan?.plannedPaybackSats || null,
            estimatedOfframpCostSats: compositePreview.compositePlan?.estimatedOfframpCostSats || null,
          }
        : null,
      preMinimumCompositePreview: preMinimumCompositePreview
        ? {
            status: preMinimumCompositePreview.status,
            reason: preMinimumCompositePreview.reason,
            error: preMinimumCompositePreview.error || null,
            executionEligible: preMinimumCompositePreview.executionEligible === true,
            intentEligible: preMinimumCompositePreview.intentEligible === true,
            stepCount: preMinimumCompositePreview.steps?.length || 0,
            previewInputSats: preMinimumCompositePreview.previewInputSats ?? null,
            grossTargetBeforeCostsSats: preMinimumCompositePreview.grossTargetBeforeCostsSats ?? null,
            minPaybackSats: preMinimumCompositePreview.minPaybackSats ?? null,
            requiredGrossBeforeCostsSats: preMinimumCompositePreview.requiredGrossBeforeCostsSats ?? null,
            plannedPaybackSats: preMinimumCompositePreview.estimatedNetPaybackSats ?? null,
            estimatedOfframpCostSats: preMinimumCompositePreview.estimatedOfframpCostSats ?? null,
            satsToMinimumAfterCosts: preMinimumCompositePreview.satsToMinimumAfterCosts ?? null,
          }
        : null,
    };
    return {
      ...report,
      runway: buildPaybackDeliveryRunway({
        paybackStatus: report,
        merklAllocatorReport,
        merklCanaryReport,
        allChainReport,
        now: report.observedAt,
      }),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await collectPaybackStatus({
    btcDestination: args.btcDestination,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`schedulerStatus=${report.payback?.scheduler?.status || "n/a"}`);
  console.log(`schedulerReason=${report.payback?.scheduler?.reason || "n/a"}`);
  console.log(`requiredEnvName=${report.payback?.scheduler?.requiredEnvName || report.policy.bitcoinDestAddressEnv || "n/a"}`);
  console.log(`nextAction=${report.payback?.scheduler?.nextAction || "n/a"}`);
  console.log(`grossProfitSatsPeriod=${report.payback?.grossProfitSatsPeriod ?? 0}`);
  console.log(`accumulatorPendingSats=${report.payback?.accumulatorPendingSats ?? 0}`);
  console.log(`paidBackSatsLifetime=${report.payback?.paidBackSatsLifetime ?? 0}`);
  if (report.payback?.scheduler?.minimumPaybackProgress) {
    console.log(`minimumPaybackProgressSource=${report.payback.scheduler.minimumPaybackProgress.source || "n/a"}`);
    console.log(`minimumPaybackStatus=${report.payback.scheduler.minimumPaybackProgress.status || "n/a"}`);
    console.log(`minimumPaybackReason=${report.payback.scheduler.minimumPaybackProgress.reason || "n/a"}`);
    console.log(
      `minimumGrossTargetBeforeCostsSats=${report.payback.scheduler.minimumPaybackProgress.grossTargetBeforeCostsSats ?? "n/a"}`,
    );
    console.log(
      `minimumRequiredGrossProfitSats=${report.payback.scheduler.minimumPaybackProgress.requiredGrossProfitSats ?? "n/a"}`,
    );
    console.log(`minimumPaybackSats=${report.payback.scheduler.minimumPaybackProgress.minPaybackSats ?? "n/a"}`);
    console.log(
      `minimumSatsToThreshold=${report.payback.scheduler.minimumPaybackProgress.satsToMinimumPayback ?? "n/a"}`,
    );
    console.log(
      `minimumProgressToThresholdRatio=${report.payback.scheduler.minimumPaybackProgress.progressToMinimumRatio ?? "n/a"}`,
    );
  }
  if (report.payback?.scheduler?.previewAfterDestination) {
    console.log(`previewAfterDestinationStatus=${report.payback.scheduler.previewAfterDestination.status || "n/a"}`);
    console.log(`previewAfterDestinationReason=${report.payback.scheduler.previewAfterDestination.reason || "n/a"}`);
    console.log(`previewGrossTargetBeforeCostsSats=${report.payback.scheduler.previewAfterDestination.grossTargetBeforeCostsSats ?? "n/a"}`);
    console.log(`previewRequiredGrossProfitSats=${report.payback.scheduler.previewAfterDestination.requiredGrossProfitSats ?? "n/a"}`);
    console.log(`previewMinPaybackSats=${report.payback.scheduler.previewAfterDestination.minPaybackSats ?? "n/a"}`);
    console.log(`previewSatsToMinimumPayback=${report.payback.scheduler.previewAfterDestination.satsToMinimumPayback ?? "n/a"}`);
    console.log(`previewProgressToMinimumRatio=${report.payback.scheduler.previewAfterDestination.progressToMinimumRatio ?? "n/a"}`);
  }
  if (report.override.btcDestinationApplied) {
    console.log(`btcDestinationOverride=${report.override.btcDestinationApplied}`);
  }
  if (report.compositePreview) {
    console.log(`compositePreviewStatus=${report.compositePreview.status}`);
    console.log(`compositePreviewReason=${report.compositePreview.reason}`);
    console.log(`compositePreviewStepCount=${report.compositePreview.stepCount}`);
    console.log(`plannedPaybackSats=${report.compositePreview.plannedPaybackSats ?? "n/a"}`);
    console.log(`estimatedOfframpCostSats=${report.compositePreview.estimatedOfframpCostSats ?? "n/a"}`);
  }
  if (report.preMinimumCompositePreview) {
    console.log(`preMinimumCompositePreviewStatus=${report.preMinimumCompositePreview.status}`);
    console.log(`preMinimumCompositePreviewReason=${report.preMinimumCompositePreview.reason}`);
    console.log(`preMinimumCompositePreviewExecutionEligible=${report.preMinimumCompositePreview.executionEligible}`);
    console.log(`preMinimumCompositePreviewIntentEligible=${report.preMinimumCompositePreview.intentEligible}`);
    console.log(`preMinimumPreviewInputSats=${report.preMinimumCompositePreview.previewInputSats ?? "n/a"}`);
    console.log(`preMinimumEstimatedOfframpCostSats=${report.preMinimumCompositePreview.estimatedOfframpCostSats ?? "n/a"}`);
    console.log(`preMinimumSatsToMinimumAfterCosts=${report.preMinimumCompositePreview.satsToMinimumAfterCosts ?? "n/a"}`);
  }
  if (report.runway) {
    console.log(`runwayGoal=${report.runway.finalGoal}`);
    console.log(`runwayStatus=${report.runway.status}`);
    console.log(`runwayNext=${report.runway.nextActions?.[0]?.code || "n/a"}`);
    const topBlocker = report.runway.blockers?.[0];
    if (topBlocker) console.log(`runwayTopBlocker=${topBlocker.source}:${topBlocker.code}`);
  }
  const expansionGate = report.payback?.expansionGate;
  if (expansionGate) {
    console.log(`expansionReserveChain=${expansionGate.reserveChain}`);
    console.log(`expansionTargetEfficiency=${expansionGate.targetEfficiency}`);
    console.log(`expansionRequiredConsecutivePeriods=${expansionGate.requiredConsecutivePeriods}`);
    console.log(`expansionConsecutivePeriodsMeetingTarget=${expansionGate.consecutivePeriodsMeetingTarget}`);
    console.log(`expansionPeriodsRemaining=${expansionGate.periodsRemaining}`);
    console.log(`expansionEligible=${expansionGate.eligible}`);
    console.log(`expansionDeliveredPeriodCountOnReserveChain=${expansionGate.deliveredPeriodCountOnReserveChain}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
