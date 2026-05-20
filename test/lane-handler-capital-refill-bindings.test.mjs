import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPITAL_REFILL_METHOD_STRATEGY_BINDINGS,
  CAPITAL_REFILL_BINDING_PRODUCER,
  resolveCapitalRefillStrategyId,
} from "../src/config/capital-refill-strategy-bindings.mjs";
import { executionEvCostFloorEvidence } from "../src/executor/policy/ev-cost-floor.mjs";
import { buildLaneHandlerReport } from "../src/strategy/lane-handler-framework.mjs";
import { buildLaneIntentCandidateReport } from "../src/strategy/remediation-lane-intent-candidate.mjs";

function queueItem(family, overrides = {}) {
  return {
    lane: "capital_refill",
    family,
    priority: 10,
    actionClass: "CAPITAL_REFILL",
    reason: "capital_refill_reason",
    governingFieldPath: `familyCoverage[family=${family}].firstBlockingReason`,
    canDryRun: true,
    suggestedDryRunCommand: "node src/cli/plan-capital-manager-refill-jobs.mjs --json",
    canLive: false,
    missingProducer: null,
    safetyBlockers: [],
    ...overrides,
  };
}

function refillJob(family, overrides = {}) {
  return {
    jobId: `${family}-job`,
    family,
    status: "planned",
    decision: "REFILL_REQUIRED",
    type: "refill_token",
    executionMethod: "cross_chain_bridge_or_swap",
    chain: "base",
    asset: "wBTC.OFT",
    token: "0xdest",
    targetAmount: "118732",
    targetAmountDecimal: 0.00118732,
    estimatedAssetValueUsd: 91.12,
    fundingSource: {
      selectionStatus: "ready",
      method: "cross_chain_bridge_or_swap",
      source: {
        chain: "bitcoin",
        token: "0x0000000000000000000000000000000000000000",
        ticker: "BTC",
        estimatedUsd: 91.12,
      },
      expectedExecutionRefillCostUsd: 0.88,
      expectedReserveReplenishmentCostUsd: 0,
      missingInputs: [],
    },
    movementBudget: { bridgeQuoteCostUsd: 0.88, bridgeQuoteCostCeilingUsd: 1.5, bridgeQuoteCostAccepted: true },
    systemEconomics: { effectiveSystemNetPnlUsd: 0.91, routeExecutableNetEdgeUsd: 1.79, routeKnownCostUsd: 0.38 },
    ...overrides,
  };
}

test("CAPITAL_REFILL_METHOD_STRATEGY_BINDINGS exposes every refill method as a committed strategy-id key", () => {
  for (const value of Object.values(CAPITAL_REFILL_METHOD_STRATEGY_BINDINGS)) {
    assert.equal(typeof value, "string");
    assert.ok(value.length > 0);
  }
  assert.equal(CAPITAL_REFILL_BINDING_PRODUCER.module, "src/config/capital-refill-strategy-bindings.mjs");
});

test("resolveCapitalRefillStrategyId returns bitcoin-source onramp when method is the Gateway shared name", () => {
  const onramp = resolveCapitalRefillStrategyId({
    selectedMethod: "cross_chain_bridge_or_swap",
    sourceChain: "bitcoin",
  });
  const fundingTransfer = resolveCapitalRefillStrategyId({
    selectedMethod: "cross_chain_bridge_or_swap",
    sourceChain: "ethereum",
  });
  assert.notEqual(onramp, null);
  assert.notEqual(fundingTransfer, null);
  assert.notEqual(onramp, fundingTransfer);
});

test("resolveCapitalRefillStrategyId returns null for unmapped/synthetic methods", () => {
  const unmapped = resolveCapitalRefillStrategyId({
    selectedMethod: "synthetic_unmapped_method",
    sourceChain: "synthetic_chain",
  });
  assert.equal(unmapped, null);
});

