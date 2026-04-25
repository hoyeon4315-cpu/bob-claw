function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function extractSourceFloorUsdc(source = "") {
  const match = String(source).match(/minProfitUsdc[^\n]*?(\d{3,})/);
  return match ? Number(match[1]) : null;
}

export function buildFlashFloorDecision({
  contractSource = "",
  deploymentCommands = [],
  laneReclassification = null,
  strategySnapshot = null,
  now = null,
} = {}) {
  const triangularLane = laneReclassification?.lanes?.find((lane) => lane.id === "triangular_flash_btc") || null;
  const triangularStrategy =
    strategySnapshot?.implementedStrategies?.find((item) => item.id === "triangular_flash_btc") || null;
  const sourceMinProfitUsdc = extractSourceFloorUsdc(contractSource) || 300000;
  const ownerSetterAvailable = /function\s+setMinProfit\s*\(/.test(contractSource);
  const deployMinProfitUsdc = deploymentCommands.some((command) => String(command).includes("300000")) ? 300000 : null;
  const measuredNetUsd = triangularLane?.netPnlMeasuredUsd ?? null;
  const contractFloorUsd = sourceMinProfitUsdc / 1_000_000;
  const setterWouldHelp = Number.isFinite(measuredNetUsd) && measuredNetUsd > 0 && measuredNetUsd < contractFloorUsd;

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    contract: {
      sourceMinProfitUsdc,
      sourceMinProfitUsd: round(contractFloorUsd, 6),
      ownerSetterAvailable,
      deploymentCommands,
      deploymentDefaultMinProfitUsdc: deployMinProfitUsdc,
    },
    lane: {
      strategyStatus: triangularStrategy?.status || null,
      laneStatusNew: triangularLane?.statusNew || null,
      passesOverfitGate: triangularLane?.passesOverfitGate ?? null,
      measuredNetUsd: measuredNetUsd ?? null,
      gasSlippageVarianceUsd: triangularLane?.gasSlippageVarianceUsd ?? null,
      remainingBlockers: triangularLane?.remainingBlockers || [],
      statusReasonCode: triangularLane?.statusReasonCode || null,
    },
    summary: {
      currentDecision:
        triangularLane?.statusNew === "blocked_by_contract_floor"
          ? "contract_floor_is_active_blocker"
          : ownerSetterAvailable
            ? "setter_available_no_redeploy_required"
            : "redeploy_required_for_any_floor_change",
      setterWouldHelp,
      recommendation:
        triangularLane?.statusNew === "blocked_by_contract_floor"
          ? ownerSetterAvailable
            ? "lower_floor_via_owner_setter_after_confirming measured positive EV"
            : "redeploy_with_owner_settable_floor"
          : ownerSetterAvailable
            ? "keep_current_floor_until_flash lane shows measured net between 0 and current floor"
            : "no_change_until_flash lane has stronger measured evidence",
    },
    options: [
      {
        id: "keep_current_floor",
        available: true,
        useWhen: "flash lane is still blocked by missing measurement, overfit, or non-positive net rather than the contract floor itself",
      },
      {
        id: "lower_via_owner_setter",
        available: ownerSetterAvailable,
        useWhen: "measured flash net stays positive but lands below the current on-chain USD 0.30 floor",
      },
      {
        id: "redeploy_contract",
        available: true,
        useWhen: "the deployed bytecode lacks the setter, ownership is unavailable, or the flash executor needs broader source-level changes",
      },
    ],
  };
}
