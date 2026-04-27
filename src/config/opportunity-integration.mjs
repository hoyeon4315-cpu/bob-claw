// Integration enable flag for the opportunity-driven aggressive yield system.
// Default false until PR 13 explicitly enables it via committed diff.
export const OPPORTUNITY_INTEGRATION = {
  enabled: true,
};

export function isOpportunityIntegrationEnabled() {
  return OPPORTUNITY_INTEGRATION.enabled === true;
}
