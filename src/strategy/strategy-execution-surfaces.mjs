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

export function buildStrategyExecutionSurfaces({ dashboardStatus = null, state = {}, triangleArtifacts = {}, now = null } = {}) {
  const catalog = buildStrategyCatalog({ dashboardStatus, state, triangleArtifacts });
  const strategies = [
    ...(catalog.btcFamilies || []).map((entry) => buildSurface(entry, { group: "btcFamilies", policy: catalog.policy })),
    ...(catalog.ethBranches || []).map((entry) => buildSurface(entry, { group: "ethBranches", policy: catalog.policy })),
  ];
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