test("executionEvCostFloorEvidence requires strategyId + chain + intentType, never invents fields", () => {
  const missingInputs = executionEvCostFloorEvidence({});
  assert.equal(missingInputs, null);
  const fallback = executionEvCostFloorEvidence({
    strategyId: "synthetic-strategy-id",
    chain: "synthetic_chain",
    intentType: "capital_rebalance",
    isCapitalRebalance: true,
  });
  assert.ok(fallback, "expected non-null evidence");
  assert.equal(fallback.strategyId, "synthetic-strategy-id");
  assert.equal(fallback.chain, "synthetic_chain");
  assert.equal(fallback.intentType, "capital_rebalance");
  assert.ok(Number.isFinite(fallback.p90CostUsd));
  assert.ok(Number.isFinite(fallback.requiredNetUsd));
  assert.equal(fallback.effectiveFloorUsd, fallback.requiredNetUsd);
  assert.equal(fallback.costSource, "fallback_chain_p99");
  assert.equal(fallback.producer, "src/executor/policy/ev-cost-floor.mjs#executionEvCostFloorEvidence");
});

test("executionEvCostFloorEvidence uses history p90 when receiptModel sample count is sufficient", () => {
  const historyEntry = {
    key: "synthetic-strategy-id:synthetic_chain:capital_rebalance",
    sampleCount: 50,
    p90CostUsd: 0.123,
  };
  const withHistory = executionEvCostFloorEvidence({
    strategyId: "synthetic-strategy-id",
    chain: "Synthetic_Chain",
    intentType: "capital_rebalance",
    isCapitalRebalance: true,
    receiptModel: { entries: [historyEntry] },
  });
  assert.equal(withHistory.costSource, "history_p90");
  assert.equal(withHistory.p90CostUsd, 0.123);
  assert.ok(withHistory.requiredNetUsd >= 0.123);
});

test("lane handler forwards committed cap refs into dryRunIntent.policyCaps and policyCapRef", () => {
  const report = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [queueItem("capital_family")] },
    refillPlannerReport: {
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: { jobs: [refillJob("capital_family")] },
    },
  });
  const intent = report.handlerResults[0].dryRunIntent;
  assert.equal(intent.policyCaps.resolvedStrategyId, "gateway-btc-onramp");
  assert.equal(intent.policyCaps.capsSourceProducer, "src/config/strategy-caps/registry.mjs");
  assert.ok(Number.isFinite(intent.policyCaps.perTxUsd));
  assert.ok(Number.isFinite(intent.policyCaps.perDayUsd));
  assert.ok(Number.isFinite(intent.policyCaps.maxDailyLossUsd));
  assert.equal(intent.policyCapRef.resolvedStrategyId, "gateway-btc-onramp");
  assert.equal(intent.policyCapRef.bindingProducer, "src/config/capital-refill-strategy-bindings.mjs");
  assert.deepEqual(intent.capRefsMissingFields, []);
  assert.equal(intent.capRefsMissingProducer, null);
});

test("lane handler forwards real-producer cost-floor evidence into dryRunIntent", () => {
  const report = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [queueItem("capital_family")] },
    refillPlannerReport: {
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: { jobs: [refillJob("capital_family")] },
    },
  });
  const intent = report.handlerResults[0].dryRunIntent;
  assert.ok(intent.floorEvidence, "expected floor evidence");
  assert.ok(Number.isFinite(intent.floorEvidence.p90CostUsd));
  assert.ok(Number.isFinite(intent.floorEvidence.requiredNetUsd));
  assert.ok(Number.isFinite(intent.p90CostUsd));
  assert.ok(Number.isFinite(intent.requiredNetUsd));
  assert.ok(Number.isFinite(intent.effectiveFloorUsd));
  assert.equal(intent.floorMissingProducer, null);
  assert.deepEqual(intent.floorMissingFields, []);
});

