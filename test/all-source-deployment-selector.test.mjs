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

  assert.equal(report.sourceCoverage.length, 9);
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
      "aggressive_velocity",
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
  assert.ok(report.actionLaneSummary);
  assert.equal(report.actionLaneSummary.safety.reportOnly, true);
  assert.equal(report.actionLaneSummary.safety.allowedToExecuteLive, false);
  assert.equal(report.actionLaneSummary.familiesAssignedExactlyOnce, true);
  assert.equal(report.actionLaneQueue.length, report.familyActionTable.length);
  assert.equal(new Set(report.actionLaneQueue.map((item) => item.family)).size, report.familyActionTable.length);
  const merklLane = report.actionLaneQueue.find((item) => item.family === "merkl");
  assert.ok(merklLane);
  assert.equal(merklLane.lane, "entry_candidate");
  assert.equal(merklLane.canLive, false);
  assert.equal(merklLane.allowedToExecuteLive, false);
  assert.equal(merklLane.suggestedDryRunCommand, "node src/cli/run-all-source-deployment-selector.mjs --json");
  assert.equal(report.laneHandlerPilot.reportOnly, true);
  assert.equal(report.laneHandlerPilot.canLive, false);
  assert.equal(report.laneHandlerPilot.runtimeAuthority, "none");
  assert.equal(report.laneHandlerPilot.allowedToExecuteLive, false);
  assert.equal(report.laneHandlerPilot.safety.signerCalled, false);
  assert.equal(report.laneHandlerPilot.safety.runtimeStateMutated, false);
  assert.equal(report.laneHandlerPilot.safety.liveQueueEnqueued, false);
  assert.equal(report.capitalIntentOrchestrator.reportOnly, true);
  assert.equal(report.capitalIntentOrchestrator.canLive, false);
  assert.equal(report.capitalIntentOrchestrator.runtimeAuthority, "none");
  assert.deepEqual(report.capitalIntentTable, report.capitalIntentOrchestrator.rows);
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
            native: [
              {
                chain: "optimism",
                actual: "309857193986883921",
                actualDecimal: 0.3098571939868839,
                estimatedUsd: 710.6915587002568,
                ticker: "ETH",
                status: "over_max_active",
                staleFallback: false,
                scanError: null,
              },
            ],
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
  // The capitalAudit issue carrying `result: "no_receipt"` is the only authoritative
  // reconciliation signal here. The signerAuditRecord has a txHash but no `result` or
  // `reconciliationStatus` field, so it must not be double-counted as unreconciled:
  // the prior `broadcast.txHash && !receipt` heuristic created a join bug because
  // signer-audit records by schema never carry inline receipts.
  assert.equal(pendle.unreconciledBroadcastCount, 1);
  assert.equal(pendle.unreconciledBySource.issueRecord, 1);
  assert.equal(pendle.unreconciledBySource.signerAuditRecord, 0);
  assert.equal(pendle.unreconciledBySource.transactionNoReceipt, 0);
  assert.equal(pendle.unreconciledBySource.broadcastBucketNoReceipt, 0);
  assert.equal(pendle.policyEligibleCandidateCount, 0);
  assert.equal(pendle.selectedAction, "reconcile_receipt");
  assert.equal(pendle.firstBlockingReason, "NO_RECEIPT_RECONCILIATION");
});

