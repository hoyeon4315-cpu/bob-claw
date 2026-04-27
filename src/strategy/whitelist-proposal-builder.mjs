import { classifyWhitelistRisk } from "./whitelist-risk-classifier.mjs";

export function buildWhitelistProposal(candidate = {}) {
  const classification = candidate.classification ?? classifyWhitelistRisk(candidate);
  const symbol = String(candidate.symbol ?? candidate.id ?? "unknown").toUpperCase();

  return {
    entity: "whitelist",
    id: symbol,
    tier: classification.tier,
    blockers: classification.blockers,
    evidence: {
      symbol,
      contractAgeDays: candidate.contractAgeDays,
      top10HolderPct: candidate.top10HolderPct,
      hasAudit: candidate.hasAudit,
      tvlUsd: candidate.tvlUsd,
      trustedIssuer: candidate.trustedIssuer,
      vol30dPct: candidate.vol30dPct,
    },
    proposedAt: new Date().toISOString(),
    idempotentCheck: `src/config/merkl-auto-entry.mjs whitelistedEntrySymbols includes "${symbol}"`,
  };
}

export function buildWhitelistProposals(candidates = []) {
  return (candidates || []).map((c) => buildWhitelistProposal(c));
}
