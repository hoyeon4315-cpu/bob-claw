// P1 — Official 11-chain parity floor slice.
//
// Exposes every Gateway official destination chain with the same vocabulary:
//   wrapped-BTC venue status, stable venue status, native/ETH arrival class,
//   strategy surface presence, current maturity, top blocker.
//
// Pure function. No I/O.

import {
  WRAPPED_BTC_VENUES,
  getWrappedBtcVenues,
} from "../config/destination-venues.mjs";
import { STABLE_VENUES, getStableVenues } from "../config/stable-venues.mjs";
import { STRATEGY_CAPS } from "../config/strategy-caps.mjs";

const OFFICIAL_11_CHAINS = Object.freeze([
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "bera",
  "optimism",
  "soneium",
  "sei",
  "sonic",
]);

function chainStrategiesTouching(chainId) {
  return Object.values(STRATEGY_CAPS).filter((cap) => {
    const perChains = Object.keys(cap.caps?.perChainUsd || {});
    const gasChains = Object.keys(cap.gasFloat || {});
    return perChains.includes(chainId) || gasChains.includes(chainId);
  });
}

export function buildChainParitySlice() {
  const chains = OFFICIAL_11_CHAINS.map((chainId) => {
    const wrapped = getWrappedBtcVenues(chainId);
    const stable = getStableVenues(chainId);
    const touching = chainStrategiesTouching(chainId);
    const hasArrival = touching.length > 0;

    const wrappedStatus = wrapped
      ? wrapped.status === "template_only"
        ? "template_only"
        : wrapped.venues?.length > 0
          ? "confirmed"
          : "scaffolded"
      : "unregistered";

    const stableStatus = stable
      ? stable.status === "template_only"
        ? "template_only"
        : stable.venues?.length > 0
          ? "confirmed"
          : "scaffolded"
      : "unregistered";

    let maturity = "confirmed";
    const blockers = [];

    if (wrappedStatus === "template_only") {
      maturity = "template_only";
      blockers.push(...(wrapped.blockers || []));
    }
    if (stableStatus === "template_only") {
      maturity = "template_only";
      blockers.push(...(stable.blockers || []));
    }
    if (wrappedStatus === "unregistered" && stableStatus === "unregistered") {
      if (hasArrival) {
        maturity = "scaffolded";
        blockers.push("venue_registry_missing_but_caps_exist");
      } else {
        maturity = "unregistered";
        blockers.push("no_venue_registry_entry");
      }
    } else if (
      (wrappedStatus === "unregistered" || wrappedStatus === "scaffolded") &&
      (stableStatus === "unregistered" || stableStatus === "scaffolded")
    ) {
      maturity = "scaffolded";
      blockers.push("venue_not_confirmed");
    }

    const uniqueBlockers = [...new Set(blockers)];

    return Object.freeze({
      chainId,
      wrappedBtcVenueStatus: wrappedStatus,
      stableVenueStatus: stableStatus,
      nativeEthArrivalClass: hasArrival ? "arrival_configured" : "no_arrival_configured",
      strategySurfacePresence: touching.length,
      currentMaturity: maturity,
      topBlocker: uniqueBlockers[0] || null,
      blockers: uniqueBlockers,
    });
  });

  return Object.freeze({
    officialChainCount: OFFICIAL_11_CHAINS.length,
    chains,
    byChain: Object.freeze(Object.fromEntries(chains.map((c) => [c.chainId, c]))),
    generatedAt: new Date().toISOString(),
  });
}
