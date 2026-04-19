import { JsonRpcProvider, keccak256 } from "ethers";
import { WBTC_OFT_TOKEN } from "../assets/tokens.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "./wrapped-btc-loop-bindings.mjs";

export const PROTOCOL_CODEHASH_WATCH_SCHEMA_VERSION = 1;

const DEFAULT_WBTC_OFT_CHAINS = Object.freeze(["base", "bob", "soneium"]);

function normalizeAddress(address) {
  return String(address || "").toLowerCase();
}

function isHexCode(value) {
  return /^0x(?:[a-fA-F0-9]{2})*$/.test(String(value || ""));
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function defaultMoonwellTargets() {
  const support = resolveWrappedBtcLoopBindingSupport({
    strategyConfig: {
      chain: "base",
      protocol: "moonwell",
      collateralAsset: "cbBTC",
      borrowAsset: "USDC",
    },
  });
  const contracts = support.knownContracts || {};
  return [
    {
      id: "moonwell_base_comptroller",
      label: "Moonwell Base Comptroller",
      protocol: "moonwell",
      chain: "base",
      address: contracts.comptroller?.address,
      source: contracts.comptroller?.source || null,
      criticality: "strategy_primary",
    },
    {
      id: "moonwell_base_mtoken_cbbtc",
      label: "Moonwell Base cbBTC mToken",
      protocol: "moonwell",
      chain: "base",
      address: contracts.collateralMarket?.mTokenAddress,
      source: contracts.collateralMarket?.source || null,
      criticality: "strategy_primary",
    },
    {
      id: "moonwell_base_mtoken_usdc",
      label: "Moonwell Base USDC mToken",
      protocol: "moonwell",
      chain: "base",
      address: contracts.borrowMarket?.mTokenAddress,
      source: contracts.borrowMarket?.source || null,
      criticality: "strategy_primary",
    },
  ];
}

export function defaultProtocolCodehashTargets() {
  const gatewayTargets = DEFAULT_WBTC_OFT_CHAINS.map((chain) => ({
    id: `gateway_wbtc_oft_${chain}`,
    label: `Gateway wBTC.OFT on ${chain}`,
    protocol: "bob_gateway",
    chain,
    address: WBTC_OFT_TOKEN,
    criticality: "transport_primary",
  }));
  return [...defaultMoonwellTargets(), ...gatewayTargets].filter((target) => target.chain && target.address);
}

export function normalizeProtocolCodehashBaseline(baseline = null) {
  const items = Array.isArray(baseline?.items)
    ? baseline.items
    : Object.entries(baseline?.hashes || {}).map(([id, codehash]) => ({ id, codehash }));
  return new Map(
    items
      .filter((item) => item?.id && item?.codehash)
      .map((item) => [
        item.id,
        {
          id: item.id,
          codehash: String(item.codehash),
          blockNumber: item.blockNumber ?? null,
          observedAt: item.observedAt || baseline?.generatedAt || null,
        },
      ]),
  );
}

async function readTargetCode({ target, providerFactory }) {
  const chainConfig = getEvmChainConfig(target.chain);
  if (!chainConfig?.rpcUrl) {
    return {
      status: "rpc_missing",
      code: null,
      blockNumber: null,
      error: `missing_rpc_for_${target.chain}`,
    };
  }
  const provider = providerFactory
    ? providerFactory({ chain: target.chain, rpcUrl: chainConfig.rpcUrl, chainId: chainConfig.chainId, target })
    : new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId, { staticNetwork: true });
  const [code, blockNumber] = await Promise.all([
    provider.getCode(target.address),
    provider.getBlockNumber().catch(() => null),
  ]);
  return {
    status: "read",
    code,
    blockNumber,
    error: null,
  };
}

