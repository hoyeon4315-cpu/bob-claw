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
          protocolBindingPlan: { status: "binding_ready", bindingKind: "erc4626_vault_supply_withdraw" },
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
  assert.equal(selected.signerIntentAvailability.builder, "merkl_canary_autopilot");
  assert.equal(selected.signerIntentAvailability.intentType, "erc4626_deposit");
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

test("all-source selector converts DefiLlama pools into executable candidates only through committed bindings", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { queue: [], summary: { queueCount: 0 } },
      campaignAware: { candidates: [] },
      defiLlamaPools: [
        {
          chain: "Optimism",
          project: "aave-v3",
          symbol: "USDC",
          pool: "optimism-aave-usdc",
          tvlUsd: 5_000_000,
          apy: 20,
        },
      ],
      capitalManagerRefill: {
        capitalPlan: {
          inventory: {
            tokens: [
              {
                chain: "optimism",
                token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
                ticker: "USDC",
                actualDecimal: 14.986814,
                estimatedUsd: 14.986814,
                status: "over_max_active",
                staleFallback: false,
                scanError: null,
              },
            ],
          },
        },
      },
    }),
  );

  const defillama = report.selection.selectedCandidate;
  assert.equal(defillama.source, "defillama");
  assert.equal(defillama.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(defillama.notionalUsd, 3);
  assert.equal(defillama.executorBinding.ready, true);
  assert.equal(defillama.routeRefillBinding.ready, true);
  assert.equal(defillama.signerIntentAvailability.builder, "destination_representative_autopilot");
  assert.equal(defillama.signerIntentAvailability.intentType, "aave_supply");
  assert.equal(defillama.signerIntentAvailability.ready, true);
  assert.equal(defillama.blockers.includes("defillama_requires_executable_protocol_binding"), false);
  assert.equal(defillama.blockers.includes("unwind_path_missing"), false);
  assert.equal(defillama.receiptCapitalAuditPath.capitalAuditRequired, true);
  assert.equal(report.selection.status, "POLICY_ATTEMPTED");
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

test("family surface uses same-tick inventory proof before reporting the top EV-positive blocker", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: {
        summary: { queueCount: 1 },
        queue: [
          {
            queueId: "merkl:zyfai-usdc",
            opportunityId: "zyfai-usdc",
            chain: "base",
            protocolId: "zyfai",
            family: "stable_treasury_carry",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            executionSurface: "stableCarry",
            entryAssets: ["USDC"],
            campaignRemainingHours: 421.74,
            aprPct: 8.48,
            capabilityGaps: ["protocol_executor_required", "current_inventory_entry_route_required"],
            protocolBindingPlan: { status: "unsupported_protocol_binding" },
            executionReadiness: {
              status: "executor_missing",
              executorSupported: false,
              reasons: ["protocol_executor_missing", "inventory_snapshot_missing"],
            },
            autoEntry: {
              status: "blocked",
              blockers: [
                "protocol_binding_not_ready",
                "protocol_binding_executor_missing",
                "executor_missing",
                "protocol_executor_required",
              ],
            },
          },
        ],
      },
      campaignAware: {
        candidates: [
          {
            opportunityId: "zyfai-usdc",
            chain: "base",
            protocol: "zyfai",
            displayedApr: 8.48,
            rewardToken: "USDC",
            expectedHoldDays: 17.5725,
            operatorPositionUsd: 6,
            estimatedGasClaimSwapBridgeCostUsd: 0,
            expectedNetProfitUsd: 0.024496,
            blockers: [],
          },
        ],
      },
      merklOpportunities: {
        opportunities: [
          {
            opportunityId: "zyfai-usdc",
            chain: "base",
            protocolId: "zyfai",
            type: "ENCOMPASSING",
            action: "DROP",
            identifier: "0x4bE0228D40Db5Ca43e4eCf93E633be4b9fC52229",
            explorerAddress: null,
            protocolBinding: null,
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
        throw new Error("unsupported ZyFAI protocol binding must not reach policy");
      },
    }),
  );

  const candidate = report.candidates.find((item) => item.source === "merkl" && item.opportunityId === "zyfai-usdc");
  assert.ok(candidate);
  assert.equal(candidate.routeRefillBinding.ready, true);
  assert.equal(candidate.metadata.inventoryProof.status, "ready");
  assert.equal(candidate.blockers.includes("inventory_unknown"), false);
  assert.ok(candidate.blockers.includes("merkl_drop_campaign_entry_contract_missing"));
  assert.ok(candidate.blockers.includes("protocol_binding_identifier_has_no_code"));
  assert.equal(candidate.signerIntentAvailability.ready, false);
  assert.equal(candidate.signerIntentAvailability.reason, "merkl_drop_campaign_entry_contract_missing");

  const merkl = report.familyCoverage.find((row) => row.family === "merkl");
  const stable = report.familyCoverage.find((row) => row.family === "stable_carry");
  assert.equal(merkl.firstBlockingReason, "merkl_drop_campaign_entry_contract_missing");
  assert.equal(stable.firstBlockingReason, "merkl_drop_campaign_entry_contract_missing");
});

