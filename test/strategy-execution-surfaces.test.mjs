import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyExecutionSurfaces } from "../src/strategy/strategy-execution-surfaces.mjs";

function dashboardStatusFixture() {
  return {
    generatedAt: "2026-04-16T03:00:00.000Z",
    overall: {
      liveTrading: "BLOCKED",
    },
    strategy: {
      edgeViability: {
        verdict: { code: "coverage_still_incomplete" },
        measuredNetLoopCount: 0,
        profitableExactCount: 0,
      },
      btcProxySpreads: {
        opportunityCount: 2,
        policyReadyCount: 0,
        overfitAssessment: "coverage_ok",
        bestRebalanceOpportunity: { proxyTicker: "LBTC" },
      },
      crossAssetArbitrage: {
        entryCount: 1,
        exitCount: 1,
        exactAssetPairCount: 0,
        profitableClosedLoopCount: 0,
        bestLoop: null,
        closestLoop: { blockers: ["amount_mismatch"] },
      },
      ethProfitability: {
        gatewayRouteCount: 3,
        routeCount: 3,
        measuredClosedLoopCount: 0,
        profitableClosedLoopCount: 0,
        recommendationCode: "no_multichain_eth_family_surface",
        verdictCode: "no_measured_loops",
      },
      strategyTracks: {
        tracks: [
          { kind: "stable_loop", status: "blocked_loop", reason: "amount_mismatch" },
          { kind: "proxy_spread", status: "blocked_spread", reason: "edge_inside_noise_floor" },
          { kind: "eth_family_loop", status: "unobserved", reason: "no_multichain_eth_family_surface" },
        ],
      },
    },
  };
}

function treasuryInventoryFixture(actual = "33053") {
  return [
    {
      observedAt: "2026-04-25T10:00:00.000Z",
      tokens: [
        {
          chain: "base",
          token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
          ticker: "cbBTC",
          actual,
          actualDecimal: Number(actual) / 100_000_000,
          estimatedUsd: Number(actual) > 0 ? 25.69 : 0,
          priceUsd: 77725,
          status: Number(actual) > 0 ? "below_target" : "refill_required",
        },
      ],
    },
  ];
}

test("execution surfaces classify missing runners separately from runnable observation lanes", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: dashboardStatusFixture(),
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
  });

  const gateway = report.strategies.find((strategy) => strategy.id === "gateway_wrapped_btc_loops");
  const proxy = report.strategies.find((strategy) => strategy.id === "btc_proxy_spreads");
  const stable = report.strategies.find((strategy) => strategy.id === "stablecoin_entry_exit_loops");
  const ethGateway = report.strategies.find((strategy) => strategy.id === "eth_family_gateway");
  const ethMixedStable = report.strategies.find((strategy) => strategy.id === "eth_mixed_stable_loops");
  const btcFlash = report.strategies.find((strategy) => strategy.id === "triangular_flash_btc");

  assert.equal(gateway.capabilityBucket, "dry_run_or_shadow_only");
   assert.equal(gateway.liveCapable, true);
  assert.equal(gateway.selectedMode, "shadow");
  assert.equal(gateway.fallbackReason, "route_specific_executor_inputs_required");
  assert.equal(gateway.liveAdmissionBlockers.includes("route_specific_executor_inputs_required"), true);
  assert.equal(proxy.liveCapable, true);
  assert.equal(proxy.selectedMode, "shadow");
  assert.equal(proxy.fallbackReason, "route_specific_executor_inputs_required");
  assert.equal(proxy.liveAdmissionBlockers.includes("route_specific_executor_inputs_required"), true);
  assert.equal(ethGateway.liveCapable, true);
  assert.equal(ethGateway.selectedMode, "shadow");
  assert.equal(ethGateway.fallbackReason, "multichain_eth_surface_unconfirmed");
  assert.equal(ethGateway.liveAdmissionBlockers.includes("live_trading_blocked"), true);
  assert.equal(ethGateway.liveAdmissionBlockers.includes("multichain_eth_surface_unconfirmed"), true);
  assert.equal(ethGateway.selectedCommands.some((command) => command.script === "executor:gateway-btc-onramp"), true);
  assert.equal(ethGateway.selectedCommands.some((command) => command.script === "executor:gateway-btc-offramp"), true);
  assert.equal(stable.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(stable.fallbackReason, "analysis_probe_only");
  assert.equal(stable.selectedCommands.some((command) => command.script === "report:lane-reclassification"), true);
  assert.equal(ethMixedStable.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(ethMixedStable.selectedCommands.some((command) => command.script === "analyze:ethereum-routes"), true);
  assert.equal(btcFlash.selectedMode, "dry_run");
  assert.equal(btcFlash.currentLiveEligible, false);
  assert.equal(btcFlash.liveAdmissionBlockers.includes("flash_live_admission_blocked"), true);
  assert.equal(report.summary.missingExecutorCount, 0);
});

