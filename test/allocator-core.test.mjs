import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllocatorCore, summarizeAllocatorCore } from "../src/strategy/allocator-core.mjs";

test("allocator core applies deterministic cap defaults and keeps blocked strategies review-only", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "wrapped_btc_loop_validation",
          overallStatus: "blocked",
          blockers: ["oos_receipt_window_below_policy"],
          nextAction: { code: "collect_wrapped_btc_loop_oos_receipts" },
        },
        {
          id: "stablecoin_spread_loop_validation",
          overallStatus: "blocked",
          blockers: ["overfit_gate_blocked", "search_complexity_budget_not_recorded"],
        },
      ],
    },
    wrappedBtcLendingLoopSlice: {
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        label: "Wrapped BTC lending loop (Base / Moonwell)",
        chain: "base",
        protocol: "moonwell",
      },
    },
    secondaryStrategyScaffolds: {
      scaffolds: [
        {
          id: "stablecoin_spread_loop",
          label: "Stablecoin spread loop",
          category: "yield",
          protocolTrack: { chains: ["base"], protocols: ["morpho", "aave_v3"] },
          blockers: ["stable_loop_protocol_adapter_not_built"],
          nextAction: { code: "build_stablecoin_spread_loop" },
        },
      ],
    },
    now: "2026-04-15T16:00:00.000Z",
  });

  assert.equal(report.summary.candidateCount, 2);
  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.activeView.maxAllocationPerStrategyUsd, null);
  assert.equal(report.planningView.maxAllocationPerStrategyUsd, null);
  assert.equal(report.planningView.planningQueue[0].id, "wrapped-btc-loop-base-moonwell");
  assert.equal(
    report.notes.some((item) => item.includes("Cross-chain reserve movement belongs in the allocator/rebalance layer")),
    true,
  );

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.activeAllocationCount, 0);
  assert.equal(summary.activeReadyCandidateCount, 0);
  assert.equal(summary.topActiveReadyCandidate, null);
  assert.equal(summary.topPlanningCandidate.id, "wrapped-btc-loop-base-moonwell");
});

test("allocator core prioritizes recursive wrapped loop when recursive phase3 validation exists", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "blocked",
          blockers: ["recursive_observed_receipts_missing"],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "collect_recursive_loop_observed_receipts" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    now: "2026-04-17T19:50:00.000Z",
  });

  assert.equal(report.summary.candidateCount, 1);
  assert.equal(report.planningView.planningQueue[0].id, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.summary.nextAction.code, "collect_recursive_loop_observed_receipts");
});

test("allocator core exposes active-ready recursive strategy even before an active budget exists", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "passed",
          blockers: [],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "review_recursive_loop_observed_receipts" },
        },
        {
          id: "recursive_stablecoin_lending_loop_validation",
          overallStatus: "blocked",
          blockers: ["stable_swap_binding_missing"],
          evidence: { strategyId: "recursive_stablecoin_lending_loop" },
          nextAction: { code: "materialize_stable_swap_binding" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    recursiveStablecoinLoop: {
      strategy: {
        id: "recursive_stablecoin_lending_loop",
        label: "Recursive stablecoin lending loop",
        chain: "base",
        protocol: "aave_v3",
        arrivalFamily: "stablecoin",
      },
    },
    now: "2026-04-18T11:30:00.000Z",
  });

  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.summary.activeReadyCandidateCount, 1);
  assert.equal(report.summary.topActiveAllocationId, null);
  assert.equal(report.summary.topActiveReadyCandidateId, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.summary.nextAction.code, "review_recursive_loop_observed_receipts");
  assert.equal(report.planningView.planningQueue[0].id, "recursive_wrapped_btc_lending_loop");

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.topActiveAllocation, null);
  assert.equal(summary.topActiveReadyCandidate.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.activeNextAction.code, "review_recursive_loop_observed_receipts");
});

test("allocator core surfaces destination-promotion-gate allocation_ready venues as active-ready candidates", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          chain: "base",
          familyId: "stablecoin_lending_carry",
          label: "Stablecoin lending carry",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "allocation_ready", blockers: [] },
        },
        {
          templateId: "bsc:stablecoin_lending_carry",
          chain: "bsc",
          familyId: "stablecoin_lending_carry",
          label: "Stablecoin lending carry",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "allocation_ready", blockers: [] },
        },
      ],
    },
    now: "2026-04-20T00:00:00.000Z",
  });

  const ids = report.candidates.map((item) => item.id);
  assert.equal(ids.includes("base:stablecoin_lending_carry"), true);
  assert.equal(ids.includes("bsc:stablecoin_lending_carry"), true);
  const baseCandidate = report.candidates.find((item) => item.id === "base:stablecoin_lending_carry");
  assert.equal(baseCandidate.activeEligibility, "active_ready");
  assert.equal(baseCandidate.assetFamily, "stables");
  assert.equal(baseCandidate.chain, "base");
  assert.deepEqual(baseCandidate.protocols, ["aave_v3"]);
  const bscCandidate = report.candidates.find((item) => item.id === "bsc:stablecoin_lending_carry");
  assert.deepEqual(bscCandidate.protocols, ["venus"]);
});

