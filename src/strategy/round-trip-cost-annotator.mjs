const DEFAULT_ROUTE_COST_USD = Object.freeze({
  base: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
  ethereum: Object.freeze({ bridgeIn: 8.0, bridgeOut: 8.0, entryGas: 5.0, exitGas: 6.0 }),
  bob: Object.freeze({ bridgeIn: 2.0, bridgeOut: 2.0, entryGas: 1.0, exitGas: 1.5 }),
  avalanche: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
  bera: Object.freeze({ bridgeIn: 3.0, bridgeOut: 3.0, entryGas: 2.0, exitGas: 2.5 }),
  bsc: Object.freeze({ bridgeIn: 2.0, bridgeOut: 2.0, entryGas: 1.0, exitGas: 1.5 }),
  optimism: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
  sei: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
  soneium: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
  sonic: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
  unichain: Object.freeze({ bridgeIn: 2.5, bridgeOut: 2.5, entryGas: 1.5, exitGas: 2.0 }),
});

const FALLBACK_ROUTE_COST_USD = Object.freeze({
  bridgeIn: 3.0,
  bridgeOut: 3.0,
  entryGas: 2.0,
  exitGas: 2.5,
});

function chainRouteCostUsd(chain, defaults = DEFAULT_ROUTE_COST_USD) {
  return defaults[chain] ?? FALLBACK_ROUTE_COST_USD;
}

function opportunityTypeAdjustment(opportunity = {}) {
  const surface = opportunity.executionSurface ?? opportunity.type ?? "unknown";
  if (surface === "lending" || surface === "stableBorrow" || surface === "ethLending") {
    return { entryMult: 1.0, exitMult: 1.0 };
  }
  if (surface === "clLp" || surface === "stableCarry") {
    return { entryMult: 1.3, exitMult: 1.3 };
  }
  if (surface === "managedVault" || surface === "reserveAllocation") {
    return { entryMult: 1.1, exitMult: 1.2 };
  }
  if (surface === "fixedYield" || surface === "assetRotation") {
    return { entryMult: 1.0, exitMult: 1.1 };
  }
  return { entryMult: 1.0, exitMult: 1.0 };
}

export function annotateOpportunityCost(opportunity = {}, {
  capitalState = {},
  routeCostEstimator = null,
  defaults = DEFAULT_ROUTE_COST_USD,
} = {}) {
  const chain = opportunity.chain;
  if (!chain || typeof chain !== "string") {
    return {
      ...opportunity,
      roundTripCostUsd: null,
      effectiveApr: null,
      net30dYieldUsd: null,
      routeCostEstimate: null,
      costAnnotationError: "missing_chain",
    };
  }

  const baseEstimate = routeCostEstimator
    ? routeCostEstimator(opportunity, capitalState)
    : chainRouteCostUsd(chain, defaults);

  const adjustment = opportunityTypeAdjustment(opportunity);
  const estimate = Object.freeze({
    bridgeIn: baseEstimate.bridgeIn,
    bridgeOut: baseEstimate.bridgeOut,
    entryGas: baseEstimate.entryGas * adjustment.entryMult,
    exitGas: baseEstimate.exitGas * adjustment.exitMult,
  });

  const roundTripCostUsd =
    estimate.bridgeIn + estimate.entryGas + estimate.exitGas + estimate.bridgeOut;

  const postedAprDecimal = (opportunity.aprPct ?? opportunity.apr ?? 0) / 100;
  const tvlUsd = opportunity.tvlUsd ?? 1;
  const aprCostDrag = tvlUsd > 0 ? (roundTripCostUsd / tvlUsd) * (365 / 30) : 0;
  const effectiveApr = Math.max(0, postedAprDecimal - aprCostDrag);

  const positionUsd = opportunity.positionUsd ?? opportunity.perOpportunityMaxUsd ?? 0;
  const gross30dYieldUsd = positionUsd * postedAprDecimal * (30 / 365);
  const net30dYieldUsd = gross30dYieldUsd - roundTripCostUsd;

  const minHoldDays =
    opportunity.minHoldDays ??
    (opportunity.campaignRemainingHours
      ? opportunity.campaignRemainingHours / 24
      : 30);
  const amortizedDailyCostUsd = minHoldDays > 0 ? roundTripCostUsd / minHoldDays : roundTripCostUsd;
  const netDailyYieldUsd = positionUsd * postedAprDecimal * (1 / 365) - amortizedDailyCostUsd;

  return {
    ...opportunity,
    roundTripCostUsd,
    effectiveApr,
    net30dYieldUsd,
    netDailyYieldUsd,
    amortizedDailyCostUsd,
    routeCostEstimate: estimate,
    costAnnotatedAt: new Date().toISOString(),
  };
}

export function annotateOpportunitiesCost(opportunities = [], context = {}) {
  return (opportunities || []).map((opp) => annotateOpportunityCost(opp, context));
}

export function filterCostPositiveOpportunities(annotatedOpportunities = []) {
  return (annotatedOpportunities || []).filter(
    (opp) =>
      opp.net30dYieldUsd != null &&
      opp.net30dYieldUsd > 0 &&
      opp.roundTripCostUsd != null &&
      opp.roundTripCostUsd > 0,
  );
}