test("execution surfaces include executor-backed live strategies when artifacts prove readiness", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: { liveTrading: "ALLOWED" },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      wrappedBtcLendingLoopSlice: {
        strategy: {
          id: "wrapped-btc-loop-base-moonwell",
          label: "Wrapped BTC lending loop (Base / Moonwell)",
        },
        bindingSupport: {
          executableFromRepo: true,
        },
        dryRunSummary: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 22,
        },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 1.3552 },
          realized: { valueUsd: 1.3552 },
        },
      },
      phase3StrategyValidation: {
        validations: [
          {
            id: "wrapped_btc_loop_validation",
            overallStatus: "passed",
            oosSplitStatus: "signer_backed_window_recorded",
            shockTestStatus: "live_roundtrip_recorded",
            evidence: {
              liveRoundtripProofStatus: "signer_backed_roundtrip_recorded",
              extendedReceiptContextReady: true,
              realizedNetCarryUsd: 0,
            },
          },
        ],
      },
      treasuryInventoryRecords: treasuryInventoryFixture("33053"),
      merklCanaryQueue: {
        summary: {
          queueCount: 3,
          executableNowCount: 2,
          autoExecutableNowCount: 1,
        },
        queue: [
          {
            opportunityId: "opp-1",
            chain: "base",
            protocolId: "yo",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            queueStatus: "ready_for_tiny_live_canary",
            capabilityGaps: [],
            autoEntry: { autoExecute: true },
            executionReadiness: {
              status: "inventory_ready",
              matchedToken: { estimatedUsd: 150 },
            },
            aprPct: 100,
            protocolBindingPlan: {
              bindingKind: "erc4626_vault_supply_withdraw",
              canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
            },
          },
        ],
      },
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");
  const merkl = report.strategies.find((strategy) => strategy.id === "gateway_native_asset_conversion_sleeve");

  assert.equal(wrapped.currentLiveEligible, true);
  assert.equal(wrapped.selectedMode, "live");
  assert.equal(wrapped.selectedCommands[0].script, "executor:wrapped-btc-loop");
  assert.equal(wrapped.selectedCommands[0].command.includes("--max-loop-iterations=1"), true);
  assert.equal(wrapped.selectedCommands[0].command.includes("--max-intents=14"), true);
  assert.equal(wrapped.selectedCommands[0].command.includes("--market-min-increment-usd=5"), true);
  assert.equal(merkl.currentLiveEligible, true);
  assert.equal(merkl.selectedMode, "live");
  assert.equal(merkl.selectedCommands[0].script, "executor:merkl-canary-autopilot");
  assert.equal(merkl.selectedCommands[0].command.includes("--execute"), true);
  assert.equal(merkl.selectedCommands[0].command.includes("--write"), true);
  assert.equal(report.summary.liveEligibleCount, 2);
});