test("allocator core keeps review_only destination venues out of active plan with blockers surfaced", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: 1000 },
      summary: { planningBudgetUsd: 1000 },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        {
          templateId: "base:wrapped_btc_lp_positions",
          chain: "base",
          familyId: "wrapped_btc_lp_positions",
          label: "Wrapped BTC LP",
          gate: { status: "promotable", blockers: [] },
          allocationGate: {
            status: "review_only",
            blockers: ["manual_contract_review_required", "evidence_policy_incomplete"],
          },
        },
      ],
    },
    now: "2026-04-20T00:00:01.000Z",
  });

  const candidate = report.candidates.find((item) => item.id === "base:wrapped_btc_lp_positions");
  assert.ok(candidate, "review_only candidate must be present");
  assert.equal(candidate.activeEligibility, "blocked");
  assert.equal(candidate.planningEligibility, "review_only");
  assert.equal(candidate.blockers.includes("manual_contract_review_required"), true);
  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(
    report.activeView.activePlan.find((item) => item.id === "base:wrapped_btc_lp_positions"),
    undefined,
  );
  const planningItem = report.planningView.planningQueue.find((item) => item.id === "base:wrapped_btc_lp_positions");
  assert.ok(planningItem, "review_only candidate must appear in planning queue");
  assert.equal(planningItem.planningEligibility, "review_only");
});

test("allocator core enforces per-chain concentration cap and defers excess active-ready candidates", () => {
  const makeReadyItem = (templateId, chain, familyId) => ({
    templateId,
    chain,
    familyId,
    label: templateId,
    gate: { status: "promotable", blockers: [] },
    allocationGate: { status: "allocation_ready", blockers: [] },
  });

  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: 1000 },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        makeReadyItem("base:stablecoin_lending_carry", "base", "stablecoin_lending_carry"),
        makeReadyItem("base:stablecoin_lp_or_basis", "base", "stablecoin_lp_or_basis"),
        makeReadyItem("base:extra_stables_sleeve", "base", "stablecoin_extra_family"),
      ],
    },
    now: "2026-04-20T00:00:02.000Z",
  });

  const perItemLimit = report.activeView.maxAllocationPerStrategyUsd;
  assert.equal(perItemLimit, 200);

  const chainBaseAdmitted = report.activeView.activePlan.filter((item) => item.chain === "base");
  const chainBaseUsage = report.activeView.exposureUsage.byChain.base || 0;
  assert.equal(chainBaseUsage <= 0.4 * 1000 + 1e-6, true, `base chain usage ${chainBaseUsage} must not exceed 40% cap`);
  assert.equal(chainBaseAdmitted.length <= 2, true, "chain cap must admit at most 2 base venues at $200 each under 40% of $1000");

  const capDeferred = report.activeView.planningQueue.filter((item) => item.planningEligibility === "cap_deferred");
  assert.equal(capDeferred.length >= 1, true, "at least one venue must be cap_deferred once chain cap is reached");
  const capBlocker = capDeferred.find((item) =>
    (item.blockers || []).some((blocker) => blocker === "chain_cap_exceeded" || blocker === "asset_family_cap_exceeded" || blocker === "protocol_cap_exceeded"),
  );
  assert.ok(capBlocker, "cap_deferred venue must carry a cap_exceeded blocker");
});

test("allocator core admits a chain-diversified portfolio across base and bsc stablecoin carry venues when protocols differ", () => {
  const makeReadyItem = (templateId, chain, familyId) => ({
    templateId,
    chain,
    familyId,
    label: templateId,
    gate: { status: "promotable", blockers: [] },
    allocationGate: { status: "allocation_ready", blockers: [] },
  });

  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: 1000 },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "passed",
          blockers: [],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "review_recursive_loop_observed_receipts" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    destinationPromotionGate: {
      items: [
        makeReadyItem("base:stablecoin_lending_carry", "base", "stablecoin_lending_carry"),
        makeReadyItem("bsc:stablecoin_lending_carry", "bsc", "stablecoin_lending_carry"),
      ],
    },
    now: "2026-04-20T00:00:03.000Z",
  });

  const activeChains = new Set(report.activeView.activePlan.map((item) => item.chain));
  assert.equal(activeChains.size >= 2, true, "active plan must span at least 2 chains for diversification");
  const activeAssetFamilies = new Set(report.activeView.activePlan.map((item) => item.assetFamily));
  assert.equal(activeAssetFamilies.size >= 2, true, "active plan must span at least 2 asset families (btc_wrappers + stables)");
  assert.equal(report.summary.activeAllocationCount >= 2, true);
  assert.equal(report.activeView.exposureUsage.byProtocol.aave_v3 > 0, true);
  assert.equal(report.activeView.exposureUsage.byProtocol.venus > 0, true);
});

