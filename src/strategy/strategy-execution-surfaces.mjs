import { buildStrategyCatalog } from "./strategy-catalog.mjs";

const LIVE_TRADING_ALLOWED = new Set(["ALLOWED", "ENABLED"]);
const FLASH_LIVE_ALLOWED = new Set(["ALLOWED", "ENABLED", "approved"]);

function compact(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function commandScript(command) {
  const match = String(command || "").trim().match(/^npm run\s+([^\s]+)/);
  return match?.[1] || null;
}

function withScripts(commands = []) {
  return (commands || []).map((command) => ({
    command,
    script: commandScript(command),
  }));
}

function liveTradingAllowed(policy = null) {
  return LIVE_TRADING_ALLOWED.has(String(policy?.liveTrading || "").trim());
}

function flashLiveAllowed(policy = null) {
  return FLASH_LIVE_ALLOWED.has(String(policy?.flashLiveAdmission || "").trim());
}

function liveAdmissionBlockers({
  entry,
  liveAllowed,
  flashAllowed = true,
  requiresFlash = false,
  extra = [],
  statusRequired = null,
} = {}) {
  return compact([
    !liveAllowed ? "live_trading_blocked" : null,
    requiresFlash && !flashAllowed ? "flash_live_admission_blocked" : null,
    statusRequired && entry?.status !== statusRequired ? `status_not_${statusRequired}` : null,
    ...(extra || []),
  ]);
}

function laneForGroup(group = null) {
  if (group === "btcFamilies") return "btc_family";
  if (group === "ethBranches") return "eth_branch";
  return "unknown";
}

function proxyCommands(entry, mode) {
  const commands = entry?.commands || [];
  if (mode === "analysis") return commands;
  return commands;
}

function triangleCommands(entry, mode) {
  const commands = entry?.commands || [];
  if (mode === "live") return commands.slice(-1);
  return commands.slice(0, 2);
}

function mixedFlashCommands(entry, mode) {
  const commands = entry?.commands || [];
  if (mode === "live") return commands.slice(-1);
  return commands.slice(0, 1);
}

function phase3ValidationById(phase3Validation = null) {
  return new Map((phase3Validation?.validations || []).map((entry) => [entry.id, entry]));
}

function wrappedBtcLoopCommands(mode) {
  if (mode === "live") return ["npm run executor:wrapped-btc-loop -- --json"];
  return [
    "npm run report:wrapped-btc-loop -- --json",
    "npm run report:wrapped-btc-loop-dry-run -- --json",
  ];
}

function buildWrappedBtcLoopExecutorSurface({ policy, phase3Validation = null, wrappedBtcLendingLoopSlice = null } = {}) {
  const validation = phase3ValidationById(phase3Validation).get("wrapped_btc_loop_validation") || null;
  const strategy = wrappedBtcLendingLoopSlice?.strategy || {};
  if (!strategy.id) return null;
  const liveAllowed = liveTradingAllowed(policy);
  const validationPassed = validation?.overallStatus === "passed";
  const bindingReady = wrappedBtcLendingLoopSlice?.bindingSupport?.executableFromRepo === true;
  const dryRunRecorded = wrappedBtcLendingLoopSlice?.dryRunSummary?.dryRunReceiptRecorded === true;
  const currentLiveEligible = liveAllowed && validationPassed && bindingReady && dryRunRecorded;
  const blockers = compact([
    !liveAllowed ? "live_trading_blocked" : null,
    validationPassed ? null : validation?.blockers?.[0] || "phase3_validation_not_passed",
    bindingReady ? null : "repo_auto_build_not_supported",
    dryRunRecorded ? null : "dry_run_receipt_missing",
  ]);
  const selectedMode = currentLiveEligible ? "live" : "dry_run";
  return {
    id: strategy.id,
    label: strategy.label || "Wrapped BTC lending loop (Base / Moonwell)",
    lane: "btc_family",
    status: validationPassed ? "candidate_for_validation" : "analysis_only",
    reason: currentLiveEligible ? "phase3_validation_passed" : blockers[0] || "phase3_validation_not_passed",
    evidence: {
      phase3OverallStatus: validation?.overallStatus || null,
      oosSplitStatus: validation?.oosSplitStatus || null,
      shockTestStatus: validation?.shockTestStatus || null,
      liveRoundtripProofStatus: validation?.evidence?.liveRoundtripProofStatus || null,
      extendedReceiptContextReady: validation?.evidence?.extendedReceiptContextReady ?? null,
      dryRunReceiptRecorded: dryRunRecorded,
      signerBackedRunCount: wrappedBtcLendingLoopSlice?.dryRunSummary?.signerBackedRunCount ?? 0,
      projectedAnnualNetCarryBtc: null,
      projectedAnnualNetCarryUsd: wrappedBtcLendingLoopSlice?.pnl?.paper?.annualNetCarryUsd ?? null,
      estimatedNetCarryBtc: null,
      estimatedNetCarryUsd: wrappedBtcLendingLoopSlice?.pnl?.estimated?.valueUsd ?? null,
      realizedNetCarryBtc: null,
      realizedNetCarryUsd: validation?.evidence?.realizedNetCarryUsd ?? wrappedBtcLendingLoopSlice?.pnl?.realized?.valueUsd ?? null,
    },
    capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
    runnerKind: "command_sequence",
    liveCapable: true,
    currentLiveEligible,
    selectedMode,
    fallbackReason: currentLiveEligible ? null : blockers[0] || "phase3_validation_not_passed",
    missingCapabilities: blockers.filter((blocker) => blocker !== "live_trading_blocked"),
    liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
    selectedCommands: withScripts(wrappedBtcLoopCommands(selectedMode)),
  };
}

function merklAutopilotCommands(mode) {
  if (mode === "live") return ["npm run executor:merkl-canary-autopilot -- --json"];
  return ["npm run report:merkl-canary-queue -- --json"];
}

function buildMerklAutopilotSurface({ policy, merklCanaryQueue = null } = {}) {
  const summary = merklCanaryQueue?.summary || {};
  const queue = merklCanaryQueue?.queue || [];
  const topReady = queue.find((item) =>
    item?.autoEntry?.autoExecute === true &&
    item?.executionReadiness?.status === "inventory_ready" &&
    (item?.capabilityGaps || []).length === 0,
  ) || queue.find((item) => item?.queueStatus === "ready_for_tiny_live_canary") || null;
  if (!merklCanaryQueue && !topReady) return null;
  const liveAllowed = liveTradingAllowed(policy);
  const currentLiveEligible = liveAllowed && (summary.autoExecutableNowCount ?? 0) > 0 && Boolean(topReady);
  const blockers = compact([
    !liveAllowed ? "live_trading_blocked" : null,
    (summary.autoExecutableNowCount ?? 0) > 0 ? null : summary.topBlockingReason || "merkl_auto_executable_candidate_missing",
  ]);
  const selectedMode = currentLiveEligible ? "live" : "analysis";
  return {
    id: topReady?.mappedStrategyId || "gateway_native_asset_conversion_sleeve",
    label: "Merkl tiny live canary autopilot",
    lane: "yield_sleeve",
    status: currentLiveEligible ? "candidate_for_validation" : "analysis_only",
    reason: currentLiveEligible ? "auto_executable_merkl_candidate_available" : blockers[0] || "merkl_queue_not_ready",
    evidence: {
      queueCount: summary.queueCount ?? 0,
      executableNowCount: summary.executableNowCount ?? 0,
      autoExecutableNowCount: summary.autoExecutableNowCount ?? 0,
      topOpportunityId: topReady?.opportunityId || summary.topExecutableOpportunityId || null,
      topProtocolId: topReady?.protocolId || null,
      projectedPnlBtc: null,
      projectedPnlUsd: topReady?.aprPct ?? null,
      estimatedPnlBtc: null,
      estimatedPnlUsd: topReady?.executionReadiness?.matchedToken?.estimatedUsd ?? null,
      realizedPnlBtc: null,
      realizedPnlUsd: null,
    },
    capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
    runnerKind: "command_sequence",
    liveCapable: true,
    currentLiveEligible,
    selectedMode,
    fallbackReason: currentLiveEligible ? null : blockers[0] || "merkl_queue_not_ready",
    missingCapabilities: blockers.filter((blocker) => blocker !== "live_trading_blocked"),
    liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
    selectedCommands: withScripts(merklAutopilotCommands(selectedMode)),
  };
}

function buildSurface(entry, { group, policy }) {
  const lane = laneForGroup(group);
  const liveAllowed = liveTradingAllowed(policy);
  const flashAllowed = flashLiveAllowed(policy);
  const shared = {
    id: entry.id,
    label: entry.label,
    lane,
    status: entry.status,
    reason: entry.reason || null,
    evidence: entry.evidence || {},
  };

  switch (entry.id) {
    case "gateway_wrapped_btc_loops": {
      const selectedMode = "shadow";
      const selectedCommands = entry.commands || [];
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        extra: ["route_specific_executor_inputs_required"],
      });
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "route_specific_executor_inputs_required",
        missingCapabilities: [],
        liveAdmissionBlockers: blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "btc_proxy_spreads": {
      const selectedMode = "shadow";
      const selectedCommands = proxyCommands(entry, selectedMode);
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        extra: ["route_specific_executor_inputs_required"],
      });
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "route_specific_executor_inputs_required",
        missingCapabilities: [],
        liveAdmissionBlockers: blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "stablecoin_entry_exit_loops": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "analysis_probe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["analysis_probe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "triangular_flash_btc": {
      const currentLiveEligible = entry.status === "candidate_for_validation" && liveAllowed && flashAllowed;
      const selectedMode = currentLiveEligible ? "live" : "dry_run";
      const selectedCommands = triangleCommands(entry, selectedMode);
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        flashAllowed,
        requiresFlash: true,
        statusRequired: "candidate_for_validation",
      });
      return {
        ...shared,
        capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible,
        selectedMode,
        fallbackReason: currentLiveEligible
          ? null
          : compact([
              !flashAllowed ? "flash_live_admission_blocked" : null,
              !liveAllowed ? "live_trading_blocked" : null,
              entry.status !== "candidate_for_validation" ? entry.status : null,
            ])[0] || "fallback_to_dry_run",
        missingCapabilities: compact([
          !flashAllowed ? "flash_live_admission_blocked" : null,
          !liveAllowed ? "live_trading_blocked" : null,
        ]),
        liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_family_gateway": {
      const selectedMode = "shadow";
      const selectedCommands = entry.commands || [];
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        extra: ["multichain_eth_surface_unconfirmed"],
      });
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "multichain_eth_surface_unconfirmed",
        missingCapabilities: ["multichain_eth_surface_unconfirmed"],
        liveAdmissionBlockers: blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_mixed_stable_loops": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "analysis_probe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["analysis_probe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_dex_spread_mixed": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "mixed_triangle_branch_observe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["mixed_triangle_branch_observe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_mixed_flash": {
      const currentLiveEligible = entry.status === "candidate_for_validation" && liveAllowed && flashAllowed;
      const selectedMode = currentLiveEligible ? "live" : "dry_run";
      const selectedCommands = mixedFlashCommands(entry, selectedMode);
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        flashAllowed,
        requiresFlash: true,
        statusRequired: "candidate_for_validation",
        extra: ["contract_not_generalized"],
      });
      return {
        ...shared,
        capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible,
        selectedMode,
        fallbackReason: currentLiveEligible
          ? null
          : compact([
              !flashAllowed ? "flash_live_admission_blocked" : null,
              !liveAllowed ? "live_trading_blocked" : null,
              entry.status !== "candidate_for_validation" ? entry.status : null,
            ])[0] || "fallback_to_flash_dry_run",
        missingCapabilities: compact([
          "contract_not_generalized",
          !flashAllowed ? "flash_live_admission_blocked" : null,
          !liveAllowed ? "live_trading_blocked" : null,
        ]),
        liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    default: {
      return {
        ...shared,
        capabilityBucket: "missing_executor_adapter",
        runnerKind: "unknown",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode: "analysis",
        fallbackReason: "unclassified_strategy_surface",
        missingCapabilities: ["unclassified_strategy_surface"],
        liveAdmissionBlockers: ["unclassified_strategy_surface"],
        selectedCommands: withScripts(entry.commands || []),
      };
    }
  }
}

