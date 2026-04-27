import { isTrustedIssuer } from "../config/trusted-issuers.mjs";

export function classifyWhitelistRisk(candidate = {}) {
  const blockers = [];

  if (candidate.lockup === true) {
    blockers.push("lockup_true");
  }
  if (candidate.transferable === false) {
    blockers.push("transferable_false");
  }
  if (candidate.hasAudit === false && (candidate.tvlUsd ?? 0) < 10_000_000) {
    blockers.push("no_audit_and_low_tvl");
  }

  if (blockers.length > 0) {
    return { tier: "REJECT", blockers };
  }

  const age = Number(candidate.contractAgeDays ?? 0);
  const top10 = Number(candidate.top10HolderPct ?? 100);
  const audit = candidate.hasAudit === true;
  const vol = Number(candidate.vol30dPct ?? Number.POSITIVE_INFINITY);
  const tvl = Number(candidate.tvlUsd ?? 0);
  const trusted = isTrustedIssuer(candidate.trustedIssuer);
  const transferable = candidate.transferable !== false;

  if (age > 365 && top10 < 40 && audit && vol < 30) {
    return { tier: "TIER_A", blockers: [] };
  }

  if (trusted && transferable && audit && tvl > 5_000_000) {
    return { tier: "TIER_B", blockers: [] };
  }

  if (age > 90 && top10 < 60 && vol < 80) {
    return { tier: "TIER_C", blockers: [] };
  }

  return { tier: "REJECT", blockers: ["does_not_meet_any_tier"] };
}