test("selector promotes Pendle direct YT candidate with live Base USDC entry inventory into policy attempt", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: {
        summary: {
          queueCount: 1,
          byStrategy: { "pendle-yt-canary": 1 },
          pendleYtCount: 1,
          pendleYtCanaryReadyCount: 1,
        },
        queue: [
          {
            queueId: "merkl:pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
            opportunityId: "pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
            chain: "base",
            protocolId: "pendle",
            protocolName: "Pendle",
            name: "apxUSD",
            family: "stable_fixed_yield",
            entryAssets: ["apxUSD"],
            mappedStrategyId: "pendle-yt-canary",
            executionSurface: "fixedYield",
            campaignRemainingHours: 817.79,
            aprPct: 15.94393987912397,
            nativeAprPct: 15.94393987912397,
            capabilityGaps: ["current_inventory_entry_route_required"],
            protocolBindingPlan: {
              status: "binding_ready",
              protocolId: "pendle",
              bindingKind: "pendle_yt_buy_sell_redeem",
              resolvedBinding: {
                marketAddress: "0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
                ytTokenAddress: "0xf90c9350ed4a91121167ad40a79ec5852c6018e2",
                assetAddress: "0xd993935e13851dd7517af10687ec7e5022127228",
                assetSymbol: "apxUSD",
                assetDecimals: 18,
                shareTokenAddress: "0x25cb814c094b3ee4b19bfcab4c190c53d7890635",
                maturity: "2026-06-18T00:00:00.000Z",
                ytExpiry: "2026-06-18T00:00:00.000Z",
                impliedAprPct: 15.94393987912397,
                entryTokenAddresses: [
                  "0xd993935e13851dd7517af10687ec7e5022127228",
                  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                ],
                exitQuote: {
                  source: "pendle_fair_value_model",
                  outputUsd: 10,
                  depthUsd: 10000,
                  slippageBps: 5,
                  costUsd: 0.305,
                },
              },
            },
            pendleYt: {
              family: "pendle_yt",
              ev: {
                policyProfile: "pendle_yt_tiny_canary_ev_v2",
                status: "positive_ev",
                canaryReady: true,
                blockers: [],
                notionalUsd: 10,
                maturity: "2026-06-18T00:00:00.000Z",
                maturityHours: 817.79,
                holdDays: 33.07,
                aprPct: 15.94393987912397,
                rewardHaircutPct: 0,
                hasRewardToken: false,
                effectiveAprPct: 15.94393987912397,
                grossYieldUsd: 0.1444772077685413,
                entryCostUsd: 0.01,
                exitCostUsd: 0.01,
                gasCostUsd: 0.05,
                chainCostProfile: "base",
                expectedNetUsd: 0.0744772077685413,
                exitQuote: {
                  outputUsd: 10,
                  depthUsd: 10000,
                  slippageBps: 5,
                  source: "pendle_fair_value_model",
                },
              },
            },
            executionReadiness: {
              status: "inventory_unknown",
              reasons: ["inventory_snapshot_missing"],
              executorSupported: true,
              matchedToken: null,
            },
            autoEntry: {
              status: "blocked",
              blockers: ["inventory_unknown"],
            },
          },
        ],
      },
      campaignAware: { candidates: [] },
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
    }),
  );

  const selected = report.selection.selectedCandidate;
  assert.ok(selected);
  assert.equal(selected.source, "pendle");
  assert.equal(selected.strategyId, "pendle-yt-canary");
  assert.equal(selected.opportunityId, "pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e");
  assert.equal(selected.asset, "USDC");
  assert.equal(selected.expectedRealizedNetUsd, 0.074477);
  assert.equal(selected.routeRefillBinding.ready, true);
  assert.equal(selected.metadata.inventoryProof.asset, "USDC");
  assert.equal(selected.metadata.inventoryProof.token, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(selected.signerIntentAvailability.ready, true);
  assert.equal(selected.signerIntentAvailability.intentType, "pendle_yt_entry");
  assert.equal(selected.signerIntentAvailability.builder, "pendle_direct_canary");
  assert.equal(selected.blockers.includes("inventory_unknown"), false);
  assert.equal(selected.blockers.includes("live_inventory_entry_asset_not_found"), false);
  assert.equal(selected.blockers.includes("current_inventory_entry_route_required"), false);
  assert.equal(report.selection.status, "POLICY_ATTEMPTED");

  const pendleFamily = report.familyCoverage.find((row) => row.family === "pendle");
  assert.ok(pendleFamily);
  assert.equal(pendleFamily.policyEligibleCandidateCount, 1);
  assert.equal(pendleFamily.signerIntentReadyCount, 1);
  assert.equal(pendleFamily.firstBlockingReason, null);
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

test("selector uses vault underlying whitelist and exact live inventory blocker for Morpho vault shares", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: {
        summary: { queueCount: 1 },
        queue: [
          {
            queueId: "merkl:17563083078147412604",
            opportunityId: "17563083078147412604",
            chain: "optimism",
            protocolId: "morpho",
            family: "stable_treasury_carry",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            executionSurface: "stableCarry",
            entryAssets: ["gtusdcp", "USDC"],
            campaignRemainingHours: 146.72774777777778,
            aprPct: 1.882047751598493,
            protocolBindingPlan: {
              status: "binding_ready",
              bindingKind: "erc4626_vault_supply_withdraw",
              resolvedBinding: {
                vaultAddress: "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59",
                assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
                assetSymbol: "USDC",
                assetDecimals: 6,
                shareTokenAddress: "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59",
                shareTokenSymbol: "gtusdcp",
              },
            },
            executionReadiness: { status: "inventory_unknown", executorSupported: true },
            autoEntry: { status: "blocked", blockers: ["inventory_unknown", "entry_asset_not_whitelisted"] },
          },
        ],
      },
      merklOpportunities: {
        opportunities: [
          {
            opportunityId: "17563083078147412604",
            chain: "optimism",
            protocolId: "morpho",
            rewardTokenSymbols: ["OP"],
            rewardTokenTypes: ["TOKEN"],
            type: "MORPHOVAULT",
            action: "LEND",
            nativeAprPct: 2.365440949606957,
            protocolBinding: {
              vaultAddress: "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59",
              assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
              assetSymbol: "USDC",
            },
          },
        ],
      },
      campaignAware: {
        candidates: [
          {
            opportunityId: "17563083078147412604",
            chain: "optimism",
            protocol: "morpho",
            displayedApr: 1.882047751598493,
            nativeAprPct: 2.365440949606957,
            rewardToken: null,
            rewardTokenHaircut: 0,
            rewardExitLiquidityStatus: {
              ready: true,
              status: "native_or_share_price_yield_no_reward_exit_required_for_candidate_report",
            },
            expectedHoldDays: 6.113656157407408,
            operatorPositionUsd: 35,
            operatorExpectedGrossProfitUsd: 0.011033335585707432,
            estimatedGasClaimSwapBridgeCostUsd: 0.003,
            expectedNetProfitUsd: 0.008033335585707432,
            tinyCanaryEvStatus: {
              ready: true,
              currentAmountUsd: 35,
              neededUsd: 19.033228742904705,
              holdDays: 6.113656157407408,
              roundTripCostUsd: 0.003,
            },
            blockers: [],
          },
        ],
      },
      capitalManagerRefill: {
        capitalPlan: {
          inventory: {
            native: [
              {
                chain: "optimism",
                actual: "309857193986883921",
                actualDecimal: 0.3098571939868839,
                estimatedUsd: 710.6915587002568,
                ticker: "ETH",
                status: "over_max_active",
                staleFallback: false,
                scanError: null,
              },
            ],
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
      policyEvaluator: async () => {
        throw new Error("inventory shortfall candidate should not reach policy");
      },
    }),
  );

  const candidate = report.candidates.find(
    (item) => item.source === "merkl" && item.opportunityId === "17563083078147412604",
  );
  assert.ok(candidate);
  assert.equal(candidate.asset, "USDC");
  assert.equal(candidate.rewardHaircut, 0);
  assert.equal(candidate.notionalUsd, 20);
  assert.ok(candidate.expectedRealizedNetUsd < 0);
  assert.equal(candidate.blockers.includes("entry_asset_not_whitelisted"), false);
  assert.equal(candidate.blockers.includes("reward_exit_liquidity_unproven"), false);
  assert.equal(candidate.blockers.includes("inventory_unknown"), false);
  assert.equal(candidate.blockers.includes("live_inventory_below_required_notional"), false);
  assert.ok(candidate.blockers.includes("same_tick_refill_expected_net_non_positive"));
  assert.equal(candidate.blockers.includes("tiny_canary_resize_above_cap:need_$39_cap_$25"), false);
  assert.equal(candidate.routeRefillBinding.status, "same_tick_refill_ready");
  assert.equal(candidate.routeRefillBinding.sameTickRefill.asset, "USDC");
  assert.equal(candidate.routeRefillBinding.sameTickRefill.selectedMethod, "same_chain_native_to_token_swap");
  assert.ok(candidate.routeRefillBinding.sameTickRefill.expectedExecutionRefillCostUsd > 0.04);
  assert.equal(candidate.signerIntentAvailability.reason, "same_tick_refill_expected_net_non_positive");
});

