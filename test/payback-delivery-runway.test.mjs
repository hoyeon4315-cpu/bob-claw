import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaybackDeliveryRunway } from "../src/executor/payback/delivery-runway.mjs";

test("runway prioritizes profit creation when payback is below minimum", () => {
  const report = buildPaybackDeliveryRunway({
    now: "2026-05-07T00:00:00.000Z",
    paybackStatus: {
      payback: {
        grossProfitSatsPeriod: 601,
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          minimumPaybackProgress: {
            grossTargetBeforeCostsSats: 120,
            minPaybackSats: 50_000,
            requiredGrossProfitSats: 250_000,
            satsToMinimumPayback: 49_880,
            progressToMinimumRatio: 0.0024,
          },
        },
      },
    },
    merklCanaryReport: {
      summary: {
        topBlocker: "same_chain_unprofitable:need_$10_on_optimism",
        topEvGate: {
          status: "blocked",
          blocker: "same_chain_unprofitable:need_$10_on_optimism",
          currentAmountUsd: 2.86,
          neededUsd: 9.96,
          holdDays: 13.92,
          limitingFactor: "inventory",
        },
      },
    },
  });

  assert.equal(report.finalGoal, "native_btc_payback_delivery");
  assert.equal(report.status, "profit_creation_required");
  assert.equal(report.current.grossProfitSatsPeriod, 601);
  assert.equal(report.current.satsToMinimumPayback, 49_880);
  assert.equal(report.profitCreation.merklCanaryTopEvGate.neededUsd, 9.96);
  assert.equal(report.blockers[0].code, "planned_payback_below_minimum");
  assert.equal(report.blockers[1].code, "same_chain_unprofitable:need_$10_on_optimism");
  assert.equal(report.nextActions[0].code, "create_payback_eligible_realized_pnl");
  assert.equal(report.nextActions[1].code, "satisfy_top_canary_ev_floor");
});

test("runway keeps profit creation required when pre-minimum cost preview is present", () => {
  const report = buildPaybackDeliveryRunway({
    now: "2026-05-07T00:00:00.000Z",
    paybackStatus: {
      payback: {
        grossProfitSatsPeriod: 601,
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          minimumPaybackProgress: {
            grossTargetBeforeCostsSats: 120,
            minPaybackSats: 50_000,
            requiredGrossProfitSats: 250_000,
            satsToMinimumPayback: 49_880,
            progressToMinimumRatio: 0.0024,
          },
          preMinimumCompositePreview: {
            status: "preview",
            reason: "cost_only_pre_minimum",
            executionEligible: false,
            intentEligible: false,
            estimatedOfframpCostSats: 4_750,
            estimatedNetPaybackSats: 0,
            satsToMinimumAfterCosts: 54_630,
          },
        },
      },
    },
  });

  assert.equal(report.status, "profit_creation_required");
  assert.equal(report.current.preMinimumCompositePreviewStatus, "preview");
  assert.equal(report.current.preMinimumEstimatedOfframpCostSats, 4_750);
  assert.equal(report.current.preMinimumIntentEligible, false);
  assert.equal(report.nextActions[0].code, "create_payback_eligible_realized_pnl");
});

test("runway marks payback delivery ready when composite preview is ready", () => {
  const report = buildPaybackDeliveryRunway({
    paybackStatus: {
      payback: {
        grossProfitSatsPeriod: 300_000,
        scheduler: { status: "plan", reason: "planning_required" },
      },
      compositePreview: {
        status: "ready",
        reason: "emit_intents",
        stepCount: 2,
        plannedPaybackSats: 55_000,
        estimatedOfframpCostSats: 4_000,
      },
    },
  });

  assert.equal(report.status, "payback_delivery_ready");
  assert.equal(report.current.plannedPaybackSats, 55_000);
  assert.equal(report.current.estimatedOfframpCostSats, 4_000);
  assert.equal(report.nextActions[0].code, "run_payback_scheduler_execute");
  assert.equal(report.nextActions[0].safety, "policy_signer_kill_switch_required");
});

test("runway reports missing destination config as configuration blocker", () => {
  const report = buildPaybackDeliveryRunway({
    paybackStatus: {
      policy: {
        bitcoinDestAddressEnv: "PAYBACK_BTC_DEST_ADDR",
      },
      payback: {
        scheduler: {
          status: "blocked",
          reason: "missing_destination_config",
        },
      },
    },
  });

  assert.equal(report.status, "payback_blocked");
  assert.deepEqual(report.nextActions[0], {
    code: "set_payback_btc_destination_env",
    env: "PAYBACK_BTC_DEST_ADDR",
    safety: "configuration_required_before_planning",
  });
});

test("runway can fall back to all-chain Merkl canary diagnostics", () => {
  const report = buildPaybackDeliveryRunway({
    paybackStatus: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    allChainReport: {
      summary: {
        merklCanary: {
          status: "blocked",
          blockedReason: "same_chain_unprofitable:need_$9_on_sei",
          topEvGate: {
            status: "blocked",
            blocker: "same_chain_unprofitable:need_$9_on_sei",
            currentAmountUsd: "3.31",
            neededUsd: "8.95",
            limitingFactor: "inventory",
          },
        },
      },
    },
  });

  assert.equal(report.profitCreation.merklCanaryTopEvGate.currentAmountUsd, 3.31);
  assert.equal(report.blockers.some((item) => item.code === "same_chain_unprofitable:need_$9_on_sei"), true);
});

test("runway surfaces all-chain dry-run-first refill blockers before live execution", () => {
  const report = buildPaybackDeliveryRunway({
    paybackStatus: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    allChainReport: {
      status: "completed_with_blockers",
      summary: {
        executionGate: {
          blockedReason: "preview_only",
          killSwitchActive: false,
          autoKillTriggered: false,
        },
        capitalManager: {
          capitalPlanDecision: "REFILL_REQUIRED",
          refillJobCount: 31,
          autoRefillJobCount: 0,
        },
        merklCanary: {
          status: "blocked",
          blockedReason: "same_chain_unprofitable:need_$10_on_optimism",
          topEvGate: {
            status: "blocked",
            blocker: "same_chain_unprofitable:need_$10_on_optimism",
            currentAmountUsd: 2.85,
            neededUsd: 9.96,
            limitingFactor: "inventory",
          },
        },
      },
      refillExecutions: [
        { previewStatus: "blocked", previewBlockedReason: "max_consecutive_failures_reached" },
        { previewStatus: "blocked", previewBlockedReason: "max_consecutive_failures_reached" },
      ],
    },
  });

  assert.equal(report.profitCreation.allChainDryRunFirstLikelyAllowed, false);
  assert.equal(report.profitCreation.refillPreviewBlockerCounts.max_consecutive_failures_reached, 2);
  assert.equal(
    report.blockers.some((item) => item.source === "all_chain_dry_run_first" && item.code === "refill_preview_blocked:max_consecutive_failures_reached"),
    true,
  );
  assert.equal(report.nextActions[1].code, "review_refill_failure_lock_before_live_execute");
});
