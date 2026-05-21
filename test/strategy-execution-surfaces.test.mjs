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
      gatewayGoldReadiness: {
        routeAvailable: true,
        bestGoldAsset: "XAUT",
        blocker: "gateway_gold_exit_quote_preflight_failed",
        blockers: ["gateway_gold_exit_quote_preflight_failed"],
        liveEligible: false,
        preflight: {
          attempted: true,
          successfulAttemptCount: 0,
        },
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

function wrappedBtcLoopExpectedNetPolicy(expectedNetUsd = 6.5, receiptHistory = null) {
  return {
    liveExecutionPolicy: {
      expectedNetReady: true,
      expectedNetUsd,
      ...(receiptHistory ? { receiptHistory } : {}),
    },
  };
}

function wrappedBtcLoopReceiptHistoryFixture(
  actualKnownCostUsd = 0.035,
  count = 12,
  baseObservedAt = "2026-05-10T00:00:00.000Z",
) {
  const baseMs = new Date(baseObservedAt).getTime();
  const receiptRecords = Array.from({ length: count }, (_unused, index) => ({
    observedAt: new Date(baseMs - index * 60_000).toISOString(),
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    intentType: "wrapped_btc_loop_entry",
    realized: {
      actualKnownCostUsd,
      realizedNetPnlUsd: 0,
    },
    metadata: {
      source: "wrapped_btc_loop_signer_backed_receipt",
    },
  }));
  return { receiptRecords, auditRecords: [] };
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
  const gold = report.strategies.find((strategy) => strategy.id === "tokenized_gold_rotation");
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
  assert.equal(
    ethGateway.selectedCommands.some((command) => command.script === "executor:gateway-btc-onramp"),
    true,
  );
  assert.equal(
    ethGateway.selectedCommands.some((command) => command.script === "executor:gateway-btc-offramp"),
    true,
  );
  assert.equal(stable.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(stable.fallbackReason, "analysis_probe_only");
  assert.equal(
    stable.selectedCommands.some((command) => command.script === "report:lane-reclassification"),
    true,
  );
  assert.equal(gold.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(gold.liveCapable, true);
  assert.equal(gold.selectedMode, "analysis");
  assert.equal(gold.fallbackReason, "gateway_gold_exit_quote_preflight_failed");
  assert.equal(gold.liveAdmissionBlockers.includes("gateway_gold_exit_quote_preflight_failed"), true);
  assert.equal(
    gold.selectedCommands.some((command) => command.script === "report:gateway-gold-readiness"),
    true,
  );
  assert.equal(ethMixedStable.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(
    ethMixedStable.selectedCommands.some((command) => command.script === "analyze:ethereum-routes"),
    true,
  );
  assert.equal(btcFlash.selectedMode, "dry_run");
  assert.equal(btcFlash.currentLiveEligible, false);
  assert.equal(btcFlash.liveAdmissionBlockers.includes("flash_live_admission_blocked"), true);
  assert.equal(report.summary.missingExecutorCount, 0);
});

test("execution surfaces mark admission fields as reporting-only advice", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: dashboardStatusFixture(),
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
  });

  const gateway = report.strategies.find((strategy) => strategy.id === "gateway_wrapped_btc_loops");
  assert.equal(gateway.reportingOnly, true);
  assert.equal(gateway.runtimeGateAuthority, "policy_engine_only");
  assert.equal(gateway.adviceAuthority, "commit_time_guard");
  assert.equal(gateway.adviceCode, "live_trading_blocked");
  assert.deepEqual(gateway.adviceFields, ["liveAdmissionBlockers", "fallbackReason", "currentLiveEligible"]);
  assert.ok(["phase3_evidence_file", "slice_summary", "treasury_inventory"].includes(gateway.adviceSource));
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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

test("execution surfaces keep generic Merkl id stable when Pendle is the top ready canary", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: dashboardStatusFixture(),
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      merklCanaryQueue: {
        summary: {
          queueCount: 1,
          executableNowCount: 0,
          autoExecutableNowCount: 1,
          topExecutableOpportunityId: "pendle-direct:8453:market",
        },
        queue: [
          {
            opportunityId: "pendle-direct:8453:market",
            chain: "base",
            protocolId: "pendle",
            mappedStrategyId: "pendle-yt-canary",
            queueStatus: "ready_for_tiny_live_canary",
            capabilityGaps: [],
            autoEntry: { autoExecute: true },
            executionReadiness: {
              status: "inventory_ready",
              matchedToken: { estimatedUsd: 25262.222885, actual: "25262222885" },
            },
            aprPct: 15.94,
            expectedHoldDays: 30,
            protocolBindingPlan: {
              bindingKind: "pendle_yt_buy_sell_redeem",
              canaryActions: ["buy_yt", "sell_yt", "redeem"],
            },
          },
        ],
      },
      liveTreasuryInventorySnapshot: {
        observedAt: "2026-05-14T22:39:43.796Z",
        tokens: [
          {
            chain: "base",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            actual: "25262222885",
            actualDecimal: 25262.222885,
            estimatedUsd: 25262.222885,
            priceUsd: 1,
            status: "over_max_active",
          },
        ],
      },
    },
  });

  const genericMerkl = report.strategies.find((strategy) => strategy.label === "Merkl tiny live canary autopilot");
  const pendle = report.strategies.find((strategy) => strategy.label === "Pendle YT canary autopilot");

  assert.equal(genericMerkl.id, "gateway_native_asset_conversion_sleeve");
  assert.equal(pendle.id, "pendle-yt-canary");
});

