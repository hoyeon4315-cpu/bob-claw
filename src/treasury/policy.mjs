import { tokenAsset, ZERO_TOKEN, WBTC_OFT_TOKEN } from "../assets/tokens.mjs";
import { DESTINATION_REPRESENTATIVE_BINDINGS } from "../config/destination-representative-bindings.mjs";
import { deriveConfiguredActiveBudgetUsd } from "../config/strategy-caps.mjs";

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const BSC_USDC_TOKEN = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_USDT_TOKEN = "0x55d398326f99059fF775485246999027B3197955";
const ETHEREUM_USDC_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETHEREUM_USDT_TOKEN = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETHEREUM_RLUSD_TOKEN = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";
const GATEWAY_DESTINATION_CHAINS = Object.freeze([
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
const MERKL_PORTFOLIO_REFILL_POLICY = {
  id: "merkl_portfolio_stable_carry_refill",
  category: "yield",
  economicsMode: "holding_period_carry",
  strategyType: "merkl_portfolio_stable_carry",
  actionType: "treasury_refill_for_yield",
  perTradeCapUsd: 75,
};
const REPRESENTATIVE_STABLE_REFILL_POLICY = {
  ...MERKL_PORTFOLIO_REFILL_POLICY,
  id: "destination_representative_stable_refill",
  strategyType: "destination_representative_stable_carry",
  perTradeCapUsd: 3,
};
const EXPLICIT_REPRESENTATIVE_FLOAT_CHAINS = new Set(["ethereum", "base", "bsc"]);

function normalizedAddress(value) {
  return String(value || "").toLowerCase();
}

function parseDecimalParts(value) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }
  const [whole, fraction = ""] = text.split(".");
  return { whole, fraction };
}

