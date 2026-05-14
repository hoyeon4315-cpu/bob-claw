import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllSourceDeploymentSelectorReport } from "../src/strategy/all-source-deployment-selector.mjs";

const NOW = "2026-05-14T19:30:00.000Z";

function baseInputs(overrides = {}) {
  return {
    now: NOW,
    capitalAudit: {
      generatedAt: NOW,
      summary: {
        currentNativeBtcSats: 233967,
        currentNativeBtcUsd: 190.73,
        currentCombinedUsd: null,
        issueCount: 0,
      },
    },
    unifiedCapital: {
      halt: true,
      unifiedNavUsd: null,
      flags: ["source_missing"],
      missingSources: ["evmAutopilotUsd"],
    },
    killStatus: {
      halted: false,
      replay: { staleArm: false },
    },
    paybackStatus: {
      decision: { status: "blocked", reason: "missing_destination_config" },
    },
    merklQueue: {
      summary: { queueCount: 1 },
      queue: [
        {
          queueId: "merkl:base-usdc",
          opportunityId: "base-usdc",
          chain: "base",
          protocolId: "morpho",
          family: "stable_treasury_carry",
          mappedStrategyId: "gateway_native_asset_conversion_sleeve",
          executionSurface: "stableCarry",
          entryAssets: ["USDC"],
          campaignRemainingHours: 168,
          aprPct: 12,
          protocolBindingPlan: { status: "binding_ready" },
          executionReadiness: { status: "inventory_ready", executorSupported: true },
          autoEntry: { status: "blocked", blockers: [] },
        },
      ],
    },
    campaignAware: {
      candidates: [
        {
          opportunityId: "base-usdc",
          chain: "base",
          protocol: "morpho",
          displayedApr: 20.857142857,
          rewardToken: "USDC",
          rewardTokenHaircut: 0,
          rewardExitLiquidityStatus: {
            ready: true,
            status: "stable_reward_no_swap_depth_required_for_candidate_report",
          },
          expectedHoldDays: 7,
          operatorPositionUsd: 25,
          operatorExpectedGrossProfitUsd: 0.1,
          estimatedGasClaimSwapBridgeCostUsd: 0.03,
          expectedNetProfitUsd: 0.07,
          tinyCanaryEvStatus: { ready: true, roundTripCostUsd: 0.03 },
          blockers: [],
        },
      ],
    },
    strategyCatalog: {
      btcFamilies: [
        {
          id: "tokenized_gold_rotation",
          label: "Tokenized gold rotation",
          status: "unobserved",
          evidence: { liveEligible: false, roundTripCostUsd: null },
        },
      ],
    },
    executionSurfaces: {
      strategies: [
        {
          id: "gateway_native_asset_conversion_sleeve",
          currentLiveEligible: false,
          liveAdmissionBlockers: ["live_trading_blocked"],
        },
      ],
    },
    allocatorCore: {
      candidates: [
        {
          id: "wrapped-btc-loop-base-moonwell",
          chain: "base",
          protocols: ["moonwell"],
          assetFamily: "btc_wrappers",
          category: "yield",
          blockers: ["phase3_validation_missing"],
          score: 0.5,
        },
      ],
    },
    radarBoard: { candidates: [] },
    defiLlamaPools: [
      {
        chain: "Base",
        project: "morpho",
        symbol: "USDC",
        pool: "pool-1",
        tvlUsd: 1_000_000,
        apy: 8,
        stablecoin: true,
      },
    ],
    policyEvaluator: async ({ intent }) => ({
      decision: "ALLOW",
      blockers: [],
      strategyCaps: { caps: { tinyLivePerTxUsd: 25, perTxUsd: 500 } },
      effectiveIntent: intent,
      results: [{ policy: "cap_check", decision: "ALLOW", blockers: [] }],
    }),
    ...overrides,
  };
}

