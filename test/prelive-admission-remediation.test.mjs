import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdmissionRemediationPlan, summarizeAdmissionRemediationPlan } from "../src/prelive/admission-remediation.mjs";

test("admission remediation plan maps stale inputs and measured-leader review to commands", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["manual_review_stage_not_ready", "stale_src_gas", "stale_dex_quote"],
      },
      manualReviewCandidate: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        inputFreshness: {
          gatewayQuote: { state: "fresh" },
          exactGas: { state: "fresh" },
          srcGas: { state: "stale" },
          dexQuote: { state: "stale" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
      measuredLeaderReview: {
        routeKey: "ethereum:0x2260->base:0x0555",
        routeLabel: "ethereum->base WBTC->wBTC.OFT",
        amount: "10000",
        nextActionCode: "check_wallet_readiness",
        nextActionLabels: ["wallet readiness check"],
        command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000",
      },
      queueFollowUps: [
        {
          rank: 1,
          label: "base->avalanche wBTC.OFT->wBTC.OFT",
          reason: "scheduled_readiness_check",
          command: "npm run check:estimator-wallet -- --route-key=base:0x0555->avalanche:0x0555 --amount=100000",
        },
      ],
    },
    address: "0xabc",
  });

  assert.equal(plan.overallStatus, "ready");
  assert.equal(plan.nextAction.code, "refresh_src_gas");
  assert.equal(plan.items.some((item) => item.code === "refresh_dex_quote"), true);
  assert.equal(plan.items.some((item) => item.code === "check_wallet_readiness"), true);
  assert.equal(plan.items.some((item) => item.code === "scheduled_readiness_check"), true);
});

test("admission remediation plan prefers evidence-campaign execution over raw queue follow-ups", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["shadow_replay_not_ready", "mechanical_simulation_not_ready"],
      },
      manualReviewCandidate: {
        routeKey: "base:0x0555->unichain:0x0555",
        routeLabel: "base->unichain wBTC.OFT->wBTC.OFT",
        amount: "25000",
        inputFreshness: {},
      },
      queueFollowUps: [
        {
          rank: 1,
          label: "queue-follow-up",
          reason: "scheduled_readiness_check",
          command: "npm run check:estimator-wallet -- --route-key=base:0x0555->unichain:0x0555 --amount=25000",
        },
      ],
    },
    evidenceCampaign: {
      actions: [
        {
          code: "execute_refresh_batch",
          label: "execute refresh batch",
          status: "ready",
          reason: "queue_follow_up_available",
          command: "npm run run:shadow-refresh-batch -- --execute --limit=1",
        },
        {
          code: "collect_simulation_evidence",
          label: "collect simulation evidence",
          status: "blocked",
          reason: "shadow_replay_not_ready",
          command: "npm run run:prelive-simulations -- --source=objective --limit=4 --target-success-count=50 --write",
          blockers: ["shadow_replay_not_ready"],
        },
      ],
    },
  });

  const summary = summarizeAdmissionRemediationPlan(plan);

  assert.equal(plan.nextAction.code, "execute_refresh_batch");
  assert.equal(plan.items.some((item) => item.command.includes("run:shadow-refresh-batch")), true);
  assert.equal(plan.items.some((item) => item.reason === "scheduled_readiness_check"), false);
  assert.equal(summary.nextAction.code, "execute_refresh_batch");
  assert.equal(summary.items[0].command.includes("run:shadow-refresh-batch"), true);
});

test("admission remediation plan preserves blocked DEX input as a hold action", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["blocked_dex_quote"],
      },
      manualReviewCandidate: {
        routeKey: "avalanche:0x0555->bera:0x0555",
        routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
        amount: "10000",
        inputFreshness: {
          gatewayQuote: { state: "fresh" },
          exactGas: { state: "fresh" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "blocked" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
    },
  });

  assert.equal(plan.overallStatus, "blocked");
  assert.equal(plan.nextAction.code, "hold_dexQuote");
  assert.equal(plan.nextAction.command, null);
  assert.equal(plan.items.some((item) => item.reason === "blocked_dex_quote"), true);
});