export function decimalToUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  const { whole, fraction } = parseDecimalParts(value);
  if (fraction.length > decimals) {
    throw new Error(`Too many fractional digits for ${decimals} decimals: ${value}`);
  }
  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction || ""}`);
}

function assertThresholdOrder(label, policy) {
  const min = decimalToUnits(policy.minBalance, policy.decimals);
  const target = decimalToUnits(policy.targetBalance, policy.decimals);
  const max = decimalToUnits(policy.maxBalance, policy.decimals);
  if (!(min <= target && target <= max)) {
    throw new Error(`${label} thresholds must satisfy min <= target <= max`);
  }
}

function nativePolicy(chain, overrides = {}) {
  const native = tokenAsset(chain, ZERO_TOKEN);
  return {
    chain,
    asset: native.ticker,
    token: ZERO_TOKEN,
    decimals: native.decimals,
    enabled: false,
    minBalance: "0",
    targetBalance: "0",
    maxBalance: "0",
    rationale: "inactive chain",
    ...overrides,
  };
}

function tokenPolicy(chain, token, overrides = {}) {
  const asset = tokenAsset(chain, token);
  return {
    chain,
    token,
    ticker: asset.ticker,
    decimals: asset.decimals,
    enabled: true,
    minBalance: "0",
    targetBalance: "0",
    maxBalance: "0",
    rationale: "",
    ...overrides,
  };
}

function gatewayWbtcPolicy(chain, overrides = {}) {
  return tokenPolicy(chain, WBTC_OFT_TOKEN, {
    minBalance: "0.00003",
    targetBalance: "0.0001",
    maxBalance: "0.0005",
    rationale: "Tiny all-chain Gateway wrapped-BTC buffer for automated route proof, canary prep, and payback return-path validation.",
    ...overrides,
  });
}

function destinationRepresentativeStableInventoryPolicies() {
  return Object.values(DESTINATION_REPRESENTATIVE_BINDINGS)
    .filter((binding) => !EXPLICIT_REPRESENTATIVE_FLOAT_CHAINS.has(binding.chain))
    .map((binding) => tokenPolicy(binding.chain, binding.assetAddress, {
      ticker: binding.assetSymbol,
      decimals: binding.assetDecimals,
      minBalance: "1",
      targetBalance: "4",
      maxBalance: "12",
      rationale: `Representative ${binding.assetSymbol} buffer for ${binding.chain} live-capital validation; capital manager may refill this before the destination representative autopilot deploys the capped canary.`,
      strategyPolicy: {
        ...REPRESENTATIVE_STABLE_REFILL_POLICY,
        perTradeCapUsd: binding.maxCanaryUsd,
      },
    }));
}

export function buildDefaultTreasuryPolicy({ walletTotalUsd = null } = {}) {
  const activeBudgetUsd = Number.isFinite(walletTotalUsd) && walletTotalUsd > 0
    ? walletTotalUsd
    : deriveConfiguredActiveBudgetUsd();
  const nativeBalances = {
    bob: nativePolicy("bob", {
      enabled: true,
      minBalance: "0.002",
      targetBalance: "0.005",
      maxBalance: "0.02",
      rationale: "Primary Gateway source chain for current canary-prep routes.",
    }),
    base: nativePolicy("base", {
      enabled: true,
      minBalance: "0.0015",
      targetBalance: "0.004",
      maxBalance: "0.015",
      rationale: "Reverse BTC-family route candidate and likely first secondary active chain.",
    }),
    avalanche: nativePolicy("avalanche", {
      enabled: true,
      minBalance: "0.02",
      targetBalance: "0.05",
      maxBalance: "0.5",
      rationale: "Gateway destination chain; keep AVAX gas ready for automated canary, refill, and unwind receipts.",
    }),
    bera: nativePolicy("bera", {
      enabled: true,
      minBalance: "0.005",
      targetBalance: "0.01",
      maxBalance: "0.05",
      rationale: "Gateway expansion chain; bootstrap native gas is required before routed inventory can be used.",
    }),
    bsc: nativePolicy("bsc", {
      enabled: true,
      minBalance: "0.0005",
      targetBalance: "0.001",
      maxBalance: "0.005",
      rationale: "Gateway expansion chain; keep a tiny BNB float so routed BTC inventory is not stranded.",
    }),
    ethereum: nativePolicy("ethereum", {
      enabled: true,
      minBalance: "0.002",
      targetBalance: "0.004",
      maxBalance: "0.015",
      rationale: "Ethereum L1 is allowed when measured execution remains positive after gas and slippage.",
    }),
    optimism: nativePolicy("optimism", {
      enabled: true,
      minBalance: "0.0005",
      targetBalance: "0.001",
      maxBalance: "0.005",
      rationale: "Gateway destination chain; bootstrap ETH gas should be maintained when route demand appears.",
    }),
    sei: nativePolicy("sei", {
      enabled: true,
      minBalance: "0.5",
      targetBalance: "1",
      maxBalance: "10",
      rationale: "Gateway destination chain; bootstrap SEI gas is required before routed inventory can be used.",
    }),
    soneium: nativePolicy("soneium", {
      enabled: true,
      minBalance: "0.0005",
      targetBalance: "0.001",
      maxBalance: "0.005",
      rationale: "Gateway expansion chain; bootstrap ETH gas should be maintained when route demand appears.",
    }),
    sonic: nativePolicy("sonic", {
      enabled: true,
      minBalance: "2",
      targetBalance: "5",
      maxBalance: "150",
      rationale: "Gateway destination chain; keep a small S gas float so routed inventory is not stranded.",
    }),
    unichain: nativePolicy("unichain", {
      enabled: true,
      minBalance: "0.0005",
      targetBalance: "0.001",
      maxBalance: "0.005",
      rationale: "Gateway expansion chain; bootstrap ETH gas should be maintained when route demand appears.",
    }),
  };

  return {
    schemaVersion: 1,
    walletMode: "single_wallet",
    capital: {
      activeBudgetUsd,
      referenceBudgetUsd: activeBudgetUsd,
      canaryStartUsdMin: 20,
      canaryStartUsdMax: 50,
      maxIdleCapitalPerChainUsd: 60,
      fragmentationDragPct: 0.005,
      maxRefillCost24hUsd: 12,
    },
    supportedChains: GATEWAY_DESTINATION_CHAINS,
    activeChains: GATEWAY_DESTINATION_CHAINS,
    nativeBalances,
    tokenInventories: [
      gatewayWbtcPolicy("ethereum"),
      gatewayWbtcPolicy("bob", {
        minBalance: "0.0001",
        targetBalance: "0.0003",
        maxBalance: "0.001",
        rationale: "Current 10k sat canary-prep route plus retry margin.",
      }),
      gatewayWbtcPolicy("base", {
        minBalance: "0.0001",
        targetBalance: "0.0003",
        maxBalance: "0.001",
        rationale: "Keeps reverse-route readiness without overfunding.",
      }),
      gatewayWbtcPolicy("bsc"),
      gatewayWbtcPolicy("avalanche"),
      gatewayWbtcPolicy("unichain"),
      gatewayWbtcPolicy("bera"),
      gatewayWbtcPolicy("optimism"),
      gatewayWbtcPolicy("soneium"),
      gatewayWbtcPolicy("sei"),
      gatewayWbtcPolicy("sonic"),
      tokenPolicy("base", BASE_USDC_TOKEN, {
        minBalance: "25",
        targetBalance: "68",
        maxBalance: "150",
        rationale: "Merkl portfolio live-capital validation float on Base; refill cost is evaluated as holding-period carry, not same-tick route alpha.",
        strategyPolicy: MERKL_PORTFOLIO_REFILL_POLICY,
      }),
      tokenPolicy("base", BASE_CBTC_TOKEN, {
        minBalance: "0",
        targetBalance: "0.001",
        maxBalance: "0.005",
        rationale: "Moonwell wrapped-BTC lending loop collateral on Base.",
      }),
      tokenPolicy("ethereum", ETHEREUM_USDC_TOKEN, {
        minBalance: "25",
        targetBalance: "90",
        maxBalance: "150",
        rationale: "Ethereum Morpho/YO Merkl stable-carry inventory; routed from BSC stablecoin float when live-capital validation is active.",
        strategyPolicy: {
          ...MERKL_PORTFOLIO_REFILL_POLICY,
          perTradeCapUsd: 100,
        },
      }),
      tokenPolicy("ethereum", ETHEREUM_USDT_TOKEN, {
        minBalance: "25",
        targetBalance: "60",
        maxBalance: "100",
        rationale: "Ethereum Morpho USDT vault inventory for Steakhouse and related Merkl stable-carry campaigns.",
        strategyPolicy: MERKL_PORTFOLIO_REFILL_POLICY,
      }),
      tokenPolicy("ethereum", ETHEREUM_RLUSD_TOKEN, {
        minBalance: "10",
        targetBalance: "35",
        maxBalance: "75",
        rationale: "Ethereum Euler/Aave RLUSD Merkl inventory; smaller cap until RLUSD entry and exit receipts are live-proven.",
        strategyPolicy: {
          ...MERKL_PORTFOLIO_REFILL_POLICY,
          perTradeCapUsd: 35,
        },
      }),
      tokenPolicy("bsc", BSC_USDC_TOKEN, {
        minBalance: "1",
        targetBalance: "3",
        maxBalance: "50",
        rationale: "Tiny BSC stablecoin settlement buffer; larger stable deployment requires a committed strategy cap and measured route.",
      }),
      tokenPolicy("bsc", BSC_USDT_TOKEN, {
        minBalance: "1",
        targetBalance: "3",
        maxBalance: "50",
        rationale: "Tiny BSC stablecoin settlement buffer; larger stable deployment requires a committed strategy cap and measured route.",
      }),
      ...destinationRepresentativeStableInventoryPolicies(),
    ],
    allowanceCaps: [
      {
        chain: "bob",
        token: WBTC_OFT_TOKEN,
        spender: normalizedAddress(WBTC_OFT_TOKEN),
        mode: "self_send_or_exact_only",
        maxApproval: "0.0003",
        rationale: "Current OFT self-send route should avoid unlimited approvals.",
      },
    ],
    refillPolicy: {
      requireActiveChain: false,
      requireRouteDemandSignal: false,
      maxPendingJobs: 24,
      minHoursBetweenRefillsPerChain: 6,
      maxSingleRefillCostUsd: 0.5,
      skipIfWalletValueBelowUsd: 0,
      enableDexRefill: true,
      enableCrossChainRefill: true,
      enableGasRefuelFallback: true,
    },
  };
}

export function referenceBudgetUsd(policy = null) {
  const value = Number(policy?.capital?.referenceBudgetUsd);
  return Number.isFinite(value) ? value : null;
}

export function validateTreasuryPolicy(policy) {
  if (!policy || typeof policy !== "object") throw new Error("Policy is required");
  if (!Array.isArray(policy.supportedChains) || policy.supportedChains.length === 0) {
    throw new Error("Policy must define at least one supported chain");
  }
  if (!Array.isArray(policy.activeChains) || policy.activeChains.length === 0) {
    throw new Error("Policy must define at least one active chain");
  }

  for (const chain of policy.activeChains) {
    if (!policy.supportedChains.includes(chain)) {
      throw new Error(`Active chain must also be supported: ${chain}`);
    }
    if (!policy.nativeBalances?.[chain]?.enabled) {
      throw new Error(`Active chain must have enabled native balance policy: ${chain}`);
    }
  }

  for (const [chain, native] of Object.entries(policy.nativeBalances || {})) {
    if (!native.enabled) continue;
    assertThresholdOrder(`native ${chain}`, native);
  }

  for (const item of policy.tokenInventories || []) {
    if (!item.enabled) continue;
    assertThresholdOrder(`token ${item.chain}:${item.token}`, item);
  }

  for (const allowance of policy.allowanceCaps || []) {
    const asset = tokenAsset(allowance.chain, allowance.token);
    decimalToUnits(allowance.maxApproval, asset.decimals);
    if (!allowance.spender) {
      throw new Error(`Allowance cap missing spender for ${allowance.chain}:${allowance.token}`);
    }
  }

  return policy;
}

export function getNativeBalancePolicy(policy, chain) {
  return policy.nativeBalances?.[chain] || null;
}

export function listSupportedChains(policy) {
  return [...(policy.supportedChains || [])];
}

export function getTokenInventoryPolicy(policy, chain, token) {
  return (
    (policy.tokenInventories || []).find(
      (item) => item.chain === chain && normalizedAddress(item.token) === normalizedAddress(token),
    ) || null
  );
}

export function getAllowanceCapPolicy(policy, chain, token, spender) {
  return (
    (policy.allowanceCaps || []).find(
      (item) =>
        item.chain === chain &&
        normalizedAddress(item.token) === normalizedAddress(token) &&
        normalizedAddress(item.spender) === normalizedAddress(spender),
    ) || null
  );
}

export function nativeThresholdUnits(policy, chain) {
  const item = getNativeBalancePolicy(policy, chain);
  if (!item) return null;
  return {
    minBalance: decimalToUnits(item.minBalance, item.decimals).toString(),
    targetBalance: decimalToUnits(item.targetBalance, item.decimals).toString(),
    maxBalance: decimalToUnits(item.maxBalance, item.decimals).toString(),
  };
}

export function tokenThresholdUnits(policy, chain, token) {
  const item = getTokenInventoryPolicy(policy, chain, token);
  if (!item) return null;
  return {
    minBalance: decimalToUnits(item.minBalance, item.decimals).toString(),
    targetBalance: decimalToUnits(item.targetBalance, item.decimals).toString(),
    maxBalance: decimalToUnits(item.maxBalance, item.decimals).toString(),
  };
}