test("execution surfaces promote Pendle YT canary to live when live treasury inventory proves entry-token funding", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          stage: "C",
          policyLiveTrading: "ALLOWED",
        },
      },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      merklCanaryQueue: {
        summary: {
          queueCount: 1,
          executableNowCount: 0,
          autoExecutableNowCount: 0,
          pendleYtCount: 1,
          pendleYtCanaryReadyCount: 1,
          topBlockingReason: "inventory_unknown",
        },
        queue: [
          {
            opportunityId: "pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
            chain: "base",
            protocolId: "pendle",
            mappedStrategyId: "pendle-yt-canary",
            priorityScore: 70,
            entryAssets: ["apxUSD"],
            queueStatus: "queued_for_tiny_live_canary_preflight",
            capabilityGaps: ["current_inventory_entry_route_required"],
            autoEntry: { autoExecute: false },
            executionReadiness: {
              status: "inventory_unknown",
              executorSupported: true,
              matchedToken: null,
              matchedNative: {
                asset: "ETH",
                actual: "1000000000000000",
                estimatedUsd: 2,
              },
              reasons: ["inventory_snapshot_missing"],
            },
            aprPct: 15.94393987912397,
            pendleYt: {
              ev: {
                canaryReady: true,
                expectedNetUsd: 0.07445,
              },
            },
            protocolBindingPlan: {
              status: "binding_ready",
              bindingKind: "pendle_yt_buy_sell_redeem",
              canaryActions: ["enter_fixed_yield_token", "exit_fixed_yield_token"],
              resolvedBinding: {
                assetAddress: "0xd993935e13851dd7517af10687ec7e5022127228",
                entryTokenAddresses: [
                  "0xd993935e13851dd7517af10687ec7e5022127228",
                  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                ],
              },
            },
          },
        ],
      },
      liveTreasuryInventorySnapshot: {
        observedAt: "2026-05-14T22:30:00.000Z",
        native: [
          {
            chain: "base",
            token: "0x0000000000000000000000000000000000000000",
            asset: "ETH",
            actual: "1000000000000000",
            actualDecimal: 0.001,
            estimatedUsd: 2,
          },
        ],
        tokens: [
          {
            chain: "base",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            actual: "25262222885",
            actualDecimal: 25262.222885,
            estimatedUsd: 25262.222885,
          },
          {
            chain: "base",
            token: "0xd993935e13851dd7517af10687ec7e5022127228",
            ticker: "apxUSD",
            actual: "0",
            actualDecimal: 0,
            estimatedUsd: 0,
          },
        ],
      },
    },
  });

  const pendle = report.strategies.find((strategy) => strategy.id === "pendle-yt-canary");
  assert.ok(pendle);
  assert.equal(pendle.currentLiveEligible, true);
  assert.equal(pendle.selectedMode, "live");
  assert.equal(pendle.selectedCommands[0].script, "executor:merkl-canary-autopilot");
  assert.equal(pendle.liveAdmissionBlockers.length, 0);
  assert.equal(pendle.reason, "auto_executable_merkl_candidate_available");
});