test("lane handler emits typed missing producer when method has no committed strategy binding", () => {
  const job = refillJob("synthetic_family", {
    executionMethod: "synthetic_unmapped_method",
    fundingSource: {
      selectionStatus: "ready",
      method: "synthetic_unmapped_method",
      source: { chain: "syntheticSource", ticker: "SYN", token: "0x1" },
      expectedExecutionRefillCostUsd: 0.1,
      expectedReserveReplenishmentCostUsd: 0,
      missingInputs: [],
    },
    chain: "syntheticDest",
    asset: "SYN_DST",
    token: "0xdest",
    estimatedAssetValueUsd: 5,
  });
  const report = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [queueItem("synthetic_family")] },
    refillPlannerReport: { capitalPlan: { decision: "REFILL_REQUIRED" }, jobs: { jobs: [job] } },
  });
  const intent = report.handlerResults[0].dryRunIntent;
  assert.equal(intent.policyCaps.resolvedStrategyId, null);
  assert.equal(intent.policyCaps.perTxUsd, null);
  assert.equal(intent.policyCaps.perDayUsd, null);
  assert.equal(intent.policyCaps.maxDailyLossUsd, null);
  assert.ok(intent.capRefsMissingProducer, "missing producer descriptor required");
  assert.equal(intent.capRefsMissingProducer.producer, "src/config/capital-refill-strategy-bindings.mjs");
  assert.deepEqual(intent.capRefsMissingProducer.missingFields, [
    "resolvedStrategyId",
    "perTxUsd",
    "perDayUsd",
    "maxDailyLossUsd",
  ]);
  assert.ok(intent.capRefsMissingFields.includes("perTxUsd"));
  assert.ok(intent.capRefsMissingFields.includes("perDayUsd"));
  assert.ok(intent.capRefsMissingFields.includes("maxDailyLossUsd"));
  // floor evidence also missing because strategyId could not be resolved
  assert.equal(intent.floorEvidence, null);
  assert.ok(intent.floorMissingProducer, "expected floor missing producer descriptor");
  assert.equal(intent.floorMissingProducer.producer, "src/executor/policy/ev-cost-floor.mjs");
});

test("canIntent:true never implies canLive:true at the lane handler layer", () => {
  const report = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [queueItem("capital_family")] },
    refillPlannerReport: {
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: { jobs: [refillJob("capital_family")] },
    },
  });
  const result = report.handlerResults[0];
  assert.equal(result.canLive, false);
  assert.equal(result.reportOnly, true);
  assert.equal(report.canLive, false);
  assert.equal(report.runtimeAuthority, "none");
});

test("synthetic unrelated chain/asset/method tuples each resolve deterministic floor or typed missing", () => {
  const tuples = [
    {
      label: "alpha_lifi",
      method: "cross_chain_bridge_lifi",
      sourceChain: "alphaSrc",
      destChain: "alphaDst",
      expectedStrategyId: "lifi-bridge",
    },
    {
      label: "beta_across",
      method: "cross_chain_bridge_across",
      sourceChain: "betaSrc",
      destChain: "betaDst",
      expectedStrategyId: "across-bridge",
    },
    {
      label: "gamma_unmapped",
      method: "gamma_no_binding",
      sourceChain: "gammaSrc",
      destChain: "gammaDst",
      expectedStrategyId: null,
    },
  ];
  for (const tuple of tuples) {
    const job = refillJob(`${tuple.label}_family`, {
      executionMethod: tuple.method,
      fundingSource: {
        selectionStatus: "ready",
        method: tuple.method,
        source: { chain: tuple.sourceChain, ticker: `${tuple.label}_SRC`, token: "0x1" },
        expectedExecutionRefillCostUsd: 0.1,
        expectedReserveReplenishmentCostUsd: 0,
        missingInputs: [],
      },
      chain: tuple.destChain,
      asset: `${tuple.label}_DST`,
      token: "0xdest",
      estimatedAssetValueUsd: 5,
    });
    const report = buildLaneHandlerReport({
      selectorReport: { actionLaneQueue: [queueItem(`${tuple.label}_family`)] },
      refillPlannerReport: { capitalPlan: { decision: "REFILL_REQUIRED" }, jobs: { jobs: [job] } },
    });
    const intent = report.handlerResults[0].dryRunIntent;
    assert.equal(intent.policyCaps.resolvedStrategyId, tuple.expectedStrategyId, `${tuple.label} strategyId`);
    if (tuple.expectedStrategyId === null) {
      assert.notEqual(intent.capRefsMissingProducer, null, `${tuple.label} cap producer descriptor`);
      assert.equal(intent.floorEvidence, null, `${tuple.label} floor evidence`);
    } else {
      assert.equal(intent.capRefsMissingProducer, null, `${tuple.label} no cap producer descriptor`);
      assert.ok(intent.floorEvidence, `${tuple.label} floor evidence present`);
    }
  }
});