export function buildStrategyExecutionSurfaces({
  dashboardStatus = null,
  state = {},
  triangleArtifacts = {},
  artifacts = {},
  now = null,
} = {}) {
  const catalog = buildStrategyCatalog({ dashboardStatus, state, triangleArtifacts });
  const strategies = [
    ...(catalog.btcFamilies || []).map((entry) => buildSurface(entry, { group: "btcFamilies", policy: catalog.policy })),
    ...(catalog.ethBranches || []).map((entry) => buildSurface(entry, { group: "ethBranches", policy: catalog.policy })),
    buildWrappedBtcLoopExecutorSurface({
      policy: catalog.policy,
      phase3Validation: artifacts.phase3StrategyValidation || null,
      wrappedBtcLendingLoopSlice: artifacts.wrappedBtcLendingLoopSlice || null,
    }),
    buildMerklAutopilotSurface({
      policy: catalog.policy,
      merklCanaryQueue: artifacts.merklCanaryQueue || null,
    }),
  ].filter(Boolean);
  const bucketCounts = strategies.reduce((counts, strategy) => {
    counts[strategy.capabilityBucket] = (counts[strategy.capabilityBucket] || 0) + 1;
    return counts;
  }, {});
  const selectedModeCounts = strategies.reduce((counts, strategy) => {
    counts[strategy.selectedMode] = (counts[strategy.selectedMode] || 0) + 1;
    return counts;
  }, {});
  const runnableStrategies = strategies.filter((strategy) => strategy.selectedCommands.length > 0);
  return {
    schemaVersion: 1,
    generatedAt: now || catalog.generatedAt || new Date().toISOString(),
    policy: catalog.policy,
    summary: {
      strategyCount: strategies.length,
      runnableCount: runnableStrategies.length,
      liveEligibleCount: strategies.filter((strategy) => strategy.currentLiveEligible).length,
      missingExecutorCount: strategies.filter((strategy) => strategy.capabilityBucket === "missing_executor_adapter").length,
      bucketCounts,
      selectedModeCounts,
      topRunnableId: runnableStrategies[0]?.id || null,
    },
    strategies,
  };
}
