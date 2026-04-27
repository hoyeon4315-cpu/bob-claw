function groupBy(array, key) {
  const result = {};
  for (const item of array) {
    const value = item[key];
    if (!value) continue;
    result[value] = result[value] || [];
    result[value].push(item);
  }
  return result;
}

export function evaluateProtocolQualification(protocolOpportunities = []) {
  const totalTvl = protocolOpportunities.reduce((sum, o) => sum + (o.tvlUsd || 0), 0);
  const audited = protocolOpportunities.some((o) => o.hasAudit === true);
  const distinctOpps = new Set(protocolOpportunities.map((o) => o.opportunityId || o.id)).size;

  return {
    totalTvl,
    audited,
    distinctOpps,
    qualified: totalTvl >= 1_000_000 && audited && distinctOpps >= 3,
  };
}

export function scanProtocols(opportunities = []) {
  const byProtocol = groupBy(opportunities || [], "protocol");
  const qualifying = [];

  for (const [protocol, protocolOpps] of Object.entries(byProtocol)) {
    const evalResult = evaluateProtocolQualification(protocolOpps);
    if (evalResult.qualified) {
      qualifying.push({
        protocol,
        ...evalResult,
      });
    }
  }

  return qualifying;
}
