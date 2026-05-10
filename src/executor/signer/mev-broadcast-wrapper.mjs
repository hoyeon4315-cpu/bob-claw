// MEV-protected broadcast wrapper — optionally routes signer commands through
// MEV protection (e.g., Flashbots Protect) by prepending a flag.
//
// Falls back to the normal broadcast path when protection is unavailable
// for the target chain.

import { sendSignerCommand } from "./client.mjs";

const DEFAULT_MEV_SUPPORTED_CHAINS = new Set(["ethereum"]);

export function featureEnabled(profile = {}) {
  return profile.mevBroadcastWrapper !== false;
}

function isMevSupportedChain(chain, supportedChains = DEFAULT_MEV_SUPPORTED_CHAINS) {
  return supportedChains.has(chain);
}

export async function sendMevProtectedBroadcast({
  message,
  socketPath,
  timeoutMs,
  mevProtectionEnabled,
  sendCommand = sendSignerCommand,
} = {}) {
  if (!featureEnabled()) {
    return sendCommand({ message, socketPath, timeoutMs });
  }

  if (!mevProtectionEnabled) {
    return sendCommand({ message, socketPath, timeoutMs });
  }

  const chain = message?.chain || message?.intent?.chain;
  if (!chain || !isMevSupportedChain(chain)) {
    return sendCommand({ message, socketPath, timeoutMs });
  }

  const protectedMessage = { ...message, mev_protected: true };
  return sendCommand({ message: protectedMessage, socketPath, timeoutMs });
}