test("selector covers aggressive_velocity family with canonical NO_TRADE evidence", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      aggressiveStatus: {
        schemaVersion: 1,
        strategyId: "aggressive-velocity-v1",
        status: "analysis_only",
        reason: "no_high_yield_candidates_selected",
        liveCapable: true,
        currentLiveEligible: false,
        autoExecute: true,
        executorBound: true,
        liveAdmissionBlockers: ["no_high_yield_candidates_selected"],
        selectedCount: 0,
        candidateLadder: {
          rawCandidateCount: 400,
          credibleExitCount: 7,
          velocityCandidateCount: 0,
          selectedCount: 0,
          bottleneckStage: "velocity",
        },
        bottleneckStage: "velocity",
        totalQualified: 0,
        totalExpectedNetBtcProfit: 0,
        projectedNetUsd: null,
      },
      policyEvaluator: async () => ({
        decision: "BLOCK",
        blockers: ["aggressive_no_executable_candidate"],
        effectiveIntent: {},
        results: [],
      }),
    }),
  );

  const family = report.familyCoverage.find((row) => row.family === "aggressive");
  assert.ok(family, "aggressive family row must exist");
  assert.equal(family.discoveredCandidateCount, 1);
  assert.equal(family.policyEligibleCandidateCount, 0);
  assert.equal(family.evPositiveCandidateCount, 0);
  assert.ok(family.firstBlockingReason);

  const candidate = report.candidates.find((row) => row.source === "aggressive_velocity");
  assert.ok(candidate);
  assert.equal(candidate.strategyId, "aggressive-velocity-v1");
  assert.equal(candidate.metadata.bottleneckStage, "velocity");
  assert.equal(candidate.metadata.rawCandidateCount, 400);
  assert.equal(candidate.metadata.credibleExitCount, 7);
  assert.ok(candidate.blockers.includes("no_high_yield_candidates_selected"));
});

