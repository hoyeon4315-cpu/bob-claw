// Dashboard slice for opportunity-driven system metrics.
// Writes into the dashboard status JSON consumed by the frontend.
// Dormant until opportunity-integration is enabled.

export function buildOpportunityDashboardSlice({
  opportunityCount = 0,
  topScore = null,
  roundTripSuccessRate = null,
  concentrationWarnings = [],
}) {
  return {
    opportunityCount,
    topScore,
    roundTripSuccessRate,
    concentrationWarnings,
    _meta: {
      type: "opportunity-dashboard-slice",
      version: 1,
      dormant: true,
    },
  };
}