test("all-source selector normalizes every required source and selects the EV-positive policy-attempted candidate", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(baseInputs());

  assert.equal(report.sourceCoverage.length, 8);
  assert.deepEqual(
    report.sourceCoverage.map((row) => row.source),
    [
      "pendle",
      "defillama",
      "merkl",
      "tokenized_gold_reserve",
      "stable_carry",
      "btc_wrapper_lending",
      "radar_campaign",
      "strategy_catalog",
    ],
  );
  assert.ok(report.candidates.length >= 4);
  const selected = report.selection.selectedCandidate;
  assert.equal(selected.opportunityId, "base-usdc");
  assert.equal(selected.source, "merkl");
  assert.equal(selected.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(selected.chain, "base");
  assert.equal(selected.notionalUsd, 25);
  assert.equal(selected.expectedRealizedNetUsd, 0.07);
  assert.equal(selected.p90CostFloorUsd, 0.03);
  assert.equal(selected.capResult.status, "ready");
  assert.equal(selected.policyResult.decision, "ALLOW");
  assert.equal(selected.signerIntentAvailability.ready, true);
  assert.equal(selected.receiptCapitalAuditPath.capitalAuditRequired, true);
  assert.equal(report.selection.status, "POLICY_ATTEMPTED");
  assert.equal(report.broadcast.txHashes.length, 0);
  assert.equal(report.broadcast.noBroadcastReason, "selector_policy_attempt_only_no_signer_execute");
  assert.equal(report.capitalUtilization.before.productiveUsd, 0);
  assert.equal(report.capitalUtilization.target.productiveTargetRatio, 0.8);
});

test("all-source selector does not treat DefiLlama as executable without binding, cap, unwind, and receipt path", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { queue: [], summary: { queueCount: 0 } },
      campaignAware: { candidates: [] },
      policyEvaluator: async () => {
        throw new Error("policy should not be attempted for unbound DefiLlama pool");
      },
    }),
  );

  const defillama = report.candidates.find((candidate) => candidate.source === "defillama");
  assert.ok(defillama);
  assert.equal(defillama.strategyId, "defillama-yield-portfolio");
  assert.ok(defillama.blockers.includes("defillama_requires_executable_protocol_binding"));
  assert.ok(defillama.blockers.includes("receipt_path_missing"));
  assert.equal(defillama.signerIntentAvailability.ready, false);
  assert.equal(report.selection.status, "NO_TRADE");
  assert.equal(
    report.noTradeTable.some((row) => row.source === "defillama"),
    true,
  );
});

test("all-source selector emits exact full-universe NO_TRADE math when policy or EV blocks every candidate", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      campaignAware: {
        candidates: [
          {
            opportunityId: "base-usdc",
            chain: "base",
            protocol: "morpho",
            displayedApr: 2.085714286,
            expectedHoldDays: 7,
            operatorPositionUsd: 25,
            operatorExpectedGrossProfitUsd: 0.01,
            estimatedGasClaimSwapBridgeCostUsd: 0.04,
            expectedNetProfitUsd: -0.03,
            tinyCanaryEvStatus: {
              ready: false,
              blocker: "tiny_canary_unprofitable:need_$100_on_base",
              roundTripCostUsd: 0.04,
            },
            blockers: ["tiny_canary_unprofitable:need_$100_on_base"],
          },
        ],
      },
      policyEvaluator: async () => {
        throw new Error("negative EV candidate should not reach policy");
      },
    }),
  );

  assert.equal(report.selection.status, "NO_TRADE");
  assert.equal(report.selection.selectedCandidate, null);
  assert.ok(report.noTradeTable.length >= 8);
  const merkl = report.noTradeTable.find((row) => row.source === "merkl" && row.opportunityId === "base-usdc");
  assert.ok(merkl);
  assert.equal(merkl.expectedGrossUsd, 0.01);
  assert.equal(merkl.totalCostUsd, 0.04);
  assert.equal(merkl.expectedRealizedNetUsd, -0.03);
  assert.ok(merkl.blockers.includes("ev_not_positive"));
  assert.equal(report.broadcast.noBroadcastReason, "no_positive_ev_policy_eligible_candidate");
});

