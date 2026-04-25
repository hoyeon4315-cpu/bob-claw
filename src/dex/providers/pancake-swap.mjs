import { Interface } from "ethers";
import { ZERO_TOKEN, WRAPPED_NATIVE_TOKENS, normalizeToken } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { PANCAKE_SWAP_V3 } from "../../config/dex-providers.mjs";
import { rpc } from "../../evm/json-rpc.mjs";

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

const QUOTER_V2_INTERFACE = new Interface(QUOTER_V2_ABI);
const SWAP_ROUTER_INTERFACE = new Interface(SWAP_ROUTER_ABI);

function resolveTokenAddress(chain, token) {
  if (normalizeToken(token) === normalizeToken(ZERO_TOKEN)) {
    return WRAPPED_NATIVE_TOKENS[chain] || null;
  }
  return token;
}

function minimumOutputAmount(outputAmount, slippageBps) {
  const quoted = BigInt(outputAmount || 0);
  const bps = BigInt(Math.max(0, Number(slippageBps) || 0));
  return ((quoted * (10_000n - bps)) / 10_000n).toString();
}

export class PancakeSwapProvider {
  get name() {
    return "pancake_swap";
  }

  supportsChain(chain) {
    return chain === "bsc";
  }

  async quote({ chain, inputToken, outputToken, amount, slippageBps = 50 } = {}) {
    const chainConfig = getEvmChainConfig(chain);
    if (!chainConfig || !this.supportsChain(chain)) {
      throw new Error(`PancakeSwap unsupported chain: ${chain}`);
    }
    const resolvedInput = resolveTokenAddress(chain, inputToken);
    const resolvedOutput = resolveTokenAddress(chain, outputToken);
    if (!resolvedInput || !resolvedOutput) {
      throw new Error("PancakeSwap: failed to resolve token addresses");
    }

    const rpcUrl = chainConfig.rpcUrl;
    const feeTiers = PANCAKE_SWAP_V3.feeTiers;
    const startedAt = Date.now();

    // Try all fee tiers in parallel
    const quotePromises = feeTiers.map(async (fee) => {
      try {
        const callData = QUOTER_V2_INTERFACE.encodeFunctionData("quoteExactInputSingle", [
          {
            tokenIn: resolvedInput,
            tokenOut: resolvedOutput,
            amountIn: BigInt(amount),
            fee,
            sqrtPriceLimitX96: 0n,
          },
        ]);
        const returnData = await rpc(rpcUrl, "eth_call", [
          { to: PANCAKE_SWAP_V3.quoterV2, data: callData },
          "latest",
        ]);
        const decoded = QUOTER_V2_INTERFACE.decodeFunctionResult("quoteExactInputSingle", returnData);
        const amountOut = decoded[0];
        if (!amountOut || BigInt(amountOut.toString()) <= 0n) return null;
        return { fee, amountOut: amountOut.toString(), gasEstimate: decoded[3].toString() };
      } catch {
        return null; // No pool for this fee tier or revert
      }
    });

    const quotes = await Promise.all(quotePromises);
    const validQuotes = quotes.filter(Boolean);
    if (validQuotes.length === 0) {
      const error = new Error("PancakeSwap: no valid quote for any fee tier");
      error.provider = "pancake_swap";
      throw error;
    }

    const best = validQuotes.reduce((a, b) =>
      BigInt(b.amountOut) > BigInt(a.amountOut) ? b : a,
    );
    const latencyMs = Date.now() - startedAt;

    return {
      schemaVersion: 2,
      observedAt: new Date().toISOString(),
      provider: "pancake_swap",
      quoteType: "token_to_token",
      source: "pancake_swap_v3",
      chain,
      chainId: chainConfig.chainId,
      inputToken: resolvedInput,
      outputToken: resolvedOutput,
      inputAmount: amount,
      outputAmount: best.amountOut,
      inputValueUsd: null,
      outputValueUsd: null,
      netOutputValueUsd: null,
      gasEstimate: best.gasEstimate,
      gasEstimateValueUsd: null,
      priceImpactPct: null,
      fee: best.fee,
      slippageBps: Number(slippageBps),
      pathId: `pancake_v3:${resolvedInput}:${resolvedOutput}:${best.fee}`,
      sourceWhitelist: null,
      sourceBlacklist: null,
      routingMode: "on_chain_direct",
      executionTrust: "on_chain_verified",
      latencyMs,
    };
  }

  async assemble({ quote, senderAddress, deadlineSeconds = 300 } = {}) {
    if (!quote?.pathId || !quote?.fee) {
      throw new Error("PancakeSwap: invalid quote for assembly");
    }
    const minOut = minimumOutputAmount(quote.outputAmount, quote.slippageBps);
    const deadline = Math.floor(Date.now() / 1000) + Math.max(1, Number(deadlineSeconds) || 300);
    const callData = SWAP_ROUTER_INTERFACE.encodeFunctionData("exactInputSingle", [
      {
        tokenIn: quote.inputToken,
        tokenOut: quote.outputToken,
        fee: quote.fee,
        recipient: senderAddress,
        deadline,
        amountIn: BigInt(quote.inputAmount),
        amountOutMinimum: BigInt(minOut),
        sqrtPriceLimitX96: 0n,
      },
    ]);

    return {
      ...quote,
      txTo: PANCAKE_SWAP_V3.swapRouter,
      txData: callData,
      txValueWei: "0",
      txGasLimit: null,
      txDataBytes: Math.max(0, (callData.length - 2) / 2),
      assembleLatencyMs: 0,
      deadline,
    };
  }
}
