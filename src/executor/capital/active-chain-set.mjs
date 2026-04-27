import { listStrategyCaps } from "../../config/strategy-caps.mjs";

export function activeChains(strategyCaps = listStrategyCaps()) {
  const chains = new Set();
  for (const strategy of strategyCaps || []) {
    if (strategy?.autoExecute !== true) continue;
    for (const [chain, capUsd] of Object.entries(strategy?.caps?.perChainUsd || {})) {
      if (Number.isFinite(capUsd) && capUsd > 0) chains.add(chain);
    }
  }
  return [...chains].sort((left, right) => left.localeCompare(right));
}

export function activeChainSet(strategyCaps = listStrategyCaps()) {
  return new Set(activeChains(strategyCaps));
}
