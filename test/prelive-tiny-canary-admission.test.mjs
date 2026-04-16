import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTinyCanaryAdmission } from "../src/prelive/tiny-canary-admission.mjs";

test("tiny canary admission returns go-for-manual-approval when all gates clear", () => {
  const admission = buildTinyCanaryAdmission({
    prelive: {
      tinyLiveCanary: {
        ready: true,
        blockers: [],
      },
    },
    executionStage: {
      reviewStage: "READY_FOR_MANUAL_CANARY_REVIEW",
      reviewReasons: [],
    },
    manualReviewCandidate: {
      routeKey: "base:0x0555->unichain:0x0555",
      routeLabel: "base->unichain wBTC.OFT->wBTC.OFT",
      amount: "25000",
      tradeReadiness: "shadow_candidate_review_only",
      inputFreshness: {
        gatewayQuote: { state: "fresh" },
        exactGas: { state: "fresh" },
        srcGas: { state: "fresh" },
        dexQuote: { state: "fresh" },
        bitcoinFee: { state: "not_needed" },
        marketSnapshot: { state: "fresh" },
      },
    },
    overall: {
      liveTrading: "BLOCKED",
      capitalRule: "Only a ring-fenced wallet capped near USD 300 may be used in a future canary.",
      riskBudgetUsd: 300,
    },
    now: "2026-04-12T12:20:00.000Z",
  });

  assert.equal(admission.decision, "GO_FOR_MANUAL_APPROVAL");
  assert.equal(admission.status, "manual_approval_required");
  assert.deepEqual(admission.blockers, []);
  assert.equal(admission.nextActionCode, "manual_approval_required");
  assert.equal(admission.constraints.dailyLossCapUsd, null);
});

test("tiny canary admission blocks on stale inputs and readiness blockers", () => {
  const admission = buildTinyCanaryAdmission({
    prelive: {
      tinyLiveCanary: {
        ready: false,
        blockers: ["fork_execution_not_ready"],
      },
    },
    executionStage: {
      reviewStage: "NOT_READY_FOR_MANUAL_CANARY_REVIEW",
      reviewReasons: ["reject_no_net_edge"],
    },
    manualReviewCandidate: {
      routeKey: "bob:0x0555->base:0x0555",
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      amount: "10000",
      tradeReadiness: "reject_no_net_edge",
      inputFreshness: {
        gatewayQuote: { state: "stale" },
        exactGas: { state: "missing" },
        srcGas: { state: "fresh" },
        dexQuote: { state: "stale" },
        bitcoinFee: { state: "not_needed" },
        marketSnapshot: { state: "fresh" },
      },
    },
    overall: {
      liveTrading: "BLOCKED",
    },
    now: "2026-04-12T12:20:00.000Z",
  });

  assert.equal(admission.decision, "NO_GO");
  assert.equal(admission.status, "blocked");
  assert.equal(admission.blockers.includes("fork_execution_not_ready"), true);
  assert.equal(admission.blockers.includes("stale_gateway_quote"), true);
  assert.equal(admission.blockers.includes("missing_exact_gas"), true);
  assert.equal(admission.blockers.includes("stale_dex_quote"), true);
});

test("tiny canary admission treats blocked DEX coverage as a blocker", () => {
  const admission = buildTinyCanaryAdmission({
    prelive: {
      tinyLiveCanary: {
        ready: false,
        blockers: [],
      },
    },
    executionStage: {
      reviewStage: "READY_FOR_MANUAL_CANARY_REVIEW",
      reviewReasons: [],
    },
    manualReviewCandidate: {
      routeKey: "avalanche:0x0555->bera:0x0555",
      routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
      amount: "10000",
      tradeReadiness: "shadow_candidate_review_only",
      inputFreshness: {
        gatewayQuote: { state: "fresh" },
        exactGas: { state: "fresh" },
        srcGas: { state: "fresh" },
        dexQuote: { state: "blocked" },
        bitcoinFee: { state: "not_needed" },
        marketSnapshot: { state: "fresh" },
      },
    },
    overall: {
      liveTrading: "BLOCKED",
    },
  });

  assert.equal(admission.decision, "NO_GO");
  assert.equal(admission.blockers.includes("blocked_dex_quote"), true);
});

test("tiny canary admission supports strategy-level candidates", () => {
  const blocked = buildTinyCanaryAdmission({
    prelive: {
      tinyLiveCanary: {
        ready: false,
        blockers: ["shadow_replay_not_ready"],
      },
    },
    executionStage: {
      reviewStage: "NOT_READY_FOR_MANUAL_CANARY_REVIEW",
      reviewReasons: ["reject_no_net_edge"],
    },
    manualReviewCandidate: {
      candidateType: "strategy",
      candidateId: "wrapped-btc-loop-base-moonwell",
      candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
      amount: "300",
      amountUnit: "usd_cap",
      perTradeCapUsd: 300,
      tradeReadiness: "strategy_evidence_blocked",
      evidenceBlockers: ["signer_backed_oos_receipts_missing"],
      reviewReady: false,
      preliveReady: false,
      nextAction: {
        code: "collect_wrapped_btc_loop_oos_receipts",
        command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
      },
    },
    overall: {
      liveTrading: "BLOCKED",
    },
  });

  assert.equal(blocked.decision, "NO_GO");
  assert.equal(blocked.blockers.includes("signer_backed_oos_receipts_missing"), true);
  assert.equal(blocked.nextActionCode, "collect_wrapped_btc_loop_oos_receipts");

  const ready = buildTinyCanaryAdmission({
    prelive: {
      tinyLiveCanary: {
        ready: false,
        blockers: [],
      },
    },
    executionStage: {
      reviewStage: "NOT_READY_FOR_MANUAL_CANARY_REVIEW",
      reviewReasons: [],
    },
    manualReviewCandidate: {
      candidateType: "strategy",
      candidateId: "wrapped-btc-loop-base-moonwell",
      candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
      amount: "300",
      amountUnit: "usd_cap",
      perTradeCapUsd: 300,
      tradeReadiness: "strategy_candidate_review_only",
      evidenceBlockers: [],
      reviewReady: true,
      preliveReady: true,
    },
    overall: {
      liveTrading: "BLOCKED",
    },
  });

  assert.equal(ready.decision, "GO_FOR_MANUAL_APPROVAL");
  assert.equal(ready.candidate.candidateType, "strategy");
});
