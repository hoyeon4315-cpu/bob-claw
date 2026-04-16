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
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "deterministic_closed_loop_executor_missing",
        missingCapabilities: ["deterministic_closed_loop_executor_missing"],
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "btc_proxy_spreads": {
      const selectedMode = "analysis";
      const selectedCommands = proxyCommands(entry, selectedMode);
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: entry.status === "candidate_for_validation" ? "live_executor_not_generalized" : "measured_surface_needs_report_refresh",
        missingCapabilities: compact([
          entry.status === "candidate_for_validation" ? "live_executor_not_generalized" : null,
        ]),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "stablecoin_entry_exit_loops": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "missing_executor_adapter",
        runnerKind: "status_refresh_only",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "dedicated_entry_exit_loop_runner_missing",
        missingCapabilities: ["dedicated_entry_exit_loop_runner_missing"],
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "triangular_flash_btc": {
      const currentLiveEligible = entry.status === "candidate_for_validation" && liveAllowed && flashAllowed;
      const selectedMode = currentLiveEligible ? "live" : "dry_run";
      const selectedCommands = triangleCommands(entry, selectedMode);
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
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_family_gateway": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "multichain_eth_surface_unconfirmed",
        missingCapabilities: compact([
          policy?.ethereumL1 === "observe_only_until_reapproved" ? "ethereum_l1_live_reapproval_required" : null,
        ]),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_mixed_stable_loops": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "missing_executor_adapter",
        runnerKind: "status_refresh_only",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "mixed_eth_stable_loop_runner_missing",
        missingCapabilities: ["mixed_eth_stable_loop_runner_missing"],
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
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_mixed_flash": {
      const currentLiveEligible = entry.status === "candidate_for_validation" && liveAllowed && flashAllowed;
      const selectedMode = currentLiveEligible ? "live" : "dry_run";
      const selectedCommands = mixedFlashCommands(entry, selectedMode);
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