test("all-source selector resolves live Merkl inventory and converts PRETGE reward blocker into exact cap math", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklOpportunities: {
        opportunities: [
          {
            opportunityId: "13747891056392346282",
            chain: "base",
            protocolId: "yo",
            rewardTokenSymbols: ["YO"],
            rewardTokenTypes: ["PRETGE"],
            protocolBinding: {
              assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              assetSymbol: "USDC",
            },
          },
        ],
      },
      merklQueue: {
        summary: { queueCount: 1 },
        queue: [
          {
            queueId: "merkl:13747891056392346282",
            opportunityId: "13747891056392346282",
            chain: "base",
            protocolId: "yo",
            family: "stable_treasury_carry",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            executionSurface: "stableCarry",
            entryAssets: ["USDC"],
            campaignRemainingHours: 427.6183627777778,
            aprPct: 7.8,
            capabilityGaps: ["current_inventory_entry_route_required"],
            protocolBindingPlan: {
              status: "binding_ready",
              resolvedBinding: {
                assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                assetSymbol: "USDC",
              },
            },
            executionReadiness: { status: "inventory_unknown", executorSupported: true },
            autoEntry: { status: "blocked", blockers: ["inventory_unknown"] },
          },
        ],
      },
      campaignAware: {
        candidates: [
          {
            opportunityId: "13747891056392346282",
            chain: "base",
            protocol: "yo",
            displayedApr: 7.8,
            rewardToken: "YO",
            rewardTokenHaircut: 0.5,
            rewardExitLiquidityStatus: {
              ready: false,
              status: "missing_explicit_reward_exit_liquidity_proof",
              reason: "non_stable_reward_requires_depth_proof",
            },
            expectedHoldDays: 17.817431782407407,
            operatorPositionUsd: 10,
            operatorExpectedGrossProfitUsd: 0.019037803822298326,
            estimatedGasClaimSwapBridgeCostUsd: 0.012,
            expectedNetProfitUsd: 0.007037803822298325,
            tinyCanaryEvStatus: {
              ready: false,
              blocker: "tiny_canary_unprofitable:need_$13_on_base",
              currentAmountUsd: 10,
              neededUsd: 12.60649611899542,
              holdDays: 17.817431782407407,
              roundTripCostUsd: 0.012,
            },
            blockers: ["tiny_canary_unprofitable:need_$13_on_base", "reward_exit_liquidity_unproven"],
          },
        ],
      },
      capitalManagerRefill: {
        capitalPlan: {
          inventory: {
            tokens: [
              {
                chain: "base",
                token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                ticker: "USDC",
                actualDecimal: 25262.222885,
                estimatedUsd: 25262.222885,
                status: "over_max_active",
                staleFallback: false,
                scanError: null,
              },
            ],
          },
        },
      },
      policyEvaluator: async () => {
        throw new Error("PRETGE reward cap-math blocker must not reach policy");
      },
    }),
  );

  const merkl = report.candidates.find(
    (candidate) => candidate.source === "merkl" && candidate.opportunityId === "13747891056392346282",
  );
  assert.ok(merkl);
  assert.equal(merkl.routeRefillBinding.ready, true);
  assert.equal(merkl.metadata.inventoryProof.status, "ready");
  assert.equal(merkl.metadata.inventoryProof.estimatedUsd, 25262.222885);
  assert.equal(merkl.rewardHaircut, 0.85);
  assert.equal(merkl.expectedRealizedNetUsd, -0.006289);
  assert.equal(merkl.metadata.rewardExitLiquidityProof.status, "failed");
  assert.ok(merkl.blockers.includes("reward_exit_liquidity_failed:pre_tge_reward_token"));
  assert.ok(merkl.blockers.includes("tiny_canary_resize_above_cap:need_$43_cap_$25"));
  assert.equal(merkl.blockers.includes("inventory_unknown"), false);
  assert.equal(merkl.blockers.includes("reward_exit_liquidity_unproven"), false);
  assert.equal(report.selection.status, "NO_TRADE");
});