test("Merkl autopilot surface treats dashboard liveTrading as advisory once a policy-engine-ready Pendle canary exists", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "BLOCKED",
        lanePolicy: {
          stage: "shadow_replay",
          policyLiveTrading: "BLOCKED",
        },
      },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    artifacts: {
      merklCanaryQueue: {
        summary: {
          queueCount: 1,
          executableNowCount: 0,
          autoExecutableNowCount: 0,
          pendleYtCount: 1,
          pendleYtCanaryReadyCount: 1,
          topBlockingReason: "inventory_unknown",
        },
        queue: [
          {
            opportunityId: "pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
            chain: "base",
            protocolId: "pendle",
            mappedStrategyId: "pendle-yt-canary",
            priorityScore: 70,
            entryAssets: ["apxUSD"],
            capabilityGaps: ["current_inventory_entry_route_required"],
            autoEntry: { autoExecute: false },
            executionReadiness: {
              status: "inventory_unknown",
              executorSupported: true,
              matchedToken: null,
              matchedNative: {
                asset: "ETH",
                actual: "1000000000000000",
                estimatedUsd: 2,
              },
            },
            pendleYt: { ev: { canaryReady: true, expectedNetUsd: 0.07445 } },
            protocolBindingPlan: {
              status: "binding_ready",
              bindingKind: "pendle_yt_buy_sell_redeem",
              canaryActions: ["enter_fixed_yield_token", "exit_fixed_yield_token"],
              resolvedBinding: {
                assetAddress: "0xd993935e13851dd7517af10687ec7e5022127228",
                entryTokenAddresses: [
                  "0xd993935e13851dd7517af10687ec7e5022127228",
                  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                ],
              },
            },
          },
        ],
      },
      liveTreasuryInventorySnapshot: {
        observedAt: "2026-05-14T22:30:00.000Z",
        native: [{ chain: "base", token: "0x0", asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 }],
        tokens: [
          {
            chain: "base",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            actual: "25262222885",
            actualDecimal: 25262.222885,
            estimatedUsd: 25262.222885,
          },
        ],
      },
    },
  });

  const pendle = report.strategies.find((strategy) => strategy.id === "pendle-yt-canary");
  assert.ok(pendle);
  assert.equal(pendle.currentLiveEligible, true);
  assert.equal(pendle.liveAdmissionBlockers.length, 0);
  assert.equal(pendle.evidence.dashboardLiveTrading, "BLOCKED");
});

test("execution surfaces keep Stage B advisory when live evidence is otherwise ready", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          stage: "B",
          policyLiveTrading: "ALLOWED",
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
  assert.equal(wrapped.liveAdmissionBlockers.length, 0);
  assert.equal(merkl.currentLiveEligible, true);
  assert.equal(merkl.selectedMode, "live");
  assert.equal(merkl.liveAdmissionBlockers.length, 0);
});

test("wrapped BTC loop treats Stage B payback blocker as advisory when policy live trading is allowed", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-06T12:00:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        blockers: [],
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
          stageBlockers: ["receipt_proven_payback_period_missing"],
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, true);
  assert.equal(wrapped.selectedMode, "live");
  assert.equal(wrapped.capabilityBucket, "executable_now");
  assert.equal(wrapped.fallbackReason, null);
  assert.equal(wrapped.liveAdmissionBlockers.length, 0);
  assert.equal(wrapped.liveAdmissionBlockers.length, 0);
  assert.equal(wrapped.evidence.liveRunControl.blocked, false);
  assert.equal(wrapped.selectedCommands[0].script, "executor:wrapped-btc-loop");
  assert.equal(wrapped.selectedCommands[0].command.includes("--per-trade-cap-usd="), true);
  assert.equal(wrapped.evidence.livePerTradeCapUsd <= 25, true);
  assert.equal(wrapped.evidence.livePerTradeCapUsd >= 5, true);
  assert.equal(wrapped.selectedCommands[0].command.includes("--max-loop-iterations=1"), true);
  assert.equal(report.summary.liveEligibleCount, 1);
});