test("execution surfaces force shadow mode for Stage B even when live evidence is otherwise ready", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "BLOCKED",
        lanePolicy: {
          stage: "B",
          preStageLiveTrading: "ALLOWED",
        },
      },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      wrappedBtcLendingLoopSlice: {
        strategy: {
          id: "wrapped-btc-loop-base-moonwell",
          label: "Wrapped BTC lending loop (Base / Moonwell)",
        },
        bindingSupport: {
          executableFromRepo: true,
        },
        dryRunSummary: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 22,
        },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 1.3552 },
          realized: { valueUsd: 1.3552 },
        },
      },
      phase3StrategyValidation: {
        validations: [
          {
            id: "wrapped_btc_loop_validation",
            overallStatus: "passed",
            oosSplitStatus: "signer_backed_window_recorded",
            shockTestStatus: "live_roundtrip_recorded",
            evidence: {
              liveRoundtripProofStatus: "signer_backed_roundtrip_recorded",
              extendedReceiptContextReady: true,
              realizedNetCarryUsd: 0,
            },
          },
        ],
      },
      treasuryInventoryRecords: treasuryInventoryFixture("33053"),
      merklCanaryQueue: {
        summary: {
          queueCount: 3,
          executableNowCount: 2,
          autoExecutableNowCount: 1,
        },
        queue: [
          {
            opportunityId: "opp-1",
            chain: "base",
            protocolId: "yo",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            queueStatus: "ready_for_tiny_live_canary",
            capabilityGaps: [],
            autoEntry: { autoExecute: true },
            executionReadiness: {
              status: "inventory_ready",
              matchedToken: { estimatedUsd: 150 },
            },
            aprPct: 100,
            protocolBindingPlan: {
              bindingKind: "erc4626_vault_supply_withdraw",
              canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
            },
          },
        ],
      },
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");
  const merkl = report.strategies.find((strategy) => strategy.id === "gateway_native_asset_conversion_sleeve");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.selectedMode, "shadow");
  assert.equal(wrapped.liveAdmissionBlockers.includes("lane_stage_shadow_only"), true);
  assert.equal(merkl.currentLiveEligible, false);
  assert.equal(merkl.selectedMode, "shadow");
  assert.equal(merkl.liveAdmissionBlockers.includes("lane_stage_shadow_only"), true);
});

test("Merkl surface does not mark policy-blocked tiny entries as executable now", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: { liveTrading: "ALLOWED" },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      merklCanaryQueue: {
        summary: {
          queueCount: 1,
          executableNowCount: 1,
          autoExecutableNowCount: 1,
        },
        queue: [
          {
            opportunityId: "opp-too-small",
            chain: "base",
            protocolId: "yo",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            queueStatus: "ready_for_tiny_live_canary",
            capabilityGaps: [],
            autoEntry: { autoExecute: true },
            executionReadiness: {
              status: "inventory_ready",
              matchedToken: { estimatedUsd: 0.25 },
            },
            aprPct: 19.8,
            protocolBindingPlan: {
              bindingKind: "erc4626_vault_supply_withdraw",
              canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
            },
          },
        ],
      },
    },
  });

  const merkl = report.strategies.find((strategy) => strategy.id === "gateway_native_asset_conversion_sleeve");

  assert.equal(merkl.currentLiveEligible, false);
  assert.equal(merkl.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(merkl.selectedMode, "analysis");
  assert.equal(merkl.liveAdmissionBlockers.includes("position_below_min_position_usd"), false);
  assert.equal(merkl.liveAdmissionBlockers.some((item) => item.startsWith("same_chain_unprofitable:")), true);
});