test("selector aggressive_velocity family promotes executable candidate when live eligible", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      aggressiveStatus: {
        schemaVersion: 1,
        strategyId: "aggressive-velocity-v1",
        status: "candidate_for_validation",
        reason: "executable_candidate_available",
        liveCapable: true,
        currentLiveEligible: true,
        autoExecute: true,
        executorBound: true,
        liveAdmissionBlockers: [],
        selectedCount: 1,
        candidateLadder: {
          rawCandidateCount: 400,
          credibleExitCount: 20,
          velocityCandidateCount: 5,
          selectedCount: 1,
          bottleneckStage: null,
        },
        totalQualified: 1,
        totalExpectedNetBtcProfit: 0.00012,
        projectedNetUsd: 10,
        executableCandidate: {
          opportunityId: "aggressive:base:morpho:1",
          chain: "base",
          protocol: "morpho",
          assetSymbol: "USDC",
          bindingKind: "erc4626_vault_supply_withdraw",
          amountUsd: 25,
          expectedNetBtcProfit: 0.00012,
        },
      },
    }),
  );

  const family = report.familyCoverage.find((row) => row.family === "aggressive");
  assert.ok(family);
  assert.equal(family.discoveredCandidateCount, 1);

  const candidate = report.candidates.find((row) => row.source === "aggressive_velocity");
  assert.ok(candidate);
  assert.equal(candidate.executorBinding.status, "ready");
  assert.equal(candidate.routeRefillBinding.status, "ready");
  assert.equal(candidate.notionalUsd, 25);
  assert.equal(candidate.expectedRealizedNetUsd, 10);
});

test("selector surfaces claim/harvest summary from merkl user rewards", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklUserRewards: {
        observedAt: NOW,
        totalClaimableUsd: 0.33,
        totalPendingUsd: 0.0002,
        claimPlan: {
          status: "blocked",
          readyChainCount: 0,
          blockedChainCount: 3,
          totalReadyClaimableUsd: 0,
          chains: [
            {
              chainId: 8453,
              chainName: "Base",
              status: "blocked",
              claimableUsd: 0.28,
              pendingUsd: 0.0002,
              rewardCount: 2,
              blockers: ["claimable_below_min_usd", "distributor_address_missing"],
            },
            {
              chainId: 1,
              chainName: "Ethereum",
              status: "blocked",
              claimableUsd: 0.05,
              pendingUsd: 0,
              rewardCount: 3,
              blockers: ["claim_cost_exceeds_claimable"],
            },
          ],
        },
      },
    }),
  );

  assert.ok(report.claimHarvestSummary);
  assert.equal(report.claimHarvestSummary.status, "blocked");
  assert.equal(report.claimHarvestSummary.readyChainCount, 0);
  assert.equal(report.claimHarvestSummary.blockedChainCount, 3);
  assert.equal(report.claimHarvestSummary.chains.length, 2);
  assert.ok(report.claimHarvestSummary.topBlocker);
  assert.ok(report.claimHarvestSummary.blockers.includes("claimable_below_min_usd"));
});

test("selector surfaces payback attribution summary from payback status", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      paybackStatus: {
        observedAt: NOW,
        decision: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          snapshot: {
            grossProfitSats_period: 595,
            paidBackSats_lifetime: 0,
            profitSatsProvenance: {
              period: { directSats: 320, projectedSats: 275, totalSats: 595 },
            },
          },
        },
        payback: {
          accumulatorPendingSats: 595,
        },
        runway: {
          status: "profit_creation_required",
          current: {
            minPaybackSats: 5000,
            satsToMinimumPayback: 4881,
            progressToMinimumRatio: 0.0238,
          },
        },
      },
    }),
  );

  assert.ok(report.paybackAttributionSummary);
  assert.equal(report.paybackAttributionSummary.decisionStatus, "carry");
  assert.equal(report.paybackAttributionSummary.decisionReason, "planned_payback_below_minimum");
  assert.equal(report.paybackAttributionSummary.grossProfitSatsPeriod, 595);
  assert.equal(report.paybackAttributionSummary.accumulatorPendingSats, 595);
  assert.equal(report.paybackAttributionSummary.minPaybackSats, 5000);
  assert.equal(report.paybackAttributionSummary.runwayStatus, "profit_creation_required");
  assert.ok(report.paybackAttributionSummary.profitSatsProvenance);
});

// Position-mark classifier safety tests. These guard against the regex-over-JSON
// pollution that previously bled YO/Morpho NAV-sleeve marks into merkl claim economics,
// USDC vault marks into stable_carry, and inflated pendle YT valueUsd by poll count.

