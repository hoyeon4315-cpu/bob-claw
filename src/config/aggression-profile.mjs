export const AGGRESSION_PROFILES = Object.freeze({
  safety_first: Object.freeze({
    id: "safety_first",
    canaryPctOfCapital: 0.015,
    minCanaryUsd: 3,
    maxCanaryUsd: 15,
    reserveFloorPct: 0.35,
    maxK: 2,
    diversity: Object.freeze({
      maxSameChain: 1,
      maxSameProtocol: 1,
      maxSameFamily: 1,
    }),
  }),
  aggressive_calibrated: Object.freeze({
    id: "aggressive_calibrated",
    canaryPctOfCapital: 0.04,
    minCanaryUsd: 5,
    maxCanaryUsd: 30,
    reserveFloorPct: 0.22,
    maxK: 6,
    diversity: Object.freeze({
      maxSameChain: 1,
      maxSameProtocol: 1,
      maxSameFamily: 2,
    }),
  }),
});

export const DEFAULT_AGGRESSION_PROFILE_ID = "aggressive_calibrated";

export function resolveAggressionProfile(profile = DEFAULT_AGGRESSION_PROFILE_ID) {
  if (typeof profile === "string") return AGGRESSION_PROFILES[profile] || AGGRESSION_PROFILES[DEFAULT_AGGRESSION_PROFILE_ID];
  if (profile?.id) return { ...AGGRESSION_PROFILES[profile.id], ...profile };
  return AGGRESSION_PROFILES[DEFAULT_AGGRESSION_PROFILE_ID];
}