test("allocator core surfaces priority expansion chains as review-only when target chains have promotable but not allocation-ready venues", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          chain: "avalanche",
          familyId: "wrapped_btc_lending",
          label: "Wrapped BTC -> lending positions",
          gate: { status: "promotable", blockers: [] },
          allocationGate: {
            status: "review_only",
            blockers: ["allocation_grossReturnBps_recheck_required", "allocation_unwindSlippageBps_recheck_required"],
          },
        },
        {
          templateId: "sonic:wrapped_btc_lp_positions",
          chain: "sonic",
          familyId: "wrapped_btc_lp_positions",
          label: "Wrapped BTC -> LP positions",
          gate: { status: "promotable", blockers: [] },
          allocationGate: {
            status: "review_only",
            blockers: ["allocation_check_count_below_policy"],
          },
        },
      ],
    },
    now: "2026-04-20T00:00:04.000Z",
  });

  assert.deepEqual(report.summary.priorityExpansionActiveReadyChains, []);
  assert.deepEqual(report.summary.priorityExpansionReviewOnlyChains.sort(), ["avalanche", "sonic"]);
  const avalanche = report.priorityChainExpansion.perChain.find((item) => item.chain === "avalanche");
  assert.equal(avalanche.reviewOnlyCount, 1);
  assert.equal(avalanche.topCandidate.id, "avalanche:wrapped_btc_lending");
  assert.deepEqual(avalanche.topCandidate.protocols, ["benqi"]);
  assert.equal(report.diversifiedPortfolioDraft.reviewQueue.some((item) => item.chain === "avalanche"), true);
  assert.equal(report.diversifiedPortfolioDraft.reviewQueue.some((item) => item.chain === "sonic"), true);
});

test("allocator core chain coverage matrix enumerates target gateway chains and marks missing cells template_missing", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          chain: "base",
          familyId: "stablecoin_lending_carry",
          label: "Stablecoin lending carry",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "allocation_ready", blockers: [] },
        },
      ],
    },
    destinationStrategyRegistry: {
      chains: [
        { chain: "base", arrivalAssetFamilies: ["stablecoin", "wrapped_btc"], strategies: [] },
        { chain: "avalanche", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "bera", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "bsc", arrivalAssetFamilies: ["stablecoin", "wrapped_btc"], strategies: [] },
        { chain: "sonic", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "soneium", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "unichain", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
      ],
    },
    now: "2026-04-20T00:00:04.000Z",
  });

  const coverage = report.chainCoverage;
  assert.ok(coverage, "chainCoverage block must exist");
  assert.equal(coverage.targetChains.includes("avalanche"), true);
  assert.equal(coverage.targetChains.includes("bera"), true);
  assert.equal(coverage.targetChains.includes("soneium"), true);
  assert.equal(coverage.targetFamilies.includes("wrapped_btc_lending"), true);

  const avaxStablesCarry = coverage.matrix.find(
    (row) => row.chain === "avalanche" && row.family === "stablecoin_lending_carry",
  );
  assert.equal(avaxStablesCarry.status, "template_missing");
  assert.equal(avaxStablesCarry.blockers.includes("template_missing_for_chain_family"), true);
  assert.equal(avaxStablesCarry.blockers.includes("stablecoin_gateway_arrival_missing"), true);
  assert.equal(avaxStablesCarry.blockers.includes("stablecoin_indirect_via_wrapped_btc_possible"), true);

  const baseStablesCarry = coverage.matrix.find(
    (row) => row.chain === "base" && row.family === "stablecoin_lending_carry",
  );
  assert.equal(baseStablesCarry.status, "allocation_ready");

  assert.equal(coverage.summary.cellCount, coverage.targetChains.length * coverage.targetFamilies.length);
  assert.equal(coverage.summary.templateMissingCellCount > 0, true);
  assert.equal(coverage.summary.stablecoinGatewayArrivalMissingChains.includes("avalanche"), true);
  assert.equal(coverage.summary.stablecoinIndirectViaWrappedBtcChains.includes("avalanche"), true);
});