test("wrapped BTC loop stays dry-run when per-intent expected net is not measured", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-06T12:00:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.selectedMode, "dry_run");
  assert.equal(wrapped.fallbackReason, "expected_net_unmeasured");
  assert.equal(wrapped.liveAdmissionBlockers.includes("expected_net_unmeasured"), true);
  assert.equal(wrapped.evidence.expectedNetReady, false);
  assert.equal(report.summary.liveEligibleCount, 0);
});

test("wrapped BTC loop stays dry-run when expected net is below the receipt cost floor", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-06T12:00:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
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
        ...wrappedBtcLoopExpectedNetPolicy(0.42),
        bindingSupport: {
          executableFromRepo: true,
        },
        dryRunSummary: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 22,
        },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 0.42 },
          realized: { valueUsd: 0.42 },
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.selectedMode, "dry_run");
  assert.equal(wrapped.fallbackReason, "expected_net_below_receipt_cost_p90_floor");
  assert.equal(wrapped.liveAdmissionBlockers.includes("expected_net_below_receipt_cost_p90_floor"), true);
  assert.equal(wrapped.evidence.expectedNetUsd, 0.42);
  assert.equal(wrapped.evidence.expectedNetRequiredUsd > wrapped.evidence.expectedNetUsd, true);
  assert.equal(report.summary.liveEligibleCount, 0);
});

test("wrapped BTC loop EV preview consumes signer-backed receipt history instead of chain p99 fallback", () => {
  const now = "2026-05-21T05:00:00.000Z";
  const report = buildStrategyExecutionSurfaces({
    now,
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
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
        ...wrappedBtcLoopExpectedNetPolicy(
          0.4913,
          wrappedBtcLoopReceiptHistoryFixture(0.035, 12, "2026-05-10T00:00:00.000Z"),
        ),
        bindingSupport: { executableFromRepo: true },
        dryRunSummary: { dryRunReceiptRecorded: true, signerBackedRunCount: 12 },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 0.4913 },
          realized: { valueUsd: 0.4913 },
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.evidence.expectedNetCostSource, "history_p90");
  assert.equal(wrapped.evidence.expectedNetSampleCount >= 10, true);
  assert.equal(wrapped.evidence.expectedNetP90CostUsd, 0.035);
  assert.equal(wrapped.evidence.expectedNetRequiredUsd, 0.035);
  assert.equal(wrapped.liveAdmissionBlockers.includes("expected_net_below_receipt_cost_p90_floor"), false);
});

test("wrapped BTC loop EV preview keeps blocking when receipt-history p90 still exceeds expected net", () => {
  const now = "2026-05-21T05:00:00.000Z";
  const report = buildStrategyExecutionSurfaces({
    now,
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
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
        ...wrappedBtcLoopExpectedNetPolicy(
          0.05,
          wrappedBtcLoopReceiptHistoryFixture(0.2, 12, "2026-05-10T00:00:00.000Z"),
        ),
        bindingSupport: { executableFromRepo: true },
        dryRunSummary: { dryRunReceiptRecorded: true, signerBackedRunCount: 12 },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 0.05 },
          realized: { valueUsd: 0.05 },
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.evidence.expectedNetCostSource, "history_p90");
  assert.equal(wrapped.liveAdmissionBlockers.includes("expected_net_below_receipt_cost_p90_floor"), true);
  assert.equal(wrapped.currentLiveEligible, false);
});

test("wrapped BTC loop EV preview falls back to chain p99 when receipt history is below sample threshold", () => {
  const now = "2026-05-21T05:00:00.000Z";
  const report = buildStrategyExecutionSurfaces({
    now,
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "ALLOWED",
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
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
        ...wrappedBtcLoopExpectedNetPolicy(
          0.4913,
          wrappedBtcLoopReceiptHistoryFixture(0.035, 3, "2026-05-10T00:00:00.000Z"),
        ),
        bindingSupport: { executableFromRepo: true },
        dryRunSummary: { dryRunReceiptRecorded: true, signerBackedRunCount: 3 },
        pnl: {
          paper: { annualNetCarryUsd: 5.9183 },
          estimated: { valueUsd: 0.4913 },
          realized: { valueUsd: 0.4913 },
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.evidence.expectedNetCostSource, "fallback_chain_p99");
  assert.equal(wrapped.evidence.expectedNetSampleCount, 3);
});

test("wrapped BTC loop still blocks when runtime liveTrading is blocked despite advisory Stage B metadata", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-06T12:00:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "BLOCKED",
        blockers: ["receipt_proven_payback_period_missing", "refill_routes_unresolved"],
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "B",
          policyLiveTrading: "ALLOWED",
          stageBlockers: ["receipt_proven_payback_period_missing", "refill_routes_unresolved"],
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.selectedMode, "dry_run");
  assert.equal(wrapped.liveAdmissionBlockers.includes("live_trading_blocked"), true);
  assert.equal(report.summary.liveEligibleCount, 0);
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
  assert.equal(
    merkl.liveAdmissionBlockers.some((item) => item.startsWith("same_chain_unprofitable:")),
    true,
  );
});

