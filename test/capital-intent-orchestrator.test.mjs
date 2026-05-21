import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCapitalIntentOrchestratorReport } from "../src/strategy/capital-intent-orchestrator.mjs";

const NOW = "2026-05-21T03:10:00.000Z";

function candidate(overrides = {}) {
  return {
    family: "synthetic_family",
    lane: "capital_refill",
    status: "READY_FOR_INTENT_CANDIDATE",
    sourceActionItem: {
      sourceTruthStatus: "dry_run_plannable",
    },
    selectedMethod: "synthetic_method",
    sourceChain: "synthetic_source_chain",
    sourceAsset: "SYN_SRC",
    destinationChain: "synthetic_dest_chain",
    destinationAsset: "SYN_DST",
    expectedNetUsd: 1.25,
    requiredNetUsd: 0.95,
    p90CostUsd: 0.75,
    effectiveFloorUsd: 0.95,
    amountSweep: {
      quotedAmountSats: "32000",
      routeMinimumAmountSats: "25000",
      safeAllocatableAmountSats: "64000",
      missingSats: null,
    },
    policyCapRef: {
      producer: "src/config/strategy-caps/registry.mjs",
      bindingProducer: "src/config/capital-refill-strategy-bindings.mjs",
      resolvedStrategyId: "synthetic_strategy",
      perTxUsd: 50,
      perDayUsd: 100,
      maxDailyLossUsd: 25,
    },
    routeQuoteRef: {
      producer: "synthetic_quote_producer",
      routeKey: "synthetic_route_key",
      amount: "32000",
      quoteAmountFloor: { minimum: "25000", actual: "32000" },
      observedAt: NOW,
    },
    paybackReserveRef: {
      producer: "src/treasury/refill-job.mjs",
      amountSats: "1000",
    },
    gasReserveRef: {
      producer: "src/treasury/refill-job.mjs",
      amountSats: "2000",
    },
    costFloor: {
      expectedNetUsd: 1.25,
      requiredNetUsd: 0.95,
      p90CostUsd: 0.75,
      effectiveFloorUsd: 0.95,
      routeKnownCostUsd: 0.1,
    },
    routeSourceRanking: [
      {
        method: "synthetic_method",
        selected: true,
        quotedAmountSats: "32000",
        minRouteAmountSats: "25000",
        safeAllocatableAmountSats: "64000",
        quoteProvenance: "fresh_selected_route_quote",
        expectedNetUsd: 1.25,
        requiredNetUsd: 0.95,
        p90CostUsd: 0.75,
        effectiveFloorUsd: 0.95,
        blocker: null,
      },
    ],
    economicReview: {
      status: "READY_FOR_INTENT_CANDIDATE",
      canIntent: true,
      blocker: null,
      missingProvenance: [],
    },
    canIntent: true,
    canLive: false,
    reportOnly: true,
    runtimeAuthority: "none",
    safetyBlockers: [],
    ...overrides,
  };
}

test("normal_trade requires positive EV above full cost floor and keeps report-only authority", () => {
  const report = buildCapitalIntentOrchestratorReport({
    generatedAt: NOW,
    laneIntentCandidates: [candidate()],
  });

  assert.equal(report.status, "CAPITAL_INTENT_ORCHESTRATOR_READY_REPORT_ONLY");
  assert.equal(report.reportOnly, true);
  assert.equal(report.canLive, false);
  assert.equal(report.runtimeAuthority, "none");
  assert.equal(report.rows.length, 1);

  const row = report.rows[0];
  assert.equal(row.policyMode, "normal_trade");
  assert.equal(row.policyVerdict, "report_only_intent_candidate");
  assert.equal(row.canIntent, true);
  assert.equal(row.canLive, false);
  assert.equal(row.reportOnly, true);
  assert.equal(row.runtimeAuthority, "none");
  assert.equal(row.routeMinimum.amount, "25000");
  assert.equal(row.quoteAmount.amount, "32000");
  assert.equal(row.safeAllocatable.amount, "64000");
  assert.equal(row.missingAmount.amount, "0");
  assert.equal(row.capSource.resolvedStrategyId, "synthetic_strategy");
  assert.equal(row.reserveImpact.paybackReserve.amount, "1000");
  assert.equal(row.reserveImpact.gasReserve.amount, "2000");
  assert.equal(row.quoteProvenance.source, "synthetic_quote_producer");
  assert.equal(row.costFloorProvenance.expectedNetUsd.amount, 1.25);
  assert.equal(row.costFloorProvenance.effectiveFloorUsd.amount, 0.95);
});

test("normal_trade blocks when EV is below the cost floor without weakening canLive", () => {
  const report = buildCapitalIntentOrchestratorReport({
    generatedAt: NOW,
    laneIntentCandidates: [
      candidate({
        expectedNetUsd: 0.4,
        economicReview: { status: "TRUE_ECONOMIC_NO_GO_NEGATIVE_EV", blocker: "expected_net_below_effective_floor" },
        canIntent: false,
      }),
    ],
  });

  const row = report.rows[0];
  assert.equal(row.policyMode, "normal_trade");
  assert.equal(row.policyVerdict, "blocked_expected_net_below_cost_floor");
  assert.equal(row.canIntent, false);
  assert.equal(row.canLive, false);
});

