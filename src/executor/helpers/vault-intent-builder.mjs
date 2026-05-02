import { Interface } from "ethers";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const ERC4626_INTERFACE = new Interface([
  "function deposit(uint256 assets,address receiver) returns (uint256 shares)",
]);

const DEFAULT_APPROVE_GAS_UNITS = 80_000;
const DEFAULT_DEPOSIT_GAS_UNITS = 420_000;

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

function unitsFromUsd(amountUsd, priceUsd, decimals) {
  if (!Number.isFinite(amountUsd) || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const safeDecimals = Math.max(0, Math.min(18, Number(decimals) || 18));
  const units = BigInt(Math.floor((amountUsd / priceUsd) * (10 ** safeDecimals)));
  return units > 0n ? units.toString() : null;
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
      expectedTxTo: tx?.to || null,
      ...metadata,
    },
  };
}

/**
 * Build ERC4626 vault deposit intents: approve + deposit.
 *
 * @param {object} opts
 * @param {string} opts.strategyId
 * @param {string} opts.chain
 * @param {number} opts.amountUsd
 * @param {string} opts.vaultAddress
 * @param {string} opts.assetAddress
 * @param {number} opts.assetDecimals
 * @param {number} [opts.assetPriceUsd]
 * @param {string|bigint} [opts.assetAmount] - explicit asset units, preferred when clamping to wallet balance
 * @param {string} [opts.senderAddress]
 * @param {number} [opts.gasBufferBps]
 * @param {string} [opts.now]
 * @param {Function} [opts.estimateGasImpl]
 */
export async function buildVaultDepositIntent({
  strategyId,
  chain,
  amountUsd,
  vaultAddress,
  assetAddress,
  assetDecimals = 18,
  assetPriceUsd = null,
  assetAmount = null,
  senderAddress = null,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
  estimateGasImpl = estimateGas,
} = {}) {
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported chain: ${chain}`);
  const strategyCaps = assertStrategyCaps(strategyId);
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);

  const vault = assertAddress(vaultAddress, "vaultAddress");
  const asset = assertAddress(assetAddress, "assetAddress");

  let normalizedAmount = null;
  if (assetAmount != null) {
    normalizedAmount = toPositiveIntegerString(assetAmount, "assetAmount");
  } else if (assetPriceUsd != null && Number.isFinite(assetPriceUsd) && assetPriceUsd > 0) {
    normalizedAmount = toPositiveIntegerString(
      unitsFromUsd(amountUsd, assetPriceUsd, assetDecimals) || Math.floor(amountUsd * 1e6),
      "amount",
    );
  } else {
    normalizedAmount = toPositiveIntegerString(Math.floor(amountUsd * 1e6), "amount");
  }

  let approveGas = null;
  try {
    approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: asset,
        data: ERC20_INTERFACE.encodeFunctionData("approve", [vault, normalizedAmount]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    approveGas = { gasUnits: DEFAULT_APPROVE_GAS_UNITS };
  }

  let depositGas = null;
  try {
    depositGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: vault,
        data: ERC4626_INTERFACE.encodeFunctionData("deposit", [normalizedAmount, senderAddress || vault]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    depositGas = { gasUnits: DEFAULT_DEPOSIT_GAS_UNITS };
  }

  const steps = [
    {
      id: "approve_asset_to_vault",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: asset,
          spender: vault,
          amount: normalizedAmount,
          mode: "per_tx",
        },
        tx: {
          to: asset,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [vault, normalizedAmount]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          protocol: strategyCaps.exposure?.protocols?.[0] || "vault",
          vaultAddress: vault,
          assetAddress: asset,
        },
      }),
    },
    {
      id: "deposit_asset_to_vault",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "vault_deposit",
        tx: {
          to: vault,
          data: ERC4626_INTERFACE.encodeFunctionData("deposit", [normalizedAmount, senderAddress || vault]),
          value: "0",
          gasLimit: gasLimitWithFallback(depositGas, DEFAULT_DEPOSIT_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: amountUsd,
          protocol: strategyCaps.exposure?.protocols?.[0] || "vault",
          vaultAddress: vault,
          assetAddress: asset,
        },
      }),
    },
  ];

  return {
    schemaVersion: 1,
    observedAt: now,
    strategyId,
    chain,
    senderAddress,
    steps,
    vaultAddress: vault,
    assetAddress: asset,
    amount: normalizedAmount,
    amountUsd,
  };
}