test("Merkl surface uses latest autopilot EV blocker after sizing and policy preview", () => {
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
            opportunityId: "opp-sized-down",
            chain: "base",
            protocolId: "morpho",
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
      merklCanaryAutopilotLatest: {
        status: "blocked",
        blockedReason: "same_chain_unprofitable:need_$57_on_base",
        summary: {
          blockerCounts: {
            "same_chain_unprofitable:need_$57_on_base": 1,
          },
        },
      },
    },
  });

  const merkl = report.strategies.find((strategy) => strategy.id === "gateway_native_asset_conversion_sleeve");

  assert.equal(merkl.currentLiveEligible, false);
  assert.equal(merkl.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(merkl.evidence.latestAutopilotStatus, "blocked");
  assert.equal(merkl.evidence.latestAutopilotBlockedReason, "same_chain_unprofitable:need_$57_on_base");
  assert.equal(merkl.evidence.projectedPnlUsd, null);
  assert.equal(merkl.evidence.candidateAprPct, 100);
  assert.equal(merkl.liveAdmissionBlockers.includes("same_chain_unprofitable:need_$57_on_base"), true);
});

test("Merkl surface treats completed_with_blockers with no executable selection as non-live", () => {
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
            opportunityId: "opp-filtered",
            chain: "base",
            protocolId: "morpho",
            mappedStrategyId: "gateway_native_asset_conversion_sleeve",
            queueStatus: "ready_for_tiny_live_canary",
            capabilityGaps: [],
            autoEntry: { autoExecute: true },
            executionReadiness: {
              status: "inventory_ready",
              matchedToken: { estimatedUsd: 5 },
            },
            aprPct: 100,
            protocolBindingPlan: {
              bindingKind: "erc4626_vault_supply_withdraw",
              canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
            },
          },
        ],
      },
      merklCanaryAutopilotLatest: {
        status: "completed_with_blockers",
        blockedReason: null,
        filteredReason: "same_chain_unprofitable:need_$57_on_base",
        summary: {
          executionReadyCount: 0,
          previewReadyCount: 0,
          deliveredCount: 0,
          blockedCount: 0,
          filteredCount: 4,
          topBlocker: null,
          blockerCounts: {},
        },
      },
    },
  });

  const merkl = report.strategies.find((strategy) => strategy.id === "gateway_native_asset_conversion_sleeve");

  assert.equal(merkl.currentLiveEligible, false);
  assert.equal(merkl.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(merkl.evidence.latestAutopilotStatus, "completed_with_blockers");
  assert.equal(merkl.evidence.latestAutopilotFilteredReason, "same_chain_unprofitable:need_$57_on_base");
  assert.equal(merkl.evidence.latestAutopilotExecutionReadyCount, 0);
  assert.equal(merkl.evidence.latestAutopilotFilteredCount, 4);
  assert.equal(merkl.liveAdmissionBlockers.includes("same_chain_unprofitable:need_$57_on_base"), true);
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
  assert.equal(wrapped.evidence.liveRunControl.nextEligibleAt, "2026-05-02T12:58:59.137Z");
});

