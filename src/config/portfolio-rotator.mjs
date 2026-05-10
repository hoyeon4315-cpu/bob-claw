import { DEFAULT_AGGRESSION_PROFILE_ID, resolveAggressionProfile } from "./aggression-profile.mjs";

function finiteCapital(capitalUsd) {
  const numeric = Number(capitalUsd);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function K_for_capital(capitalUsd, profile = DEFAULT_AGGRESSION_PROFILE_ID) {
  const capital = finiteCapital(capitalUsd);
  const resolved = resolveAggressionProfile(profile);
  let k = 0;
  if (capital >= 100) k = 1;
  if (capital >= 350) k = 2;
  if (capital >= 1_000) k = 3;
  if (capital >= 5_000) k = 5;
  if (capital >= 25_000) k = 8;
  return Math.min(k, resolved.maxK ?? k);
}

export function reservePctForCapital(capitalUsd, profile = DEFAULT_AGGRESSION_PROFILE_ID) {
  const capital = finiteCapital(capitalUsd);
  const resolved = resolveAggressionProfile(profile);
  if (capital <= 0) return 1;
  if (capital < 1_000) return Math.max(resolved.reserveFloorPct, 0.2);
  if (capital < 5_000) return Math.max(resolved.reserveFloorPct - 0.05, 0.15);
  return Math.max(resolved.reserveFloorPct - 0.1, 0.1);
}

export function canarySizeForCapital(capitalUsd, profile = DEFAULT_AGGRESSION_PROFILE_ID) {
  const capital = finiteCapital(capitalUsd);
  const resolved = resolveAggressionProfile(profile);
  if (capital <= 0) return 0;
  const raw = capital * resolved.canaryPctOfCapital;
  return Math.min(resolved.maxCanaryUsd, Math.max(resolved.minCanaryUsd, raw));
}

export { DEFAULT_AGGRESSION_PROFILE_ID, resolveAggressionProfile };