test("position marks with merkl: positionId prefix but gateway/YO strategyId do not pollute merkl family", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      merklUserRewards: null,
      protocolPositionMarks: [
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "merkl:base:13747891056392346282:0xa50505dd06e52687bd20e1eea350553cdea24f72f62ff3787080254ab0ddbc33", // pragma: allowlist secret
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "morpho",
          status: "open",
          assetSymbol: "USDC",
          valueUsd: 45.78,
        },
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "merkl:base:13747891056392346282:0x1e16bb07abe93231403b105f37ae1231bc48ad12458389942b3b7644ddd2807d", // pragma: allowlist secret
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "yo",
          status: "open",
          assetSymbol: "yoUSD",
          valueUsd: 0,
        },
      ],
    }),
  );

  const merkl = report.familyCoverage.find((row) => row.family === "merkl");
  assert.ok(merkl);
  // YO/Morpho NAV-sleeve marks must NOT inflate merkl active count or value, even
  // though their positionId carries a "merkl:" prefix (Merkl is only the discovery
  // surface; the underlying bound position is a Morpho/YO vault share).
  assert.equal(merkl.activePositionCount, 0);
  assert.equal(merkl.activeActionEconomics.totalActiveValueUsd, 0);
  assert.equal(merkl.activeActionEconomics.markedHealthyCount, 0);

  const ambiguous = report.familyCoverage.find((row) => row.family === "ambiguous_position_family");
  assert.ok(ambiguous, "ambiguous_position_family row must exist");
  assert.equal(ambiguous.activePositionCount, 2);
  assert.equal(ambiguous.activeActionEconomics.markedHealthyCount, 2);
});

test("USDC vault position marks under gateway sleeve do not bleed into stable_carry or pendle", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      protocolPositionMarks: [
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "protocol:base:morpho:9836065204209028807:erc4626_vault_supply_withdraw:0xc1256ae5ff1cf2719d4937adb3bbccab2e00a2ca",
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "morpho",
          status: "open",
          assetSymbol: "USDC",
          valueUsd: 80.01,
        },
      ],
    }),
  );

  const stable = report.familyCoverage.find((row) => row.family === "stable_carry");
  const pendle = report.familyCoverage.find((row) => row.family === "pendle");
  const ambiguous = report.familyCoverage.find((row) => row.family === "ambiguous_position_family");

  // Asset-symbol regex like /usdc|usdt|dai/ used to bleed every USDC mark into
  // stable_carry; the strict strategyId-driven classifier must keep stable_carry clean.
  assert.equal(stable.activePositionCount, 0);
  assert.equal(stable.activeActionEconomics.totalActiveValueUsd, 0);
  assert.equal(pendle.activePositionCount, 0);
  assert.equal(ambiguous.activePositionCount, 1);
  assert.equal(ambiguous.activeActionEconomics.totalActiveValueUsd, 80.01);
});

test("open-position blockers from non-btc candidates do not govern btc wrapper family without active btc position", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      campaignAware: { candidates: [] },
      strategyCatalog: { btcFamilies: [] },
      allocatorCore: { candidates: [] },
      defiLlamaPools: [],
      merklQueue: {
        summary: { queueCount: 1 },
        queue: [
          {
            queueId: "merkl:pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
            opportunityId: "pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
            chain: "base",
            protocolId: "pendle",
            pendleYt: { ev: { canaryReady: false } },
            mappedStrategyId: "pendle-yt-canary",
            executionSurface: "fixedYield",
            notionalUsd: 10,
            expectedRealizedNetUsd: 0.04,
            protocolBindingPlan: {
              status: "binding_ready",
              bindingKind: "pendle_yt_buy_sell_redeem",
              resolvedBinding: {
                marketAddress: "0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
                entryTokenSymbols: ["cbBTC", "wBTC"],
                entryTokenAddresses: [
                  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
                  "0x4200000000000000000000000000000000000006",
                ],
              },
            },
            executionReadiness: {
              status: "open_position_active",
              openPosition: {
                positionId:
                  "protocol:base:pendle:pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e:pendle_market_swap:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
                observedAt: "2026-05-19T05:00:00.000Z",
              },
            },
            autoEntry: { status: "blocked", blockers: ["open_position_active"] },
          },
        ],
      },
      policyEvaluator: async () => {
        throw new Error("open-position duplicate entry blocker must not reach policy");
      },
    }),
  );

  const btcWrapper = report.familyCoverage.find((row) => row.family === "btc_wrapper_lending");
  assert.ok(btcWrapper);
  assert.equal(btcWrapper.activePositionCount, 0);
  assert.notEqual(btcWrapper.firstBlockingReason, "open_position_active");

  const btcWrapperAction = report.familyActionTable.find((row) => row.family === "btc_wrapper_lending");
  assert.ok(btcWrapperAction);
  assert.notEqual(btcWrapperAction.reason, "open_position_active");
});

test("open Merkl queue positions surface hold noop instead of missing active-position producer", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      campaignAware: { candidates: [] },
      strategyCatalog: { btcFamilies: [] },
      allocatorCore: { candidates: [] },
      defiLlamaPools: [],
      merklQueue: {
        summary: { queueCount: 1 },
        queue: [
          {
            queueId: "merkl:stable-open",
            opportunityId: "stable-open",
            chain: "base",
            protocolId: "aave",
            executionSurface: "stableCarry",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            executionReadiness: {
              status: "open_position_active",
              openPosition: {
                positionId: "merkl:base:stable-open",
                observedAt: "2026-05-21T00:00:00.000Z",
              },
            },
            autoEntry: { status: "blocked", blockers: ["open_position_active"] },
          },
        ],
      },
    }),
  );

  const stable = report.familyCoverage.find((row) => row.family === "stable_carry");
  assert.ok(stable);
  assert.equal(stable.activePositionCount, 1);
  assert.equal(stable.firstBlockingReason, "HOLD_NOOP");

  const stableAction = report.familyActionTable.find((row) => row.family === "stable_carry");
  assert.ok(stableAction);
  assert.equal(stableAction.actionClass, "TRUE_HOLD_NOOP");
  assert.equal(stableAction.reason, "all_active_positions_hold_noop");
});