test("family surface proves fresh Radar zero instead of leaving NO_SURFACE_EVIDENCE", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { queue: [], summary: { queueCount: 0 } },
      campaignAware: { candidates: [] },
      radarBoard: {
        generatedAt: NOW,
        summary: {
          observedCount: 0,
          candidateCount: 0,
          executableCount: 0,
        },
        candidates: [],
      },
      policyEvaluator: async () => {
        throw new Error("fresh zero Radar surface should not reach policy");
      },
    }),
  );

  const radar = report.familyCoverage.find((row) => row.family === "radar");
  assert.ok(radar);
  assert.equal(radar.discoveredCandidateCount, 0);
  assert.equal(radar.firstBlockingReason, "RADAR_BOARD_FRESH_ZERO");
});

test("family surface report keeps Pendle visible when pendle-yt-canary has queue or audit evidence", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: {
        summary: {
          queueCount: 11,
          byStrategy: { "pendle-yt-canary": 11 },
          pendleYtCount: 13,
          pendleYtCanaryReadyCount: 1,
        },
        queue: [],
      },
      campaignAware: { candidates: [] },
      capitalAudit: {
        summary: { currentNativeBtcUsd: 190, issueCount: 1 },
        issues: [
          {
            strategyId: "pendle-yt-canary",
            category: "pendle_yt_entry",
            result: "no_receipt",
          },
        ],
      },
      signerAuditRecords: [
        {
          strategyId: "pendle-yt-canary",
          chain: "base",
          lifecycle: { stage: "broadcast_submitted" },
          broadcast: { txHash: "0xpendle" },
        },
      ],
      protocolPositionMarks: [],
      policyEvaluator: async () => {
        throw new Error("Pendle queue/audit evidence should not imply policy eligibility");
      },
    }),
  );

  const pendle = report.familyCoverage.find((row) => row.family === "pendle");
  assert.ok(pendle);
  assert.ok(pendle.discoveredCandidateCount >= 13);
  assert.equal(pendle.unreconciledBroadcastCount, 2);
  assert.equal(pendle.policyEligibleCandidateCount, 0);
  assert.equal(pendle.selectedAction, "reconcile_receipt");
  assert.equal(pendle.firstBlockingReason, "NO_RECEIPT_RECONCILIATION");
});

test("family surface report does not call blocked Radar DefiLlama Merkl stable BTC gold or catalog surfaces NO_CANDIDATE", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: {
        summary: { queueCount: 2 },
        queue: [
          {
            queueId: "merkl:stable",
            opportunityId: "stable-op",
            chain: "base",
            protocolId: "morpho",
            family: "stable_treasury_carry",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            executionSurface: "stableCarry",
            entryAssets: ["USDC"],
            protocolBindingPlan: { status: "binding_ready" },
            executionReadiness: { status: "inventory_unknown", executorSupported: true },
            autoEntry: { status: "blocked", blockers: ["inventory_unknown"] },
          },
        ],
      },
      campaignAware: {
        candidates: [
          {
            opportunityId: "stable-op",
            chain: "base",
            protocol: "morpho",
            displayedApr: 5,
            expectedHoldDays: 7,
            operatorPositionUsd: 10,
            estimatedGasClaimSwapBridgeCostUsd: 0.03,
            blockers: ["inventory_unknown"],
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
            blockers: ["health_factor_unmeasured"],
          },
        ],
      },
      radarBoard: {
        candidates: [
          {
            id: "radar-1",
            strategyId: "radar-live-canary",
            chain: "base",
            protocol: "aerodrome",
            blockers: ["reward_exit_liquidity_unproven"],
          },
        ],
      },
      strategyCatalog: {
        btcFamilies: [
          { id: "wrapped-btc-loop-base-moonwell", status: "blocked", blockers: ["hf_missing"] },
          { id: "tokenized_gold_rotation", status: "blocked", blockers: ["deterministic_unwind_required"] },
        ],
        entries: [{ id: "catalog-only-lane", status: "blocked", blockers: ["executor_missing"] }],
        strategies: [],
        ethBranches: [],
      },
      defiLlamaPools: [
        {
          chain: "Base",
          project: "morpho",
          symbol: "USDC",
          pool: "defillama-pool",
          tvlUsd: 1_000_000,
          apy: 5,
        },
      ],
      policyEvaluator: async () => {
        throw new Error("Blocked family surfaces should not reach policy");
      },
    }),
  );

  for (const family of [
    "radar",
    "defillama",
    "merkl",
    "stable_carry",
    "btc_wrapper_lending",
    "tokenized_gold_reserve",
    "strategy_catalog",
  ]) {
    const row = report.familyCoverage.find((entry) => entry.family === family);
    assert.ok(row, family);
    assert.ok(row.discoveredCandidateCount > 0, family);
    assert.notEqual(row.firstBlockingReason, "NO_CANDIDATE", family);
  }
});