export async function observeProtocolCodehashTarget({ target, baseline = null, providerFactory = null, now = null } = {}) {
  const observedAt = now || new Date().toISOString();
  const normalizedAddress = normalizeAddress(target?.address);
  const base = {
    id: target?.id || null,
    label: target?.label || target?.id || null,
    protocol: target?.protocol || null,
    chain: target?.chain || null,
    address: normalizedAddress || null,
    criticality: target?.criticality || null,
    source: target?.source || null,
    observedAt,
    blockNumber: null,
    codehash: null,
    expectedCodehash: baseline?.codehash || null,
    status: "unknown",
    blockers: [],
  };

  if (!target?.id || !target?.chain || !normalizedAddress) {
    return {
      ...base,
      status: "invalid_target",
      blockers: ["invalid_codehash_target"],
    };
  }

  try {
    const result = await readTargetCode({ target: { ...target, address: normalizedAddress }, providerFactory });
    if (result.status !== "read") {
      return {
        ...base,
        status: result.status,
        blockers: [result.error || result.status],
        error: result.error || null,
      };
    }
    if (!isHexCode(result.code)) {
      return {
        ...base,
        blockNumber: result.blockNumber,
        status: "rpc_error",
        blockers: ["invalid_code_response"],
        error: "invalid_code_response",
      };
    }
    if (result.code === "0x") {
      return {
        ...base,
        blockNumber: result.blockNumber,
        status: "code_missing",
        blockers: ["contract_code_missing"],
      };
    }
    const codehash = keccak256(result.code);
    const status = !baseline?.codehash
      ? "baseline_missing"
      : baseline.codehash === codehash
        ? "matched"
        : "drift_detected";
    return {
      ...base,
      blockNumber: result.blockNumber,
      codehash,
      expectedCodehash: baseline?.codehash || null,
      status,
      blockers: status === "drift_detected" ? ["protocol_codehash_drift"] : [],
      baselineBlockNumber: baseline?.blockNumber ?? null,
      baselineObservedAt: baseline?.observedAt || null,
    };
  } catch (error) {
    return {
      ...base,
      status: "rpc_error",
      blockers: ["protocol_codehash_rpc_error"],
      error: error?.message || String(error),
    };
  }
}

export function summarizeProtocolCodehashObservations(items = []) {
  const statusCounts = items.reduce((counts, item) => {
    const status = item.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const blockingStatuses = new Set(["code_missing", "drift_detected", "invalid_target"]);
  const observeStatuses = new Set(["baseline_missing", "rpc_error", "rpc_missing"]);
  const blockedItems = items.filter((item) => blockingStatuses.has(item.status));
  const observeItems = items.filter((item) => observeStatuses.has(item.status));
  const topBlockers = items
    .flatMap((item) => item.blockers || [])
    .reduce((counts, blocker) => ({ ...counts, [blocker]: (counts[blocker] || 0) + 1 }), {});
  const status = blockedItems.length > 0 ? "blocked" : observeItems.length > 0 ? "observe" : "passed";
  return {
    targetCount: items.length,
    status,
    statusCounts,
    blockedCount: blockedItems.length,
    observeCount: observeItems.length,
    driftCount: statusCounts.drift_detected || 0,
    missingCodeCount: statusCounts.code_missing || 0,
    baselineMissingCount: statusCounts.baseline_missing || 0,
    rpcErrorCount: (statusCounts.rpc_error || 0) + (statusCounts.rpc_missing || 0),
    topBlockers: Object.entries(topBlockers)
      .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
      .map(([blocker, count]) => ({ blocker, count })),
    nextAction:
      blockedItems.length > 0
        ? { code: "review_protocol_codehash_drift", command: "npm run report:protocol-codehash-watch -- --json" }
        : (statusCounts.baseline_missing || 0) > 0
          ? { code: "seed_protocol_codehash_baseline", command: "npm run report:protocol-codehash-watch -- --write-baseline" }
          : observeItems.length > 0
            ? { code: "retry_protocol_codehash_watch", command: "npm run report:protocol-codehash-watch -- --write" }
            : null,
  };
}

export async function buildProtocolCodehashWatch({
  targets = defaultProtocolCodehashTargets(),
  baseline = null,
  providerFactory = null,
  now = null,
} = {}) {
  const generatedAt = now || new Date().toISOString();
  const baselineById = normalizeProtocolCodehashBaseline(baseline);
  const items = await Promise.all(
    (targets || []).map((target) =>
      observeProtocolCodehashTarget({
        target,
        baseline: baselineById.get(target.id) || null,
        providerFactory,
        now: generatedAt,
      }),
    ),
  );
  const summary = summarizeProtocolCodehashObservations(items);
  return {
    schemaVersion: PROTOCOL_CODEHASH_WATCH_SCHEMA_VERSION,
    generatedAt,
    summary,
    items,
  };
}

export function buildProtocolCodehashBaseline({ watch = null, now = null } = {}) {
  const generatedAt = now || new Date().toISOString();
  const eligibleItems = (watch?.items || []).filter((item) => item.codehash && item.status !== "code_missing");
  return {
    schemaVersion: PROTOCOL_CODEHASH_WATCH_SCHEMA_VERSION,
    generatedAt,
    itemCount: eligibleItems.length,
    items: eligibleItems.map((item) => ({
      id: item.id,
      label: item.label,
      protocol: item.protocol,
      chain: item.chain,
      address: item.address,
      codehash: item.codehash,
      blockNumber: item.blockNumber ?? null,
      observedAt: item.observedAt || watch?.generatedAt || generatedAt,
    })),
    targetIds: unique(eligibleItems.map((item) => item.id)),
  };
}
