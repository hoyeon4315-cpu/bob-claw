import { odosRoutingConfig } from "../../src/dex/odos.mjs";

export function trustedOdosQuote(overrides = {}) {
  const chain = overrides.chain || "base";
  const routing = odosRoutingConfig(chain);
  return {
    provider: "odos",
    sourceWhitelist: routing.sourceWhitelist,
    sourceBlacklist: routing.sourceBlacklist,
    routingMode: routing.routingMode,
    executionTrust: routing.executionTrust,
    ...overrides,
  };
}
