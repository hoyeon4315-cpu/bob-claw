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
  assert.equal(plan.items.some((item) => item.reason === "blocked_dex_quote:no_supported_router_for_chain:60808"), true);
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
          command: "npm run run:shadow-refresh-batch -- --execute --continue-on-failure --limit=4",
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
  assert.equal(plan.items.some((item) => item.reason.startsWith("blocked_dex_quote")), true);
});

test("admission remediation plan infers unsupported bob dex routes as blocked instead of refreshable", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["missing_dex_quote"],
      },
      manualReviewCandidate: {
        routeKey: "sonic:0x0555->bob:0x0555",
        routeLabel: "sonic->bob wBTC.OFT->wBTC.OFT",
        amount: "50000",
        inputFreshness: {
          gatewayQuote: { state: "fresh" },
          exactGas: { state: "fresh" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "missing" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
    },
  });

  assert.equal(plan.overallStatus, "blocked");
  assert.equal(plan.nextAction.code, "hold_dexQuote");
  assert.equal(plan.items.some((item) => item.reason === "blocked_dex_quote:no_supported_router_for_chain:60808"), true);
  assert.equal(plan.items.some((item) => item.code === "refresh_dex_quote"), false);
});

test("admission remediation plan prioritizes strategy-candidate receipts over blocked exact-route refreshes", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      readyForManualReview: false,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        amount: "300",
        blockerReasons: ["signer_backed_oos_receipts_missing"],
        evidenceBlockers: ["signer_backed_oos_receipts_missing"],
        nextAction: {
          code: "collect_wrapped_btc_loop_oos_receipts",
          command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
        },
      },
      tinyCanaryAdmission: {
        blockers: ["signer_backed_oos_receipts_missing", "stale_gateway_quote"],
      },
      manualReviewCandidate: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        inputFreshness: {
          gatewayQuote: { state: "stale" },
          exactGas: { state: "stale" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "fresh" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
    },
  });

  assert.equal(plan.nextAction.code, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(plan.nextAction.command, "npm run ingest:wrapped-btc-loop-receipt -- --write");
  assert.equal(plan.items[0].code, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(plan.items.some((item) => item.code === "refresh_gateway_quote"), true);
  assert.equal(plan.items.some((item) => item.code === "refresh_exact_gas"), true);
});

test("admission remediation plan skips review-ready strategy candidates with no remaining evidence blockers", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      readyForManualReview: false,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        amount: "300",
        reviewReady: true,
        blockerReasons: [],
        evidenceBlockers: [],
        nextAction: {
          code: "capture_wrapped_btc_loop_extended_receipt_context",
          command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
        },
      },
      tinyCanaryAdmission: {
        blockers: ["live_policy_state_changed"],
      },
      manualReviewCandidate: {
        routeKey: "avalanche:0x0555->soneium:0x0555",
        routeLabel: "avalanche->soneium wBTC.OFT->wBTC.OFT",
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

  assert.equal(plan.nextAction.code, "hold_dexQuote");
  assert.equal(plan.items.some((item) => item.code === "capture_wrapped_btc_loop_extended_receipt_context"), false);
});

test("admission remediation plan suppresses route refresh work when strategy review is already ready", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      readyForManualReview: true,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        amount: "300",
      },
      manualReviewCandidate: {
        routeKey: "base:0x0555->bsc:0x0555",
        routeLabel: "base->bsc wBTC.OFT->wBTC.OFT",
        amount: "25000",
        inputFreshness: {
          gatewayQuote: { state: "stale" },
          exactGas: { state: "stale" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "fresh" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
      queueFollowUps: [
        {
          rank: 1,
          scope: "active_canary",
          reason: "token",
          command:
            'npm run check:estimator-wallet -- --route-key="base:0x0555->bsc:0x0555" --amount="25000"',
        },
      ],
      tinyCanaryAdmission: {
        blockers: [],
      },
    },
    evidenceCampaign: {
      actions: [
        {
          code: "submit_fork_cycle",
          label: "submit fork cycle",
          status: "manual",
          reason: "external_signer_required",
          command: 'npm run submit:prelive-fork-execution -- --plan-id="plan-1" --use-signer-daemon --rpc-url="<forkRpcUrl>"',
        },
      ],
    },
  });

  assert.equal(plan.overallStatus, "awaiting_manual");
  assert.equal(plan.nextAction.code, "submit_fork_cycle");
  assert.equal(plan.items.some((item) => item.code === "refresh_gateway_quote"), false);
  assert.equal(plan.items.some((item) => item.code === "refresh_exact_gas"), false);
  assert.equal(plan.items.some((item) => item.reason === "token"), false);
});

