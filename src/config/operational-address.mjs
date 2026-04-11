import { config } from "./env.mjs";
import { resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";

export async function resolveOperationalAddress({
  explicitAddress = null,
  configuredAddress = config.estimateFrom,
  dataDir = config.dataDir,
} = {}) {
  const context = await resolveShadowCycleContext({
    dataDir,
    explicitAddress,
    configuredAddress,
  });

  return {
    address: context.address || configuredAddress || config.verifyRecipient,
    source: context.addressSource,
    audit: context.addressAudit,
  };
}