// End-to-end producer wiring proof: when the planner emits a ready job with a
// committed-binding execution method AND a synthetic readiness blocker on the
// same source/destination tuple carries `quoteAmountFloor: { minimum, actual }`
// AND source inventory + reserves clear the route minimum within cap refs +
// cost-floor, the lifecycle reaches `READY_FOR_INTENT_CANDIDATE` and
// `canIntent: true` while preserving `canLive: false`. This is the report-only
// achievability proof for the sizing layer.
test("producer-wired caps + cost-floor + safe inventory yields canIntent=true (report-only)", () => {
  // Use a synthetic chain so the cap registry resolves a chain-specific perTxUsd
  // only via the registry top-level perTxUsd (not perChainUsd).
  const syntheticItem = {
    lane: "capital_refill",
    family: "achievability_family",
    priority: 10,
    actionClass: "CAPITAL_REFILL",
    reason: "capital_refill_reason",
    governingFieldPath: "familyCoverage[family=achievability_family].firstBlockingReason",
    canDryRun: true,
    suggestedDryRunCommand: "node src/cli/plan-capital-manager-refill-jobs.mjs --json",
    canLive: false,
    missingProducer: null,
    safetyBlockers: [],
  };
  const syntheticJob = {
    jobId: "achievability-job",
    family: "achievability_family",
    decision: "REFILL_REQUIRED",
    type: "refill_token",
    // Bind through the committed `gas_refuel_bridge_gas_zip` →
    // `gas-zip-native-refuel` mapping so cap resolution works without invoking
    // chain-specific perChainUsd entries.
    executionMethod: "gas_refuel_bridge_gas_zip",
    chain: "achievabilityDest",
    asset: "ACHIEVE_DST",
    token: "0xdest",
    targetAmount: "5000000",
    targetAmountDecimal: 0.05,
    estimatedAssetValueUsd: 5,
    fundingSource: {
      selectionStatus: "ready",
      method: "gas_refuel_bridge_gas_zip",
      source: {
        chain: "achievabilitySource",
        ticker: "ACHIEVE_SRC",
        token: "0x1",
        actual: "5000000",
        actualDecimal: 0.05,
        estimatedUsd: 5,
        sourceKind: "token",
      },
      expectedExecutionRefillCostUsd: 0.05,
      expectedReserveReplenishmentCostUsd: 0,
      missingInputs: [],
    },
    movementBudget: { bridgeQuoteCostUsd: 0.05, bridgeQuoteCostCeilingUsd: 0.5, bridgeQuoteCostAccepted: true },
    systemEconomics: {
      // expectedNetUsd above the receipt-cost floor so the lifecycle's
      // `intentUsdFloorPresent` branch is satisfied without a stale-snapshot
      // collision.
      effectiveSystemNetPnlUsd: 50,
      routeExecutableNetEdgeUsd: 50,
      routeKnownCostUsd: 0.05,
    },
    paybackReserve: { reserveSats: "100" },
    gasReserve: { reserveSats: "100" },
  };
  const laneHandlerReport = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [syntheticItem] },
    refillPlannerReport: { capitalPlan: { decision: "REFILL_REQUIRED" }, jobs: { jobs: [syntheticJob] } },
  });
  const intent = laneHandlerReport.handlerResults[0].dryRunIntent;
  // Producer wiring sanity
  assert.equal(intent.policyCaps.resolvedStrategyId, "gas-zip-native-refuel");
  assert.ok(Number.isFinite(intent.policyCaps.perTxUsd), "perTxUsd must be finite from committed registry");
  assert.ok(Number.isFinite(intent.policyCaps.perDayUsd));
  assert.ok(Number.isFinite(intent.policyCaps.maxDailyLossUsd));
  assert.ok(Number.isFinite(intent.requiredNetUsd), "requiredNetUsd must be finite from cost-floor producer");
  assert.ok(Number.isFinite(intent.p90CostUsd));
  assert.ok(Number.isFinite(intent.effectiveFloorUsd));

  // Synthetic readiness blocker carries the route-minimum amount-floor evidence
  // on the same source/destination tuple. The planner is governing-aligned
  // (blocker=null, selectionStatus=ready), but the route-min evidence triggers
  // the WAITLIST_BELOW_ROUTE_MINIMUM path → sized to route minimum.
  const readinessReport = {
    liveAutomation: {
      refillBlockers: [
        {
          chain: "achievabilityDest",
          asset: "ACHIEVE_DST",
          sourceChain: "achievabilitySource",
          sourceAsset: "ACHIEVE_SRC",
          selectedMethod: "gas_refuel_bridge_gas_zip",
          reason: "quote_amount_too_low",
          category: "quote_amount_below_minimum",
          routeDeferralReason: "bridge_quote_amount_below_minimum",
          quoteAmountFloor: { minimum: "10000", actual: "5000" },
          // Real-producer cost-floor fields populated on the blocker too, so
          // the lifecycle's `belowRouteMinimum` quote-cost path sees no missing
          // USD producer fields. (Lifecycle prefers blocker fields when
          // present.)
          gatewaySuccessProbe: {
            amount: "10000",
            outputAmount: "5000",
            fees: "10",
            executionFees: "9",
            feeRatio: 0.1,
            observedAt: "2026-05-20T09:00:00.000Z",
          },
          expectedNetUsd: 50,
          requiredNetUsd: 0.5,
          p90CostUsd: 0.4,
          effectiveFloorUsd: 0.5,
          stalePlannerMethod: false,
        },
      ],
    },
  };
  const lifecycle = buildLaneIntentCandidateReport({
    laneHandlerReport,
    readinessReport,
    now: "2026-05-20T09:30:00.000Z",
  });
  const candidate = lifecycle.laneIntentCandidates[0];
  assert.equal(candidate.status, "READY_FOR_INTENT_CANDIDATE");
  assert.equal(candidate.canIntent, true);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(candidate.allowedToExecuteLive, false);
  assert.equal(candidate.liveExecutionAuthority, "none");
  // proposedSizedAmountSats >= minRouteAmountSats
  assert.equal(candidate.minRouteAmountSats, "10000");
  assert.equal(candidate.proposedSizedAmountSats, "10000");
  assert.ok(BigInt(candidate.proposedSizedAmountSats) >= BigInt(candidate.minRouteAmountSats));
  assert.equal(candidate.sizingDecision, "REPORT_ONLY_SIZED_TO_ROUTE_MINIMUM");
  assert.equal(candidate.sizingBlocker, null);
  // No safety surface flipped to live
  assert.equal(lifecycle.laneSafetyProof.canLive, false);
  assert.equal(lifecycle.laneSafetyProof.runtimeAuthority, "none");
  assert.equal(lifecycle.laneSafetyProof.signerCalled, false);
  assert.equal(lifecycle.laneSafetyProof.runtimeStateMutated, false);
  assert.equal(lifecycle.laneSafetyProof.liveQueueEnqueued, false);
  assert.equal(lifecycle.laneSafetyProof.autoExecuteChanged, false);
  assert.equal(lifecycle.laneSafetyProof.policyRelaxed, false);
  assert.equal(lifecycle.laneSafetyProof.evCostRelaxed, false);
  assert.equal(lifecycle.laneSafetyProof.capRelaxed, false);
  assert.equal(lifecycle.laneSafetyProof.cooldownRelaxed, false);
  assert.equal(lifecycle.laneSafetyProof.killSwitchBypassed, false);
});