test("allocator core chain coverage classifies chains into tier1/tier2/tier3/tier4 by evidence readiness", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          chain: "base",
          familyId: "stablecoin_lending_carry",
          label: "Stablecoin lending carry",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "allocation_ready", blockers: [] },
        },
        {
          templateId: "bsc:stablecoin_lending_carry",
          chain: "bsc",
          familyId: "stablecoin_lending_carry",
          label: "Stablecoin lending carry",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "allocation_ready", blockers: [] },
        },
        {
          templateId: "avalanche:wrapped_btc_lending",
          chain: "avalanche",
          familyId: "wrapped_btc_lending",
          label: "Avalanche wrapped BTC lending",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "review_only", blockers: ["allocation_grossReturnBps_recheck_required"] },
        },
        {
          templateId: "sonic:wrapped_btc_lending",
          chain: "sonic",
          familyId: "wrapped_btc_lending",
          label: "Sonic wrapped BTC lending",
          gate: { status: "blocked", blockers: ["evidence_policy_incomplete"] },
          allocationGate: { status: "blocked", blockers: ["no_current_destination_venue"] },
        },
      ],
    },
    destinationStrategyRegistry: {
      chains: [
        { chain: "base", arrivalAssetFamilies: ["stablecoin", "wrapped_btc"], strategies: [] },
        { chain: "bsc", arrivalAssetFamilies: ["stablecoin", "wrapped_btc"], strategies: [] },
        { chain: "avalanche", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "sonic", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "bera", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "unichain", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
        { chain: "soneium", arrivalAssetFamilies: ["wrapped_btc"], strategies: [] },
      ],
    },
    now: "2026-04-20T00:00:05.000Z",
  });

  const tiers = report.chainCoverage.tiers;
  assert.equal(tiers.tier1_active_ready.includes("base"), true);
  assert.equal(tiers.tier1_active_ready.includes("bsc"), true);
  assert.equal(tiers.tier2_review_only.includes("avalanche"), true);
  assert.equal(tiers.tier3_blocked_only.includes("sonic"), true);
  assert.equal(tiers.tier4_template_only.includes("bera"), true);
  assert.equal(tiers.tier4_template_only.includes("unichain"), true);
  assert.equal(tiers.tier4_template_only.includes("soneium"), true);

  assert.equal(report.summary.tier1ActiveReadyChains.includes("base"), true);
  assert.equal(report.summary.tier4TemplateOnlyChains.includes("bera"), true);
  assert.equal(report.summary.stablecoinGatewayArrivalMissingChains.includes("sonic"), true);
  assert.equal(report.summary.stablecoinIndirectViaWrappedBtcChains.includes("sonic"), true);

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.chainCoverage.tier1ActiveReadyChains.length >= 2, true);
  assert.equal(summary.chainCoverage.templateMissingCellCount > 0, true);
  assert.equal(summary.chainCoverage.stablecoinGatewayArrivalMissingChains.includes("unichain"), true);
  assert.equal(summary.chainCoverage.stablecoinIndirectViaWrappedBtcChains.includes("unichain"), true);
});

test("allocator core surfaces per-chain dominant blockers for tier2 review_only chains", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: { validations: [] },
    destinationPromotionGate: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          chain: "avalanche",
          familyId: "wrapped_btc_lending",
          label: "Avalanche wrapped BTC lending",
          gate: { status: "promotable", blockers: [] },
          allocationGate: {
            status: "review_only",
            blockers: ["allocation_grossReturnBps_recheck_required", "allocation_unwindSlippageBps_recheck_required"],
          },
        },
        {
          templateId: "avalanche:wrapped_btc_lp_positions",
          chain: "avalanche",
          familyId: "wrapped_btc_lp_positions",
          label: "Avalanche wrapped BTC LP",
          gate: { status: "promotable", blockers: [] },
          allocationGate: {
            status: "review_only",
            blockers: ["allocation_check_count_below_policy"],
          },
        },
      ],
    },
    now: "2026-04-20T00:00:06.000Z",
  });

  const avaxChain = report.chainCoverage.perChain.find((row) => row.chain === "avalanche");
  assert.ok(avaxChain);
  assert.equal(avaxChain.tier, "tier2_review_only");
  assert.equal(avaxChain.counts.review_only, 2);
  assert.equal(avaxChain.dominantBlockers.includes("allocation_grossReturnBps_recheck_required"), true);
  assert.equal(avaxChain.dominantBlockers.includes("allocation_check_count_below_policy"), true);
});

test("allocator core keeps active allocation distinct once active budget is declared", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: 500 },
      summary: { planningBudgetUsd: 1000 },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "passed",
          blockers: [],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "review_recursive_loop_observed_receipts" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    now: "2026-04-18T11:35:00.000Z",
  });

  assert.equal(report.summary.activeAllocationCount, 1);
  assert.equal(report.summary.topActiveAllocationId, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.activeView.activePlan[0].maxAllocationUsd, 100);

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.topActiveAllocation.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.topActiveAllocation.maxAllocationUsd, 100);
});
