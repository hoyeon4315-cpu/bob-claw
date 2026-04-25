import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const MTOKEN_INTERFACE = new Interface([
  "function mint(uint256 mintAmount)",
  "function borrow(uint256 borrowAmount)",
  "function repayBorrow(uint256 repayAmount)",
  "function redeemUnderlying(uint256 redeemAmount)",
]);

const COMPTROLLER_INTERFACE = new Interface([
  "function enterMarkets(address[] mTokens)",
]);

const DEFAULT_MINT_GAS_UNITS = 360_000;
const DEFAULT_BORROW_GAS_UNITS = 280_000;
const DEFAULT_APPROVE_GAS_UNITS = 80_000;
const DEFAULT_ENTER_MARKETS_GAS_UNITS = 120_000;

function assertAddress(value, label) {
  const normalized = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/u.test(normalized)) throw new Error(`${label} must be an EVM address`);
  return normalized;
}

function toPositiveIntegerString(value, label) {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new Error(`${label} must be a positive integer`);
    return value.toString();
  }
  const normalized = String(value ?? "").trim();
  if (!/^[0-9]+$/u.test(normalized) || normalized === "0") throw new Error(`${label} must be a positive integer`);
  return normalized;
}

function gasLimitWithFallback(gas, fallbackUnits, gasBufferBps) {
  const units = Number(gas?.gasUnits);
  const baseUnits = Number.isFinite(units) && units > 0 ? Math.ceil(units) : fallbackUnits;
  return String(applyGasBuffer(baseUnits, gasBufferBps));
}

function buildIntent({ strategyId, chain, amountUsd, now, ttlMs, intentType, tx, approval = null, metadata = {} }) {
  return {
    strategyId,
    chain,
    family: "evm",
    intentType,
    amountUsd,
    mode: "live",
    observedAt: now,
    executionReason: "strategy_execution",
    approval,
    tx,
    strategyConfig: {
      intentTtlMs: ttlMs,
    },
    metadata: {
      skipAutoIngest: true,
      ...metadata,
    },
  };
}

/**
 * Build a minimal Moonwell deposit + borrow intent for the wrapped-BTC loop.
 * This is a single iteration (no swap re-loop) — it deposits cbBTC collateral
 * and borrows USDC against it. Real calldata, no placeholders.
 *
 * @param {object} opts
 * @param {string} opts.strategyId
 * @param {string} opts.chain — must be "base" for now
 * @param {number} opts.amountUsd
 * @param {string} opts.collateralUnits — cbBTC units as integer string
 * @param {string} opts.borrowUnits — USDC units as integer string
 * @param {string} opts.collateralAssetAddress — cbBTC address
 * @param {string} opts.borrowAssetAddress — USDC address
 * @param {string} opts.collateralMTokenAddress
 * @param {string} opts.borrowMTokenAddress
 * @param {string} opts.comptrollerAddress
 * @param {number} [opts.gasBufferBps]
 * @param {string} [opts.now]
 */
export async function buildMoonwellWrappedBtcLoopIntent({
  strategyId = "wrapped-btc-loop-base-moonwell",
  chain = "base",
  amountUsd = 0,
  collateralUnits,
  borrowUnits,
  collateralAssetAddress,
  borrowAssetAddress,
  collateralMTokenAddress,
  borrowMTokenAddress,
  comptrollerAddress,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
  estimateGasImpl = estimateGas,
} = {}) {
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported chain: ${chain}`);
  const strategyCaps = assertStrategyCaps(strategyId);
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);

  const collateralAsset = assertAddress(collateralAssetAddress, "collateralAssetAddress");
  const collateralMToken = assertAddress(collateralMTokenAddress, "collateralMTokenAddress");
  const borrowMToken = assertAddress(borrowMTokenAddress, "borrowMTokenAddress");
  const comptroller = assertAddress(comptrollerAddress, "comptrollerAddress");
  const normalizedCollateral = toPositiveIntegerString(collateralUnits, "collateralUnits");
  const normalizedBorrow = borrowUnits ? toPositiveIntegerString(borrowUnits, "borrowUnits") : null;

  const senderAddress = strategyCaps.operatorAddress || null;

  let approveGas = null;
  try {
    approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: collateralAsset,
        data: ERC20_INTERFACE.encodeFunctionData("approve", [collateralMToken, normalizedCollateral]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    approveGas = { gasUnits: DEFAULT_APPROVE_GAS_UNITS };
  }

  let enterMarketsGas = null;
  try {
    enterMarketsGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: comptroller,
        data: COMPTROLLER_INTERFACE.encodeFunctionData("enterMarkets", [[collateralMToken, borrowMToken]]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    enterMarketsGas = { gasUnits: DEFAULT_ENTER_MARKETS_GAS_UNITS };
  }

  let mintGas = null;
  try {
    mintGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: collateralMToken,
        data: MTOKEN_INTERFACE.encodeFunctionData("mint", [normalizedCollateral]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    mintGas = { gasUnits: DEFAULT_MINT_GAS_UNITS };
  }

  const steps = [
    {
      id: "approve_collateral_to_mtoken",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: collateralAsset,
          spender: collateralMToken,
          amount: normalizedCollateral,
          mode: "per_tx",
        },
        tx: {
          to: collateralAsset,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [collateralMToken, normalizedCollateral]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          protocol: "moonwell",
          collateralAsset,
          collateralMToken,
          comptroller,
        },
      }),
    },
    {
      id: "enter_markets",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "comptroller_enter_markets",
        tx: {
          to: comptroller,
          data: COMPTROLLER_INTERFACE.encodeFunctionData("enterMarkets", [[collateralMToken, borrowMToken]]),
          value: "0",
          gasLimit: gasLimitWithFallback(enterMarketsGas, DEFAULT_ENTER_MARKETS_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          protocol: "moonwell",
          collateralMToken,
          borrowMToken,
          comptroller,
        },
      }),
    },
    {
      id: "mint_collateral",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "moonwell_mint",
        tx: {
          to: collateralMToken,
          data: MTOKEN_INTERFACE.encodeFunctionData("mint", [normalizedCollateral]),
          value: "0",
          gasLimit: gasLimitWithFallback(mintGas, DEFAULT_MINT_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: amountUsd,
          protocol: "moonwell",
          collateralAsset,
          collateralMToken,
          comptroller,
        },
      }),
    },
  ];

  if (normalizedBorrow) {
    let borrowGas = null;
    try {
      borrowGas = await estimateGasImpl(
        chain,
        {
          from: senderAddress,
          to: borrowMToken,
          data: MTOKEN_INTERFACE.encodeFunctionData("borrow", [normalizedBorrow]),
          valueWei: "0",
        },
        getEvmChainConfig(chain),
      );
    } catch {
      borrowGas = { gasUnits: DEFAULT_BORROW_GAS_UNITS };
    }

    steps.push({
      id: "borrow_usdc",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "moonwell_borrow",
        tx: {
          to: borrowMToken,
          data: MTOKEN_INTERFACE.encodeFunctionData("borrow", [normalizedBorrow]),
          value: "0",
          gasLimit: gasLimitWithFallback(borrowGas, DEFAULT_BORROW_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          protocol: "moonwell",
          borrowAsset: borrowAssetAddress,
          borrowMToken,
          comptroller,
        },
      }),
    });
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    strategyId,
    chain,
    senderAddress,
    steps,
    collateralAsset,
    borrowAsset: borrowAssetAddress || null,
    collateralMToken,
    borrowMToken,
    comptroller,
    collateralUnits: normalizedCollateral,
    borrowUnits: normalizedBorrow,
  };
}