test("source code carries no sample-specific production branch keyed on the current PR's chain/asset", () => {
  return import("node:fs/promises").then(async (fs) => {
    const handlerSrc = await fs.readFile(
      new URL("../src/strategy/lane-handler-framework.mjs", import.meta.url),
      "utf8",
    );
    const bindingSrc = await fs.readFile(
      new URL("../src/config/capital-refill-strategy-bindings.mjs", import.meta.url),
      "utf8",
    );
    const floorSrc = await fs.readFile(new URL("../src/executor/policy/ev-cost-floor.mjs", import.meta.url), "utf8");
    const lifecycleSrc = await fs.readFile(
      new URL("../src/strategy/remediation-lane-intent-candidate.mjs", import.meta.url),
      "utf8",
    );
    // No production branch should switch on current evidence values. Strip
    // line comments first so explanatory BTC/Gateway prose does not count as a
    // runtime branch.
    for (const src of [handlerSrc, bindingSrc, floorSrc, lifecycleSrc].map((text) =>
      text
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n"),
    )) {
      assert.doesNotMatch(src, /\bwBTC\.OFT\b/);
      assert.doesNotMatch(src, /\b[Bb]ase\b/);
      assert.doesNotMatch(src, /\bBTC\b/);
      assert.doesNotMatch(src, /\b(10000|25000|100000|32288)\b/);
    }
  });
});