test("wrapped BTC loop stays out of live dispatch when Base cbBTC collateral is unavailable", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: { liveTrading: "ALLOWED" },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      wrappedBtcLendingLoopSlice: {
        strategy: {
          id: "wrapped-btc-loop-base-moonwell",
          label: "Wrapped BTC lending loop (Base / Moonwell)",
        },
        bindingSupport: {
          executableFromRepo: true,
        },
        dryRunSummary: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 22,
        },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 1.3552 },
          realized: { valueUsd: 1.3552 },
        },
      },
      phase3StrategyValidation: {
        validations: [
          {
            id: "wrapped_btc_loop_validation",
            overallStatus: "passed",
            oosSplitStatus: "signer_backed_window_recorded",
            shockTestStatus: "live_roundtrip_recorded",
            evidence: {
              liveRoundtripProofStatus: "signer_backed_roundtrip_recorded",
              extendedReceiptContextReady: true,
              realizedNetCarryUsd: 0,
            },
          },
        ],
      },
      treasuryInventoryRecords: treasuryInventoryFixture("0"),
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.selectedMode, "dry_run");
  assert.equal(wrapped.fallbackReason, "base_cbbtc_collateral_unavailable");
  assert.equal(wrapped.liveAdmissionBlockers.includes("base_cbbtc_collateral_unavailable"), true);
  assert.equal(wrapped.evidence.baseCbBtcCollateralUnits, "0");
});

test("wrapped BTC loop live dispatch cools down after a fresh signer-backed proof", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-01T13:05:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: { liveTrading: "ALLOWED" },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      wrappedBtcLendingLoopSlice: {
        strategy: {
          id: "wrapped-btc-loop-base-moonwell",
          label: "Wrapped BTC lending loop (Base / Moonwell)",
        },
        bindingSupport: {
          executableFromRepo: true,
        },
        dryRunSummary: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 22,
        },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 1.3552 },
          realized: { valueUsd: 0 },
        },
      },
      phase3StrategyValidation: {
        validations: [
          {
            id: "wrapped_btc_loop_validation",
            overallStatus: "passed",
            oosSplitStatus: "signer_backed_window_recorded",
            shockTestStatus: "live_roundtrip_recorded",
            evidence: {
              liveRoundtripProofStatus: "signer_backed_roundtrip_recorded",
              extendedReceiptContextReady: true,
              realizedNetCarryUsd: 0,
            },
          },
        ],
      },
      treasuryInventoryRecords: treasuryInventoryFixture("33053"),
      wrappedBtcLoopLiveProof: {
        observedAt: "2026-05-01T12:58:59.137Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        success: true,
        proofStatus: "signer_backed_roundtrip_recorded",
        proofKind: "signer_backed_roundtrip",
      },
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.selectedMode, "dry_run");
  assert.equal(wrapped.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(wrapped.fallbackReason, "fresh_roundtrip_proof_recorded");
  assert.equal(wrapped.liveAdmissionBlockers.includes("fresh_roundtrip_proof_recorded"), true);
  assert.equal(wrapped.evidence.liveRunControl.blocked, true);
  assert.equal(wrapped.evidence.liveRunControl.reason, "fresh_roundtrip_proof_recorded");
});

test("wrapped BTC loop live dispatch cools down after recent signer activity even before proof finalizes", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-01T13:05:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: { liveTrading: "ALLOWED" },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      wrappedBtcLendingLoopSlice: {
        strategy: {
          id: "wrapped-btc-loop-base-moonwell",
          label: "Wrapped BTC lending loop (Base / Moonwell)",
        },
        bindingSupport: {
          executableFromRepo: true,
        },
        dryRunSummary: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 22,
        },
      },
      phase3StrategyValidation: {
        validations: [
          {
            id: "wrapped_btc_loop_validation",
            overallStatus: "passed",
            evidence: {
              liveRoundtripProofStatus: "signer_backed_roundtrip_recorded",
              extendedReceiptContextReady: true,
            },
          },
        ],
      },
      treasuryInventoryRecords: treasuryInventoryFixture("33053"),
      signerAuditRecords: [
        {
          timestamp: "2026-05-01T13:02:00.000Z",
          strategyId: "wrapped-btc-loop-base-moonwell",
          chain: "base",
          lifecycle: { stage: "confirmed", txHash: "0xabc" },
          broadcast: { txHash: "0xabc" },
          policyVerdict: "approved",
        },
      ],
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.fallbackReason, "recent_live_transaction_cooldown");
  assert.equal(wrapped.liveAdmissionBlockers.includes("recent_live_transaction_cooldown"), true);
  assert.equal(wrapped.evidence.liveRunControl.recentTxCount, 1);
});