test("admission remediation plan prioritizes active canary wallet readiness over stale input refresh", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["stale_gateway_quote", "stale_market"],
      },
      manualReviewCandidate: {
        routeKey: "bob:0x0555->bera:0x0555",
        routeLabel: "bob->bera wBTC.OFT->wBTC.OFT",
        amount: "10000",
        blockerReasons: ["token"],
        inputFreshness: {
          gatewayQuote: { state: "stale" },
          exactGas: { state: "fresh" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "blocked" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "stale" },
        },
      },
      queueFollowUps: [
        {
          rank: 1,
          scope: "active_canary",
          label: "bob->bera wBTC.OFT->wBTC.OFT",
          reason: "token",
          command: "npm run check:estimator-wallet -- --route-key=bob:0x0555->bera:0x0555 --amount=10000",
        },
      ],
    },
  });

  assert.equal(plan.nextAction.code, "token");
  assert.equal(plan.nextAction.command, "npm run check:estimator-wallet -- --route-key=bob:0x0555->bera:0x0555 --amount=10000");
  assert.equal(plan.items[0].reason, "token");
  assert.equal(plan.items.some((item) => item.code === "refresh_gateway_quote"), false);
});

test("admission remediation plan skips stale gateway and missing exact gas when wallet blocker is already known", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["token", "missing_exact_gas"],
      },
      manualReviewCandidate: {
        routeKey: "bob:0x0555->unichain:0x0555",
        routeLabel: "bob->unichain wBTC.OFT->wBTC.OFT",
        amount: "10000",
        blockerReasons: ["token"],
        inputFreshness: {
          gatewayQuote: { state: "stale" },
          exactGas: { state: "missing" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "blocked" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
      queueFollowUps: [
        {
          rank: 1,
          scope: "active_canary",
          label: "bob->unichain wBTC.OFT->wBTC.OFT",
          reason: "token",
          command: "npm run check:estimator-wallet -- --route-key=bob:0x0555->unichain:0x0555 --amount=10000",
        },
      ],
    },
  });

  assert.equal(plan.nextAction.code, "token");
  assert.equal(plan.items.some((item) => item.code === "refresh_gateway_quote"), false);
  assert.equal(plan.items.some((item) => item.code === "refresh_exact_gas"), false);
});

test("admission remediation plan skips dex refresh when wallet blocker is already known", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["native", "stale_dex_quote"],
      },
      manualReviewCandidate: {
        routeKey: "base:0x0555->bsc:0x0555",
        routeLabel: "base->bsc wBTC.OFT->wBTC.OFT",
        amount: "10000",
        blockerReasons: ["native"],
        inputFreshness: {
          gatewayQuote: { state: "fresh" },
          exactGas: { state: "fresh" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "stale" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
      queueFollowUps: [
        {
          rank: 1,
          scope: "active_canary",
          label: "base->bsc wBTC.OFT->wBTC.OFT",
          reason: "native",
          command: "npm run check:estimator-wallet -- --route-key=base:0x0555->bsc:0x0555 --amount=10000",
        },
      ],
    },
  });

  assert.equal(plan.nextAction.code, "native");
  assert.equal(plan.items.some((item) => item.code === "refresh_dex_quote"), false);
});

test("admission remediation plan keeps high-priority active canary readiness even when refresh-batch runner exists", () => {
  const plan = buildAdmissionRemediationPlan({
    reviewPackage: {
      tinyCanaryAdmission: {
        blockers: ["stale_gateway_quote"],
      },
      manualReviewCandidate: {
        routeKey: "bob:0x0555->bera:0x0555",
        routeLabel: "bob->bera wBTC.OFT->wBTC.OFT",
        amount: "10000",
        inputFreshness: {
          gatewayQuote: { state: "stale" },
          exactGas: { state: "fresh" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "blocked" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
      queueFollowUps: [
        {
          rank: 1,
          scope: "active_canary",
          label: "bob->bera wBTC.OFT->wBTC.OFT",
          reason: "token",
          command: "npm run check:estimator-wallet -- --route-key=bob:0x0555->bera:0x0555 --amount=10000",
        },
        {
          rank: 2,
          scope: "prep_candidate",
          label: "bob->bsc wBTC.OFT->wBTC.OFT",
          reason: "scheduled_readiness_check",
          command: "npm run check:estimator-wallet -- --route-key=bob:0x0555->bsc:0x0555 --amount=10000",
        },
      ],
    },
    evidenceCampaign: {
      actions: [
        {
          code: "execute_refresh_batch",
          label: "execute refresh batch",
          status: "ready",
          reason: "token",
          command: "npm run run:shadow-refresh-batch -- --execute --continue-on-failure --limit=4",
        },
      ],
    },
  });

  assert.equal(plan.nextAction.code, "token");
  assert.equal(plan.items[0].command, "npm run check:estimator-wallet -- --route-key=bob:0x0555->bera:0x0555 --amount=10000");
  assert.equal(plan.items.some((item) => item.command === "npm run check:estimator-wallet -- --route-key=bob:0x0555->bsc:0x0555 --amount=10000"), false);
  assert.equal(plan.items.some((item) => item.code === "execute_refresh_batch"), true);
});