test("capless advisory btc wrapper templates do not govern family when no live-sized intent exists", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      strategyCatalog: { btcFamilies: [] },
      allocatorCore: {
        candidates: [
          {
            id: "avalanche:wrapped_btc_lending",
            chain: "avalanche",
            protocols: ["benqi"],
            assetFamily: "btc_wrappers",
            blockers: [],
          },
        ],
      },
      defiLlamaPools: [],
      policyEvaluator: async () => {
        throw new Error("advisory capless template must not reach policy");
      },
    }),
  );

  const btcWrapper = report.familyCoverage.find((row) => row.family === "btc_wrapper_lending");
  assert.ok(btcWrapper.discoveredCandidateCount >= 1);
  assert.equal(btcWrapper.evPositiveCandidateCount, 0);
  assert.equal(btcWrapper.firstBlockingReason, "NO_POLICY_ELIGIBLE_TRADE");

  const btcWrapperAction = report.familyActionTable.find((row) => row.family === "btc_wrapper_lending");
  assert.equal(btcWrapperAction.actionClass, "TRUE_NO_TRADE_ECONOMICS");
  assert.equal(btcWrapperAction.reason, "NO_POLICY_ELIGIBLE_TRADE");
});

test("capless live-sized btc wrapper intent still surfaces strategy caps blocker", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      strategyCatalog: { btcFamilies: [] },
      allocatorCore: {
        candidates: [
          {
            id: "avalanche:wrapped_btc_lending",
            chain: "avalanche",
            protocols: ["benqi"],
            assetFamily: "btc_wrappers",
            blockers: [],
            notionalUsd: 5,
            expectedRealizedNetUsd: 0.05,
          },
        ],
      },
      defiLlamaPools: [],
    }),
  );

  const btcWrapper = report.familyCoverage.find((row) => row.family === "btc_wrapper_lending");
  assert.ok(btcWrapper.evPositiveCandidateCount >= 1);
  assert.equal(btcWrapper.firstBlockingReason, "strategy_caps_missing");

  const btcWrapperAction = report.familyActionTable.find((row) => row.family === "btc_wrapper_lending");
  assert.equal(btcWrapperAction.actionClass, "BLOCKED_BY_POLICY_SAFETY");
  assert.equal(btcWrapperAction.reason, "strategy_caps_missing");
});

test("repeated pendle YT marks for the same positionId dedup to one active position", async () => {
  const pendlePositionId =
    "protocol:base:pendle:pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e:pendle_market_swap:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e";
  const repeatedMarks = Array.from({ length: 100 }, (_, index) => ({
    event: "position_marked",
    observedAt: `2026-05-19T0${index < 10 ? "0" : "1"}:00:00.000Z`,
    positionId: pendlePositionId,
    strategyId: "pendle-yt-canary",
    protocolId: "pendle",
    status: "open",
    assetSymbol: "YT",
    // valueUsd identical for the same position; the dedup must keep just one, not sum to 26.8M * 100.
    valueUsd: 26876245.42,
  }));

  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      protocolPositionMarks: repeatedMarks,
    }),
  );

  const pendle = report.familyCoverage.find((row) => row.family === "pendle");
  assert.ok(pendle);
  // Without dedup the raw stream would sum 100 × 26.8M ≈ $2.7B; latest-mark-per-positionId
  // pins the row to exactly one healthy position at its latest valueUsd.
  assert.equal(pendle.activePositionCount, 1);
  assert.equal(pendle.activeActionEconomics.markedHealthyCount, 1);
  assert.equal(pendle.activeActionEconomics.totalActiveValueUsd, 26876245.42);
});