test("wrapped BTC loop one-time operator cooldown waiver unlocks only the matching fresh proof", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-01T14:00:00.000Z",
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
      wrappedBtcLoopLiveProof: {
        observedAt: "2026-05-01T12:58:59.137Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        success: true,
        proofStatus: "signer_backed_roundtrip_recorded",
        proofKind: "signer_backed_roundtrip",
      },
      operatorCooldownWaivers: [
        {
          waiverId: "test-waiver",
          strategyId: "wrapped-btc-loop-base-moonwell",
          scope: "wrapped_btc_loop_live_proof_cooldown",
          reason: "operator-approved-payback-bootstrap-proof",
          operatorApprovedAt: "2026-05-01T13:30:00.000Z",
          expiresAt: "2026-05-02T12:58:59.137Z",
          waivesProofObservedAt: "2026-05-01T12:58:59.137Z",
          maxUses: 1,
        },
      ],
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, true);
  assert.equal(wrapped.selectedMode, "live");
  assert.equal(wrapped.capabilityBucket, "executable_now");
  assert.equal(wrapped.evidence.liveRunControl.blocked, false);
  assert.equal(wrapped.evidence.liveRunControl.operatorCooldownWaiver.applied, true);
  assert.equal(wrapped.evidence.liveRunControl.operatorCooldownWaiver.waiverId, "test-waiver");
});

test("wrapped BTC loop one-time operator cooldown waiver is consumed by post-approval signer activity", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-01T14:20:00.000Z",
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
          timestamp: "2026-05-01T13:35:00.000Z",
          strategyId: "wrapped-btc-loop-base-moonwell",
          chain: "base",
          lifecycle: { stage: "confirmed", txHash: "0xdef" },
          broadcast: { txHash: "0xdef" },
          policyVerdict: "approved",
        },
      ],
      wrappedBtcLoopLiveProof: {
        observedAt: "2026-05-01T12:58:59.137Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        success: true,
        proofStatus: "signer_backed_roundtrip_recorded",
        proofKind: "signer_backed_roundtrip",
      },
      operatorCooldownWaivers: [
        {
          waiverId: "test-waiver",
          strategyId: "wrapped-btc-loop-base-moonwell",
          scope: "wrapped_btc_loop_live_proof_cooldown",
          reason: "operator-approved-payback-bootstrap-proof",
          operatorApprovedAt: "2026-05-01T13:30:00.000Z",
          expiresAt: "2026-05-02T12:58:59.137Z",
          waivesProofObservedAt: "2026-05-01T12:58:59.137Z",
          maxUses: 1,
        },
      ],
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.fallbackReason, "operator_cooldown_waiver_consumed");
  assert.equal(wrapped.evidence.liveRunControl.blocked, true);
  assert.equal(wrapped.evidence.liveRunControl.operatorCooldownWaiver.consumed, true);
  assert.equal(wrapped.evidence.liveRunControl.operatorCooldownWaiver.consumedAt, "2026-05-01T13:35:00.000Z");
});

test("wrapped BTC loop cooldown waiver does not convert non-payback runtime blockers into live dispatch", () => {
  const report = buildStrategyExecutionSurfaces({
    now: "2026-05-01T14:00:00.000Z",
    dashboardStatus: {
      ...dashboardStatusFixture(),
      overall: {
        liveTrading: "BLOCKED",
        blockers: ["kill_switch_present"],
        lanePolicy: {
          candidateId: "wrapped-btc-loop-base-moonwell",
          stage: "C",
          policyLiveTrading: "ALLOWED",
          stageBlockers: ["kill_switch_present"],
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
      wrappedBtcLoopLiveProof: {
        observedAt: "2026-05-01T12:58:59.137Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        success: true,
        proofStatus: "signer_backed_roundtrip_recorded",
        proofKind: "signer_backed_roundtrip",
      },
      operatorCooldownWaivers: [
        {
          waiverId: "test-waiver",
          strategyId: "wrapped-btc-loop-base-moonwell",
          scope: "wrapped_btc_loop_live_proof_cooldown",
          reason: "operator-approved-payback-bootstrap-proof",
          operatorApprovedAt: "2026-05-01T13:30:00.000Z",
          expiresAt: "2026-05-02T12:58:59.137Z",
          waivesProofObservedAt: "2026-05-01T12:58:59.137Z",
          maxUses: 1,
        },
      ],
    },
  });

  const wrapped = report.strategies.find((strategy) => strategy.id === "wrapped-btc-loop-base-moonwell");

  assert.equal(wrapped.currentLiveEligible, false);
  assert.equal(wrapped.fallbackReason, "live_trading_blocked");
  assert.equal(wrapped.liveAdmissionBlockers.includes("live_trading_blocked"), true);
  assert.equal(wrapped.evidence.liveRunControl.operatorCooldownWaiver.applied, true);
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
        ...wrappedBtcLoopExpectedNetPolicy(),
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
