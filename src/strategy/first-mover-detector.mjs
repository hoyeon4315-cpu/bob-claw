export function detectFirstMoverOpportunities({
  protocols,
  chain,
  recencyHours = 24,
  registryResult = { records: [] },
  profile,
}) {
  if (profile && !featureEnabled(profile)) return []

  const existingIds = new Set(
    registryResult.records.map((r) => r.strategyId || r.dedupeKey || r.protocol),
  )
  const cutoffMs = Date.now() - recencyHours * 60 * 60 * 1000

  return protocols
    .filter((p) => p.firstSeenAt >= cutoffMs)
    .filter((p) => !existingIds.has(p.protocol))
    .map((p) => {
      const ageHours = Math.max(1, p.ageHours || 1)
      const score = p.tvlUsd * 0.3 + p.impliedApr * 0.5 + (1 / ageHours) * 0.2
      return {
        protocol: p.protocol,
        chain,
        firstSeenAt: p.firstSeenAt,
        tvlUsd: p.tvlUsd,
        impliedApr: p.impliedApr,
        score,
      }
    })
    .sort((a, b) => b.score - a.score)
}

export function canActivateAggressiveProfile({ evidenceCount, auditReplayClean }) {
  if (evidenceCount >= 2 && auditReplayClean === true) {
    return { canActivate: true, reason: "sufficient evidence and clean audit replay" }
  }
  if (evidenceCount < 2) {
    return { canActivate: false, reason: `insufficient evidence: ${evidenceCount} < 2` }
  }
  return { canActivate: false, reason: "audit replay is not clean" }
}

export function featureEnabled(profile) {
  const resolved = profile?.firstMoverEnabled === true
  return resolved
}
