// Gas.Zip fallback policy.
//
// Purpose: native-gas bootstrap / refill only. Strategy capital and payback
// lanes are NEVER allowed on this path. Any caller that passes a
// non-native refill action is rejected up-front.
//
// Rationale: see archived vendor review 2026-04-20 — official docs cap
// direct deposits at ~$50 per destination chain and document per-chain
// deposit addresses. We treat Gas.Zip as a last-mile gas top-up only and
// enforce the cap here in committed config so it cannot be raised at runtime.

const GAS_ZIP_DIRECT_DEPOSIT_ADDRESS = "0x391E7C679d29bD940d63be94AD22A25d25b5A604";
const GAS_ZIP_DEFAULT_CONTRACT_ADDRESS = "0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762";

export const GAS_ZIP_INBOUND_CHAINS = Object.freeze({
  ethereum: Object.freeze({
    chainId: 1,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://etherscan.io",
  }),
  optimism: Object.freeze({
    chainId: 10,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://optimistic.etherscan.io",
  }),
  avalanche: Object.freeze({
    chainId: 43114,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://snowtrace.io",
  }),
  base: Object.freeze({
    chainId: 8453,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://basescan.org",
  }),
  bsc: Object.freeze({
    chainId: 56,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://bscscan.com",
  }),
  sonic: Object.freeze({
    chainId: 146,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://sonicscan.org",
  }),
  sei: Object.freeze({
    chainId: 1329,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: "0x3ac2cD998cB96a699f88C3C665abC767A9800cc8",
    explorerUrl: "https://www.seiscan.app/pacific-1",
  }),
  soneium: Object.freeze({
    chainId: 1868,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://soneium.blockscout.com",
  }),
  bera: Object.freeze({
    chainId: 80094,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://berascan.com",
  }),
  unichain: Object.freeze({
    chainId: 130,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://uniscan.xyz",
  }),
  bob: Object.freeze({
    chainId: 60808,
    directAddress: GAS_ZIP_DIRECT_DEPOSIT_ADDRESS,
    contractAddress: GAS_ZIP_DEFAULT_CONTRACT_ADDRESS,
    explorerUrl: "https://explorer.gobob.xyz",
  }),
});

export const GAS_ZIP_OUTBOUND_CHAINS = Object.freeze({
  ethereum: Object.freeze({ chainId: 1, shortId: 255 }),
  bob: Object.freeze({ chainId: 60808, shortId: 150 }),
  base: Object.freeze({ chainId: 8453, shortId: 54 }),
  bsc: Object.freeze({ chainId: 56, shortId: 14 }),
  avalanche: Object.freeze({ chainId: 43114, shortId: 15 }),
  unichain: Object.freeze({ chainId: 130, shortId: 362 }),
  bera: Object.freeze({ chainId: 80094, shortId: 143 }),
  optimism: Object.freeze({ chainId: 10, shortId: 55 }),
  soneium: Object.freeze({ chainId: 1868, shortId: 414 }),
  sei: Object.freeze({ chainId: 1329, shortId: 246 }),
  sonic: Object.freeze({ chainId: 146, shortId: 389 }),
});

export const GAS_ZIP_DEFAULT_POLICY = Object.freeze({
  enabled: true,
  apiBase: "https://backend.gas.zip/v2",
  purpose: "native_gas_only",
  perJobMaxRefuelUsd: 10,
  perChainDailyMaxRefuelUsd: 25,
  perChainMaxOpenJobs: 1,
  vendorSingleTxCapUsd: 50,
  supportedDstChains: Object.freeze(Object.keys(GAS_ZIP_OUTBOUND_CHAINS)),
  requireDestinationNativeDelta: true,
  forbiddenRefillTypes: Object.freeze(["refill_token"]),
  inboundChains: GAS_ZIP_INBOUND_CHAINS,
  outboundChains: GAS_ZIP_OUTBOUND_CHAINS,
});

export function isGasZipSupportedChain(chain, policy = GAS_ZIP_DEFAULT_POLICY) {
  return (policy?.supportedDstChains || []).includes(String(chain || "").toLowerCase());
}

export function gasZipInboundChain(chain, policy = GAS_ZIP_DEFAULT_POLICY) {
  return policy?.inboundChains?.[String(chain || "").toLowerCase()] || null;
}

export function gasZipOutboundChain(chain, policy = GAS_ZIP_DEFAULT_POLICY) {
  return policy?.outboundChains?.[String(chain || "").toLowerCase()] || null;
}

export function gasZipAcceptsAction(action, policy = GAS_ZIP_DEFAULT_POLICY) {
  if (!policy?.enabled) return { accepted: false, reason: "gas_zip_disabled" };
  if (!action || action.type !== "refill_native") {
    return { accepted: false, reason: "gas_zip_non_native_refill_forbidden" };
  }
  if ((policy.forbiddenRefillTypes || []).includes(action.type)) {
    return { accepted: false, reason: "gas_zip_forbidden_refill_type" };
  }
  if (!isGasZipSupportedChain(action.chain, policy)) {
    return { accepted: false, reason: "gas_zip_unsupported_destination" };
  }
  if (!gasZipOutboundChain(action.chain, policy)) {
    return { accepted: false, reason: "gas_zip_destination_config_missing" };
  }
  const estimatedUsd = Number(action.refillEstimatedUsd);
  if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) {
    return { accepted: false, reason: "gas_zip_estimated_usd_missing" };
  }
  if (estimatedUsd > policy.perJobMaxRefuelUsd) {
    return { accepted: false, reason: "gas_zip_per_job_cap_exceeded" };
  }
  if (estimatedUsd > policy.vendorSingleTxCapUsd) {
    return { accepted: false, reason: "gas_zip_vendor_cap_exceeded" };
  }
  return { accepted: true, reason: null };
}

export function gasZipQuoteUrl({
  srcChain,
  dstChain,
  amountWei,
  recipient,
  senderAddress = null,
  policy = GAS_ZIP_DEFAULT_POLICY,
} = {}) {
  const inbound = gasZipInboundChain(srcChain, policy);
  const outbound = gasZipOutboundChain(dstChain, policy);
  if (!inbound) throw new Error(`Unsupported Gas.Zip inbound chain: ${srcChain}`);
  if (!outbound) throw new Error(`Unsupported Gas.Zip outbound chain: ${dstChain}`);
  const params = new URLSearchParams({ to: recipient });
  if (senderAddress) params.set("from", senderAddress);
  return `${policy.apiBase}/quotes/${inbound.chainId}/${amountWei}/${outbound.chainId}?${params.toString()}`;
}
