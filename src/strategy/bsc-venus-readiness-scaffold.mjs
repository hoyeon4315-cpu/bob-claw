export function buildBscVenusReadinessScaffold({ observedAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: 1,
    observedAt,
    id: "bsc-venus-first-canary-readiness",
    chain: "bsc",
    protocolId: "venus",
    familyId: "campaign_aware_destination_yield",
    mappedSurface: "merkl_canary_queue",
    reportOnly: true,
    runtimeAuthority: "none",
    autoExecute: false,
    catalogDispatchEligible: false,
    strategyLaneCreated: false,
    capChangeRequested: false,
    paybackPolicyChangeRequested: false,
    nextAction: "report_only_review",
    requiredProofs: [
      "current_merkl_campaign_data",
      "venus_binding_and_reader_ok_envelope",
      "supported_executor_binding",
      "deterministic_entry_exit_path",
      "reward_token_haircut_and_exit_liquidity",
      "gas_claim_swap_exit_cost_estimate",
      "receipt_backed_entry_exit_unwind",
      "kill_switch_and_policy_path",
    ],
    readinessChecks: [
      { id: "auto_execute_disabled", ok: true },
      { id: "catalog_dispatch_blocked", ok: true },
      { id: "new_strategy_lane_not_created", ok: true },
      { id: "operator_cap_unchanged", ok: true },
      { id: "payback_policy_unchanged", ok: true },
    ],
  };
}

export const BSC_VENUS_READINESS_SCAFFOLD = Object.freeze(buildBscVenusReadinessScaffold({
  observedAt: "2026-05-08T00:00:00.000Z",
}));

export default BSC_VENUS_READINESS_SCAFFOLD;