test("rebalance mode is allocation/usability intent and does not pretend to be profit", () => {
  const report = buildCapitalIntentOrchestratorReport({
    generatedAt: NOW,
    laneIntentCandidates: [
      candidate({
        policyMode: "rebalance",
        expectedNetUsd: -0.05,
        effectiveFloorUsd: 0.95,
        reallocationCandidate: { reportOnly: true, amountSats: "32000" },
        economicReview: { status: "READY_FOR_INTENT_CANDIDATE", blocker: null },
      }),
    ],
  });

  const row = report.rows[0];
  assert.equal(row.policyMode, "rebalance");
  assert.equal(row.policyVerdict, "report_only_rebalance_candidate");
  assert.equal(row.canIntent, true);
  assert.equal(row.canLive, false);
  assert.equal(row.costFloorProvenance.expectedNetUsd.amount, -0.05);
  assert.equal(row.costFloorProvenance.profitClaimed, false);
});

test("path_opening_canary requires committed budget and receipt/audit gates", () => {
  const blocked = buildCapitalIntentOrchestratorReport({
    generatedAt: NOW,
    laneIntentCandidates: [
      candidate({
        policyMode: "path_opening_canary",
        expectedNetUsd: -0.02,
        effectiveFloorUsd: 0.95,
        discoveryCanaryBudget: null,
      }),
    ],
  }).rows[0];
  assert.equal(blocked.policyVerdict, "blocked_canary_budget_missing");
  assert.equal(blocked.canIntent, false);

  const allowed = buildCapitalIntentOrchestratorReport({
    generatedAt: NOW,
    laneIntentCandidates: [
      candidate({
        policyMode: "path_opening_canary",
        expectedNetUsd: -0.02,
        effectiveFloorUsd: 0.95,
        discoveryCanaryBudget: { source: "src/config/sizing.mjs", amountUsd: 1, observedAt: NOW },
        receiptGate: { required: true, source: "src/executor/ingestor", observedAt: NOW },
        auditGate: { required: true, source: "logs/signer-audit.jsonl", observedAt: NOW },
        duplicateGuard: { status: "clear", source: "test" },
        cooldown: { status: "clear", source: "test" },
        killSwitch: { status: "clear", source: "test" },
      }),
    ],
  }).rows[0];
  assert.equal(allowed.policyVerdict, "report_only_path_opening_canary_candidate");
  assert.equal(allowed.canIntent, true);
  assert.equal(allowed.canLive, false);
});

test("quote-less routes and cap-below-route-minimum semantic candidates are classified separately", () => {
  const report = buildCapitalIntentOrchestratorReport({
    generatedAt: NOW,
    laneIntentCandidates: [
      candidate({
        routeQuoteRef: null,
        amountSweep: { quotedAmountSats: null, routeMinimumAmountSats: null, safeAllocatableAmountSats: "64000" },
      }),
      candidate({
        amountSweep: { quotedAmountSats: "32000", routeMinimumAmountSats: "25000", safeAllocatableAmountSats: "24000" },
        sourceAmountTotalSats: "100000",
        economicReview: {
          status: "INSUFFICIENT_SAFE_CAPITAL",
          blocker: "safe_allocatable_capital_below_fresh_quote_amount",
        },
        canIntent: false,
      }),
    ],
  });

  assert.equal(report.rows[0].policyVerdict, "blocked_quote_less_route");
  assert.equal(report.rows[1].policyVerdict, "POLICY_SEMANTIC_DEFECT_CANDIDATE");
  assert.equal(report.rows[1].canIntent, false);
});

test("hard safety blockers always block canary and canIntent never implies canLive", () => {
  const blockers = ["duplicate_open_intent", "cooldown_active", "kill_switch_present"];
  for (const blocker of blockers) {
    const row = buildCapitalIntentOrchestratorReport({
      generatedAt: NOW,
      laneIntentCandidates: [
        candidate({
          policyMode: "path_opening_canary",
          discoveryCanaryBudget: { source: "src/config/sizing.mjs", amountUsd: 1, observedAt: NOW },
          receiptGate: { required: true, source: "src/executor/ingestor", observedAt: NOW },
          auditGate: { required: true, source: "logs/signer-audit.jsonl", observedAt: NOW },
          safetyBlockers: [blocker],
        }),
      ],
    }).rows[0];
    assert.equal(row.policyVerdict, `blocked_${blocker}`);
    assert.equal(row.canIntent, false);
    assert.equal(row.canLive, false);
  }

  const source = readFileSync(new URL("../src/strategy/capital-intent-orchestrator.mjs", import.meta.url), "utf8");
  assert.equal(
    /sendSignerCommand|sign_and_broadcast|liveQueue|enqueue|autoExecute\\s*=|writeFileSync/.test(source),
    false,
  );
});