test("merkl claim economics from merklUserRewards do not attach to YO/Morpho NAV-sleeve mark", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      merklUserRewards: {
        claimPlan: {
          chains: [
            {
              chain: "base",
              readyClaimableUsd: 12.5,
              pendingUsd: 0,
              blockingReason: null,
              distributorAddress: "0xMerklDistributor",
              minThresholdUsd: 1,
            },
          ],
          readyChainCount: 1,
          blockedChainCount: 0,
          totalReadyClaimableUsd: 12.5,
          totalPendingUsd: 0,
        },
      },
      protocolPositionMarks: [
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "merkl:base:13747891056392346282:0xa50505dd06e52687bd20e1eea350553cdea24f72f62ff3787080254ab0ddbc33", // pragma: allowlist secret
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "morpho",
          status: "open",
          assetSymbol: "USDC",
          valueUsd: 45.78,
        },
      ],
    }),
  );

  const merkl = report.familyCoverage.find((row) => row.family === "merkl");
  const ambiguous = report.familyCoverage.find((row) => row.family === "ambiguous_position_family");

  // The merkl row carries the claim economics (because the claimPlan is the authoritative
  // merkl-reward signal), but its activePositionCount must NOT have been inflated by the
  // YO/Morpho mark that happens to share the "merkl:" prefix.
  assert.equal(merkl.activeActionEconomics.claimReadyUsd, 12.5);
  assert.equal(merkl.activeActionEconomics.claimChainReadyCount, 1);
  assert.equal(merkl.activePositionCount, 0);
  assert.equal(merkl.activeActionEconomics.totalActiveValueUsd, 0);

  // Conversely, the ambiguous family must NOT receive claim economics — those belong to
  // the merkl reward producer alone.
  assert.equal(ambiguous.activePositionCount, 1);
  assert.equal(ambiguous.activeActionEconomics.claimReadyUsd, 0);
});

test("healthy mark with registered bindingKind emits HOLD_NOOP per-position decision", async () => {
  // erc4626_vault_supply_withdraw is registered in protocol-binding-registry; an active
  // healthy mark with that binding gets the concrete HOLD_NOOP verdict instead of the
  // legacy POSITION_HEALTHY_NO_ACTION_PRODUCER catch-all.
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      protocolPositionMarks: [
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "protocol:base:morpho:9836065204209028807:erc4626_vault_supply_withdraw:0xc1256ae5ff1cf2719d4937adb3bbccab2e00a2ca",
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "morpho",
          bindingKind: "erc4626_vault_supply_withdraw",
          status: "open",
          assetSymbol: "USDC",
          valueUsd: 80.01,
        },
      ],
    }),
  );

  const ambiguous = report.familyCoverage.find((row) => row.family === "ambiguous_position_family");
  assert.ok(ambiguous);
  assert.equal(ambiguous.activeActionEconomics.markedHealthyCount, 1);
  assert.equal(ambiguous.activeActionEconomics.perPositionDecisions.length, 1);
  const decision = ambiguous.activeActionEconomics.perPositionDecisions[0];
  assert.equal(decision.actionDecision, "HOLD_NOOP");
  assert.equal(decision.actionReason, "no_claim_harvest_exit_producer_joined");
  assert.equal(decision.bindingKind, "erc4626_vault_supply_withdraw");
  assert.equal(decision.missingBindingKey, null);
  // executableActionPath: supported binding has a resolvable exit producer; legal next
  // action is `hold` with no current dispatch required.
  assert.ok(decision.executableActionPath);
  assert.equal(decision.executableActionPath.action, "hold");
  assert.equal(decision.executableActionPath.bindingKey, "morpho:erc4626_vault_supply_withdraw");
  assert.equal(decision.executableActionPath.producer, "executeErc4626PortfolioExit");
  assert.equal(decision.executableActionPath.dispatchEligibility, "hold_no_action_required");
  assert.equal(decision.executableActionPath.blocker, null);
  assert.equal(ambiguous.activeActionEconomics.topActiveActionReason, "HOLD_NOOP");
  assert.equal(ambiguous.firstBlockingReason, "HOLD_NOOP");
  assert.equal(ambiguous.selectedAction, "hold_or_health_action");
});

test("healthy mark with unregistered bindingKind emits UNSUPPORTED_BINDING with missingBindingKey", async () => {
  // pendle_market_swap is what the live pendle YT mark records, but the registry only
  // registers pendle_yt_buy_sell_redeem. The unsupported binding must be surfaced — never
  // silently folded into HOLD_NOOP or POSITION_HEALTHY_NO_ACTION_PRODUCER.
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      protocolPositionMarks: [
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "protocol:base:pendle:pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e:pendle_market_swap:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
          strategyId: "pendle-yt-canary",
          protocolId: "pendle",
          bindingKind: "pendle_market_swap",
          status: "open",
          assetSymbol: "YT",
          valueUsd: 26898210.97,
        },
      ],
    }),
  );

  const pendle = report.familyCoverage.find((row) => row.family === "pendle");
  assert.ok(pendle);
  const decision = pendle.activeActionEconomics.perPositionDecisions.find(
    (entry) => entry.actionDecision === "UNSUPPORTED_BINDING",
  );
  assert.ok(decision, "expected UNSUPPORTED_BINDING decision for unregistered bindingKind");
  assert.equal(decision.bindingKind, "pendle_market_swap");
  assert.equal(decision.missingBindingKey, "pendle:pendle_market_swap");
  // executableActionPath: unsupported binding has no producer; blocker is the exact
  // missing-registration key, action defaults to `exit` (the legal next on dust).
  assert.ok(decision.executableActionPath);
  assert.equal(decision.executableActionPath.action, "exit");
  assert.equal(decision.executableActionPath.bindingKey, "pendle:pendle_market_swap");
  assert.equal(decision.executableActionPath.producer, null);
  assert.equal(decision.executableActionPath.dispatchEligibility, "unsupported_binding");
  assert.equal(decision.executableActionPath.blocker, "binding_kind_not_registered");
  assert.equal(pendle.activeActionEconomics.topActiveActionReason, "UNSUPPORTED_BINDING");
  assert.equal(pendle.firstBlockingReason, "UNSUPPORTED_BINDING");
});

