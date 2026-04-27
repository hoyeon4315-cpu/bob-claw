import { Interface } from "ethers";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { dexProvidersForChain, quoteForLive } from "../../dex/providers.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const DEFAULT_APPROVE_GAS_UNITS = 80_000;
const DEFAULT_SWAP_GAS_UNITS = 450_000;

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

function unitsFromUsdAmount({ amountUsd, inputDecimals, inputPriceUsd }) {
  const price = Number(inputPriceUsd);
  const decimals = Number(inputDecimals);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  const units = Math.floor((amountUsd / price) * (10 ** decimals));
  return units > 0 ? String(units) : null;
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
 * Build a generic ERC20 swap intent (approve + swap) via DEX aggregator.
 *
 * @param {object} opts
 * @param {string} opts.strategyId
 * @param {string} [opts.capStrategyId]
 * @param {string} opts.chain
 * @param {number} opts.amountUsd
 * @param {string} opts.inputToken
 * @param {string} opts.outputToken
 * @param {string} [opts.inputAmount]
 * @param {number} opts.inputDecimals
 * @param {number} [opts.inputPriceUsd]
 * @param {number} [opts.slippageBps]
 * @param {string} [opts.senderAddress]
 * @param {Array} [opts.providers]
 * @param {number} [opts.gasBufferBps]
 * @param {string} [opts.now]
 */
export async function buildSwapIntent({
  strategyId,
  capStrategyId = null,
  chain,
  amountUsd,
  inputToken,
  outputToken,
  inputAmount = null,
  inputDecimals = 18,
  inputPriceUsd = 1,
  slippageBps = 50,
  senderAddress = null,
  providers = null,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
  estimateGasImpl = estimateGas,
} = {}) {
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported chain: ${chain}`);
  const strategyCaps = assertStrategyCaps(capStrategyId || strategyId);
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);

  const input = assertAddress(inputToken, "inputToken");
  const output = assertAddress(outputToken, "outputToken");
  if (input.toLowerCase() === output.toLowerCase()) throw new Error("inputToken and outputToken must differ");

  const inputUnits = inputAmount
    ? toPositiveIntegerString(inputAmount, "inputAmount")
    : toPositiveIntegerString(
      unitsFromUsdAmount({ amountUsd, inputDecimals, inputPriceUsd }),
      "inputAmount",
    );

  const resolvedProviders = providers || dexProvidersForChain(chain);
  let quoteResult = null;
  try {
    quoteResult = await quoteForLive(resolvedProviders, {
      chain,
      inputToken: input,
      outputToken: output,
      amount: inputUnits,
      senderAddress,
      slippageBps: Number(slippageBps),
    });
  } catch (err) {
    throw new Error(`DEX quote failed: ${err.message}`);
  }

  const executableQuote = quoteResult.executableQuote;
  if (!executableQuote?.txTo || !executableQuote?.txData) {
    throw new Error("DEX quote returned no executable calldata");
  }

  let approveGas = null;
  try {
    approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: input,
        data: ERC20_INTERFACE.encodeFunctionData("approve", [executableQuote.txTo, inputUnits]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    approveGas = { gasUnits: DEFAULT_APPROVE_GAS_UNITS };
  }

  let swapGas = null;
  try {
    swapGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: executableQuote.txTo,
        data: executableQuote.txData,
        valueWei: executableQuote.txValueWei || "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    swapGas = { gasUnits: DEFAULT_SWAP_GAS_UNITS };
  }

  const steps = [
    {
      id: "approve_input_to_dex",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: input,
          spender: executableQuote.txTo,
          amount: inputUnits,
          mode: "per_tx",
        },
        tx: {
          to: input,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [executableQuote.txTo, inputUnits]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          capStrategyId: capStrategyId || strategyId,
          protocol: quoteResult.provider || "dex",
          inputToken: input,
          outputToken: output,
          inputAmount: inputUnits,
          outputAmount: executableQuote.outputAmount,
          slippageBps,
        },
      }),
    },
    {
      id: "dex_swap",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "dex_swap",
        tx: {
          to: executableQuote.txTo,
          data: executableQuote.txData,
          value: executableQuote.txValueWei || "0",
          gasLimit: gasLimitWithFallback(swapGas, DEFAULT_SWAP_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: amountUsd,
          capStrategyId: capStrategyId || strategyId,
          protocol: quoteResult.provider || "dex",
          inputToken: input,
          outputToken: output,
          inputAmount: inputUnits,
          outputAmount: executableQuote.outputAmount,
          slippageBps,
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
    inputToken: input,
    outputToken: output,
    inputAmount: inputUnits,
    outputAmount: executableQuote.outputAmount,
    provider: quoteResult.provider,
    amountUsd,
  };
}
