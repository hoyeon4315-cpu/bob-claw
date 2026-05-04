// src/status/sleeve-profile-slice.mjs
// Emits current sleeve profile status and resolved cap matrix

import { getSleeveProfConfig } from "../config/sleeve-profile.mjs";

export async function emitSleeveProfileSlice() {
  const profile = getSleeveProfConfig();

  const slice = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    activeProfile: profile.activeProfile,
    profileConfig: {
      btcFloorPct: profile.btcFloorPct,
      anchorPct: profile.anchorPct,
      opportunisticPct: profile.opportunisticPct,
      microTestPct: profile.microTestPct,
      perProtocolMaxPct: profile.perProtocolMaxPct,
      perChainMaxPct: profile.perChainMaxPct,
    },
    capConstraints: {
      note: "Minimum of (profile cap, radar canary cap, strategy cap) wins",
      description: `Under ${profile.activeProfile}: ${profile.description}`,
    },
  };

  return slice;
}