test("failed position mark emits HEALTH_CHECK_REQUIRED carrying exact failureKind", async () => {
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      protocolPositionMarks: [
        {
          event: "position_mark_failed",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId:
            "merkl:base:13747891056392346282:0x1e16bb07abe93231403b105f37ae1231bc48ad12458389942b3b7644ddd2807d", // pragma: allowlist secret
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "yo",
          bindingKind: "erc4626_vault_supply_withdraw",
          failureKind: "adapter_error",
          status: "open",
          valueUsd: null,
        },
      ],
    }),
  );

  const ambiguous = report.familyCoverage.find((row) => row.family === "ambiguous_position_family");
  assert.ok(ambiguous);
  assert.equal(ambiguous.activeActionEconomics.markFailedCount, 1);
  const decision = ambiguous.activeActionEconomics.perPositionDecisions[0];
  assert.equal(decision.actionDecision, "HEALTH_CHECK_REQUIRED");
  assert.equal(decision.actionReason, "position_mark_failed:adapter_error");
  // executableActionPath: failed mark routes to health_check producer-less path; blocker
  // carries the exact failureKind so consumers can dispatch a recovery probe.
  assert.ok(decision.executableActionPath);
  assert.equal(decision.executableActionPath.action, "health_check");
  assert.equal(decision.executableActionPath.bindingKey, "yo:erc4626_vault_supply_withdraw");
  assert.equal(decision.executableActionPath.producer, null);
  assert.equal(decision.executableActionPath.dispatchEligibility, "position_unhealthy");
  assert.equal(decision.executableActionPath.blocker, "position_mark_failed:adapter_error");
  // HEALTH_CHECK_REQUIRED has the highest priority in POSITION_ACTION_PRIORITY: even
  // if other decisions co-exist on the same row, this one wins as topActiveActionReason.
  assert.equal(ambiguous.activeActionEconomics.topActiveActionReason, "HEALTH_CHECK_REQUIRED");
  assert.equal(ambiguous.firstBlockingReason, "HEALTH_CHECK_REQUIRED");
});

test("topActiveActionReason precedence: HEALTH_CHECK_REQUIRED > UNSUPPORTED_BINDING > HOLD_NOOP", async () => {
  // Mixed-row case: ambiguous family receives one failed mark, one unsupported-binding
  // healthy mark, and one supported-binding healthy mark. The highest-priority code wins.
  const report = await buildAllSourceDeploymentSelectorReport(
    baseInputs({
      merklQueue: { summary: { queueCount: 0 }, queue: [] },
      campaignAware: { candidates: [] },
      protocolPositionMarks: [
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId: "protocol:base:custom:1:custom_binding:0xaaa",
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "custom",
          bindingKind: "made_up_unregistered_binding",
          status: "open",
          valueUsd: 5,
        },
        {
          event: "position_marked",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId: "protocol:base:morpho:2:erc4626_vault_supply_withdraw:0xbbb",
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "morpho",
          bindingKind: "erc4626_vault_supply_withdraw",
          status: "open",
          valueUsd: 5,
        },
        {
          event: "position_mark_failed",
          observedAt: "2026-05-19T05:00:00.000Z",
          positionId: "protocol:base:yo:3:erc4626_vault_supply_withdraw:0xccc",
          strategyId: "gateway_native_asset_conversion_sleeve",
          protocolId: "yo",
          bindingKind: "erc4626_vault_supply_withdraw",
          failureKind: "zero_position_observed",
          status: "open",
          valueUsd: null,
        },
      ],
    }),
  );

  const ambiguous = report.familyCoverage.find((row) => row.family === "ambiguous_position_family");
  assert.ok(ambiguous);
  const codes = ambiguous.activeActionEconomics.perPositionDecisions.map((entry) => entry.actionDecision).sort();
  assert.deepEqual(codes, ["HEALTH_CHECK_REQUIRED", "HOLD_NOOP", "UNSUPPORTED_BINDING"]);
  // HEALTH_CHECK_REQUIRED wins precedence over UNSUPPORTED_BINDING and HOLD_NOOP.
  assert.equal(ambiguous.activeActionEconomics.topActiveActionReason, "HEALTH_CHECK_REQUIRED");
  assert.equal(ambiguous.firstBlockingReason, "HEALTH_CHECK_REQUIRED");
});
