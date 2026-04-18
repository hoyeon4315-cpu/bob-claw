#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { PAYBACK_CONFIG } from "../config/payback.mjs";
import { loadLivePaybackReceiptStore, loadPaybackAuditLog } from "../executor/ingestor/execution-receipt-ingest.mjs";
import { buildPaybackDashboardSlice } from "../executor/payback/dashboard.mjs";
import { buildCompositePaybackPlan, buildPaybackDecision, loadPaybackPolicyConfig } from "../executor/payback/scheduler.mjs";

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

async function collectPaybackStatus({ btcDestination = null } = {}) {
  const policy = loadPaybackPolicyConfig(PAYBACK_CONFIG);
  const recipientEnvName = policy.destinationPath.bitcoinDestAddressEnv;
  return withTemporaryEnv(recipientEnvName, btcDestination, async () => {
    const [auditLogLines, receiptStore] = await Promise.all([
      loadPaybackAuditLog(),
      loadLivePaybackReceiptStore({ dataDir: config.dataDir }),
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
    }
    return {
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
  if (report.payback?.scheduler?.previewAfterDestination) {
    console.log(`previewAfterDestinationStatus=${report.payback.scheduler.previewAfterDestination.status || "n/a"}`);
    console.log(`previewAfterDestinationReason=${report.payback.scheduler.previewAfterDestination.reason || "n/a"}`);
    console.log(`previewGrossTargetBeforeCostsSats=${report.payback.scheduler.previewAfterDestination.grossTargetBeforeCostsSats ?? "n/a"}`);
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
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
