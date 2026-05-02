import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import {
  attachOdosAssembly,
  normalizeOdosQuote,
  OdosClient,
  odosRoutingConfig,
  STABLE_QUOTE_TOKENS,
} from "../../dex/odos.mjs";
import { readErc20Balance } from "../../evm/account-state.mjs";
import { simulateTransactionCall } from "../../evm/transaction-read.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../../strategy/wrapped-btc-lending-loop-slice.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "../../strategy/wrapped-btc-loop-bindings.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "../helpers/gateway-btc-consolidation.mjs";

const BASE_CBBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const MIN_MATERIAL_CURRENT_POSITION_USD = 0.01;

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const COMPTROLLER_INTERFACE = new Interface([
  "function enterMarkets(address[] mTokens)",
]);

const COMPTROLLER_VIEW_INTERFACE = new Interface([
  "function oracle() view returns (address)",
  "function markets(address) view returns (bool,uint256,bool)",
]);

const MTOKEN_INTERFACE = new Interface([
  "function mint(uint256 mintAmount)",
  "function borrow(uint256 borrowAmount)",
  "function repayBorrow(uint256 repayAmount)",
  "function redeemUnderlying(uint256 redeemAmount)",
]);

const MTOKEN_VIEW_INTERFACE = new Interface([
  "function getAccountSnapshot(address account) view returns (uint256,uint256,uint256,uint256)",
]);

const PRICE_ORACLE_INTERFACE = new Interface([
  "function getUnderlyingPrice(address mToken) view returns (uint256)",
]);

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function decimalToUnits(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const safeDecimals = Math.max(0, Math.min(18, decimals));
  const fixed = Number(value).toFixed(safeDecimals);
  const [wholePart, fractionPart = ""] = fixed.split(".");
  const normalizedWhole = wholePart.replace("-", "");
  const normalizedFraction = fractionPart.padEnd(safeDecimals, "0").slice(0, safeDecimals);
  const units = BigInt(`${normalizedWhole || "0"}${normalizedFraction || ""}`);
  return units.toString();
}

function unitsFromUsd(amountUsd, assetUsd, decimals) {
  if (!Number.isFinite(amountUsd) || !Number.isFinite(assetUsd) || assetUsd <= 0) return null;
  return decimalToUnits(amountUsd / assetUsd, decimals);
}

function unitsToUsd(amountUnits, assetUsd, decimals) {
  if (!Number.isFinite(assetUsd) || assetUsd <= 0) return null;
  const safeDecimals = Math.max(0, Math.min(18, Number(decimals)));
  const units = typeof amountUnits === "bigint" ? amountUnits : BigInt(amountUnits || 0);
  return round((Number(units) / (10 ** safeDecimals)) * assetUsd, 6);
}

function usd36ToNumber(value) {
  return round(Number(value || 0n) / 1e36, 6);
}

function minBigInt(left, right) {
  const a = BigInt(left || 0n);
  const b = BigInt(right || 0n);
  return a < b ? a : b;
}

function ceilDiv(numerator, denominator) {
  const n = BigInt(numerator || 0n);
  const d = BigInt(denominator || 1n);
  return n <= 0n ? 0n : ((n - 1n) / d) + 1n;
}

function marketStateFromReturnData(returnData = "0x") {
  const words = String(returnData || "")
    .replace(/^0x/, "")
    .match(/.{1,64}/g) || [];
  if (words.length < 2) return null;
  return {
    isListed: BigInt(`0x${words[0]}`) !== 0n,
    collateralFactorMantissa: BigInt(`0x${words[1]}`),
  };
}

async function estimateBufferedGasLimit({
  chain,
  from,
  to,
  data,
  value = "0",
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  allowFailure = false,
} = {}) {
  try {
    const estimate = await estimateGasImpl(
      chain,
      {
        from,
        to,
        data,
        valueWei: value,
      },
      getEvmChainConfig(chain),
    );
    return String(applyGasBuffer(estimate.gasUnits, gasBufferBps));
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function exactApprovalStep({ id, chain, token, spender, amount, amountUsd, now, metadata = {}, gasLimit = null }) {
  return {
    id,
    chain,
    amountUsd: round(amountUsd, 6),
    quote: {
      observedAt: now,
    },
    approval: {
      token,
      spender,
      amount,
      mode: "per_tx",
    },
    tx: {
      to: token,
      data: ERC20_INTERFACE.encodeFunctionData("approve", [spender, amount]),
      value: "0",
      ...(gasLimit ? { gasLimit } : {}),
    },
    metadata,
  };
}

function contractCallStep({ id, chain, to, data, amountUsd, now, metadata = {}, quote = null, tx = {}, gasLimit = null }) {
  return {
    id,
    chain,
    amountUsd: round(amountUsd, 6),
    quote: quote || {
      observedAt: now,
    },
    tx: {
      to,
      data,
      value: "0",
      ...(gasLimit ? { gasLimit } : {}),
      ...tx,
    },
    metadata: {
      ...metadata,
      expectedTxTo: tx?.to || to,
    },
  };
}

async function buildOdosSwapStep({
  id,
  chain,
  inputToken,
  outputToken,
  amount,
  amountUsd,
  signerAddress,
  now,
  client,
  quoteType = "stable_to_token",
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
}) {
  const outputAsset = tokenAsset(chain, outputToken);
  const routing = odosRoutingConfig(chain);
  const quoted = await client.quote({
    chain,
    inputToken,
    outputToken,
    amount,
    userAddr: signerAddress,
    slippageLimitPercent: 0.5,
    sourceWhitelist: routing.sourceWhitelist,
    sourceBlacklist: routing.sourceBlacklist,
  });
  const normalizedQuote = normalizeOdosQuote({
    chain,
    source: "wrapped_btc_loop_swap",
    amount,
    inputToken,
    outputToken,
    inputTicker: tokenAsset(chain, inputToken).ticker,
    inputDecimals: tokenAsset(chain, inputToken).decimals,
    outputTicker: outputAsset.ticker,
    outputDecimals: outputAsset.decimals,
    quoteType,
    result: quoted,
    sourceWhitelist: routing.sourceWhitelist,
    sourceBlacklist: routing.sourceBlacklist,
  });
  const assembled = await client.assemble({
    pathId: normalizedQuote.pathId,
    userAddr: signerAddress,
  });
  const executableQuote = attachOdosAssembly(normalizedQuote, assembled);
  return {
    approvalStep: exactApprovalStep({
      id: `${id}:approve`,
      chain,
      token: inputToken,
      spender: executableQuote.txTo,
      amount,
      amountUsd,
      now,
      metadata: {
        provider: "odos",
        sourceWhitelist: executableQuote.sourceWhitelist,
        executionTrust: executableQuote.executionTrust,
      },
    }),
    swapStep: contractCallStep({
      id,
      chain,
      to: executableQuote.txTo,
      data: executableQuote.txData,
      amountUsd,
      now,
      quote: {
        observedAt: executableQuote.observedAt,
        provider: executableQuote.provider,
        pathId: executableQuote.pathId,
        quoteType: executableQuote.quoteType,
        inputAmount: executableQuote.inputAmount,
        outputAmount: executableQuote.outputAmount,
        inputValueUsd: executableQuote.inputValueUsd,
        outputValueUsd: executableQuote.outputValueUsd,
        executionTrust: executableQuote.executionTrust,
        sourceWhitelist: executableQuote.sourceWhitelist,
      },
      tx: {
        value: executableQuote.txValueWei,
        gasLimit: executableQuote.txGasLimit != null
          ? String(applyGasBuffer(executableQuote.txGasLimit, gasBufferBps))
          : undefined,
      },
      metadata: {
        provider: "odos",
        pathId: executableQuote.pathId,
        sourceWhitelist: executableQuote.sourceWhitelist,
        executionTrust: executableQuote.executionTrust,
      },
    }),
  };
}

export async function buildAutoWrappedBtcLoopScenarioBinding({
  strategyId = "wrapped-btc-loop-base-moonwell",
  strategyConfig = {},
  scenarioId = "healthy_baseline",
  signerAddress,
  prices = null,
  client = new OdosClient(),
  readErc20BalanceImpl = readErc20Balance,
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  marketAssumptions = null,
  now = new Date().toISOString(),
} = {}) {
  if (scenarioId !== "healthy_baseline") {
    throw new Error(`Repo auto-build currently supports healthy_baseline only, received: ${scenarioId}`);
  }
  if (!signerAddress) {
    throw new Error("Signer address is required for repo auto-build");
  }

  const support = resolveWrappedBtcLoopBindingSupport({
    strategyId,
    strategyConfig,
  });
  if (support.executableFromRepo !== true) {
    throw new Error(`Repo auto-build is unavailable: ${(support.missingFacts || []).join(" ")}`);
  }

  const collateralToken = BASE_CBBTC_TOKEN;
  const borrowToken = STABLE_QUOTE_TOKENS.base.token;
  const collateralAsset = tokenAsset("base", collateralToken);
  const borrowAsset = tokenAsset("base", borrowToken);
  const baseChainConfig = getEvmChainConfig("base");
  const collateralPriceUsd = prices?.tokenByKey?.[collateralAsset.priceKey] ?? prices?.btc ?? null;
  if (!Number.isFinite(collateralPriceUsd)) {
    throw new Error("Repo auto-build requires a current cbBTC/BTC USD price");
  }
  const availableBorrowBalance = await readErc20BalanceImpl(
    "base",
    borrowToken,
    signerAddress,
    baseChainConfig ? { chainConfig: baseChainConfig } : undefined,
  );
  let availableBorrowInventoryUnits = BigInt(availableBorrowBalance?.balance ?? 0n);
  const collateralMarketAddress = support.knownContracts.collateralMarket.mTokenAddress;
  const borrowMarketAddress = support.knownContracts.borrowMarket.mTokenAddress;
  const comptrollerAddress = support.knownContracts.comptroller.address;

  const requestedInitialCollateralUnits = unitsFromUsd(
    strategyConfig.perTradeCapUsd,
    collateralPriceUsd,
    collateralAsset.decimals,
  );
  if (!requestedInitialCollateralUnits) {
    throw new Error("Failed to derive initial cbBTC collateral units");
  }
  const availableCollateralBalance = await readErc20BalanceImpl(
    "base",
    collateralToken,
    signerAddress,
    baseChainConfig ? { chainConfig: baseChainConfig } : undefined,
  );
  const availableCollateralUnits = BigInt(availableCollateralBalance?.balance ?? 0n);
  if (availableCollateralUnits <= 0n) {
    throw new Error("Signer does not hold any cbBTC collateral on Base for the wrapped BTC loop entry");
  }
  const effectiveInitialCollateralUnits = BigInt(requestedInitialCollateralUnits) > availableCollateralUnits
    ? availableCollateralUnits
    : BigInt(requestedInitialCollateralUnits);
  const effectivePerTradeCapUsd = unitsToUsd(
    effectiveInitialCollateralUnits,
    collateralPriceUsd,
    collateralAsset.decimals,
  );
  if (!Number.isFinite(effectivePerTradeCapUsd) || effectivePerTradeCapUsd <= 0) {
    throw new Error("Failed to derive executable cbBTC collateral size from the current Base wallet balance");
  }
  const effectiveStrategyConfig = {
    ...strategyConfig,
    perTradeCapUsd: effectivePerTradeCapUsd,
  };
  const scaffold = buildWrappedBtcLendingLoopScaffold({
    strategyConfig: effectiveStrategyConfig,
    marketAssumptions,
    now,
  });
  const initialCollateralUnits = effectiveInitialCollateralUnits.toString();
  const collateralDownsized = effectiveInitialCollateralUnits < BigInt(requestedInitialCollateralUnits);

  const initialApprovalGasLimit = await estimateBufferedGasLimit({
    chain: "base",
    from: signerAddress,
    to: collateralToken,
    data: ERC20_INTERFACE.encodeFunctionData("approve", [collateralMarketAddress, initialCollateralUnits]),
    estimateGasImpl,
    gasBufferBps,
    allowFailure: true,
  });
  const enterMarketsGasLimit = await estimateBufferedGasLimit({
    chain: "base",
    from: signerAddress,
    to: comptrollerAddress,
    data: COMPTROLLER_INTERFACE.encodeFunctionData("enterMarkets", [[collateralMarketAddress]]),
    estimateGasImpl,
    gasBufferBps,
    allowFailure: true,
  });
  const mintInitialGasLimit = await estimateBufferedGasLimit({
    chain: "base",
    from: signerAddress,
    to: collateralMarketAddress,
    data: MTOKEN_INTERFACE.encodeFunctionData("mint", [initialCollateralUnits]),
    estimateGasImpl,
    gasBufferBps,
    allowFailure: true,
  });

  const entry = [
    exactApprovalStep({
      id: "approve-initial-collateral",
      chain: "base",
      token: collateralToken,
      spender: collateralMarketAddress,
      amount: initialCollateralUnits,
      amountUsd: effectiveStrategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "approve_exact_collateral",
        capCheckAmountUsd: 0,
        requestedPerTradeCapUsd: round(strategyConfig.perTradeCapUsd, 6),
        appliedPerTradeCapUsd: round(effectiveStrategyConfig.perTradeCapUsd, 6),
        appliedCollateralUnits: initialCollateralUnits,
        collateralDownsized,
      },
      gasLimit: initialApprovalGasLimit,
    }),
    contractCallStep({
      id: "enter-collateral-market",
      chain: "base",
      to: comptrollerAddress,
      data: COMPTROLLER_INTERFACE.encodeFunctionData("enterMarkets", [[collateralMarketAddress]]),
      amountUsd: effectiveStrategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "enter_markets",
        capCheckAmountUsd: 0,
        requestedPerTradeCapUsd: round(strategyConfig.perTradeCapUsd, 6),
        appliedPerTradeCapUsd: round(effectiveStrategyConfig.perTradeCapUsd, 6),
        appliedCollateralUnits: initialCollateralUnits,
        collateralDownsized,
      },
      gasLimit: enterMarketsGasLimit,
    }),
    contractCallStep({
      id: "mint-initial-collateral",
      chain: "base",
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("mint", [initialCollateralUnits]),
      amountUsd: effectiveStrategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "deposit_initial_collateral",
        capCheckAmountUsd: round(effectiveStrategyConfig.perTradeCapUsd, 6),
        requestedPerTradeCapUsd: round(strategyConfig.perTradeCapUsd, 6),
        appliedPerTradeCapUsd: round(effectiveStrategyConfig.perTradeCapUsd, 6),
        appliedCollateralUnits: initialCollateralUnits,
        collateralDownsized,
      },
      gasLimit: mintInitialGasLimit,
    }),
  ];

  for (const iteration of scaffold.entryPlan?.iterations || []) {
    const borrowUnits = decimalToUnits(iteration.borrowUsd, borrowAsset.decimals);
    const plannedRecycledCollateralUnits = unitsFromUsd(
      iteration.recycledCollateralUsd,
      collateralPriceUsd,
      collateralAsset.decimals,
    );
    if (!borrowUnits || !plannedRecycledCollateralUnits) {
      throw new Error(`Failed to derive entry units for iteration ${iteration.iteration}`);
    }

    const swap = await buildOdosSwapStep({
      id: `swap-borrow-to-collateral-${iteration.iteration}`,
      chain: "base",
      inputToken: borrowToken,
      outputToken: collateralToken,
      amount: borrowUnits,
      amountUsd: iteration.borrowUsd,
      signerAddress,
      now,
      client,
      gasBufferBps,
    });
    const quotedRecycledCollateralUnits = BigInt(swap.swapStep.quote?.outputAmount || 0n);
    if (quotedRecycledCollateralUnits <= 0n) {
      throw new Error(`Odos returned no recycled collateral output for iteration ${iteration.iteration}`);
    }
    const appliedRecycledCollateralUnits = minBigInt(
      plannedRecycledCollateralUnits,
      quotedRecycledCollateralUnits,
    );
    if (appliedRecycledCollateralUnits <= 0n) {
      throw new Error(`Failed to derive executable recycled collateral units for iteration ${iteration.iteration}`);
    }
    const appliedRecycledCollateralUsd = unitsToUsd(
      appliedRecycledCollateralUnits,
      collateralPriceUsd,
      collateralAsset.decimals,
    );
    const recycledCollateralDownsized =
      appliedRecycledCollateralUnits < BigInt(plannedRecycledCollateralUnits);
    const borrowGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: borrowMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("borrow", [borrowUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const recycledApprovalGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: collateralToken,
      data: ERC20_INTERFACE.encodeFunctionData("approve", [collateralMarketAddress, appliedRecycledCollateralUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const recycledMintGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("mint", [appliedRecycledCollateralUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });

    entry.push(
      contractCallStep({
        id: `borrow-usdc-${iteration.iteration}`,
        chain: "base",
        to: borrowMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("borrow", [borrowUnits]),
        amountUsd: iteration.borrowUsd,
        now,
        metadata: {
          kind: "borrow_against_collateral",
          iteration: iteration.iteration,
          capCheckAmountUsd: 0,
        },
        gasLimit: borrowGasLimit,
      }),
      swap.approvalStep,
      swap.swapStep,
      exactApprovalStep({
        id: `approve-recycled-collateral-${iteration.iteration}`,
        chain: "base",
        token: collateralToken,
        spender: collateralMarketAddress,
        amount: appliedRecycledCollateralUnits.toString(),
        amountUsd: appliedRecycledCollateralUsd,
        now,
        metadata: {
          kind: "approve_recycled_collateral",
          iteration: iteration.iteration,
          capCheckAmountUsd: 0,
          plannedRecycledCollateralUnits,
          quotedRecycledCollateralUnits: quotedRecycledCollateralUnits.toString(),
          appliedRecycledCollateralUnits: appliedRecycledCollateralUnits.toString(),
          recycledCollateralDownsized,
        },
        gasLimit: recycledApprovalGasLimit,
      }),
      contractCallStep({
        id: `mint-recycled-collateral-${iteration.iteration}`,
        chain: "base",
        to: collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("mint", [appliedRecycledCollateralUnits.toString()]),
        amountUsd: appliedRecycledCollateralUsd,
        now,
        metadata: {
          kind: "deposit_recycled_collateral",
          iteration: iteration.iteration,
          capCheckAmountUsd: 0,
          plannedRecycledCollateralUnits,
          quotedRecycledCollateralUnits: quotedRecycledCollateralUnits.toString(),
          appliedRecycledCollateralUnits: appliedRecycledCollateralUnits.toString(),
          recycledCollateralDownsized,
        },
        gasLimit: recycledMintGasLimit,
      }),
    );
  }

  const unwind = [];
  const finalCollateralRedeemUnits = initialCollateralUnits;
  const iterations = [...(scaffold.entryPlan?.iterations || [])];
  if (iterations.length === 0) {
    const redeemInitialGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [initialCollateralUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    unwind.push(
      contractCallStep({
        id: "redeem-initial-collateral",
        chain: "base",
        to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [initialCollateralUnits]),
      amountUsd: effectiveStrategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "withdraw_initial_collateral",
        tinyValidationOnly: true,
        requestedPerTradeCapUsd: round(strategyConfig.perTradeCapUsd, 6),
        appliedPerTradeCapUsd: round(effectiveStrategyConfig.perTradeCapUsd, 6),
        appliedCollateralUnits: initialCollateralUnits,
        collateralDownsized,
      },
      gasLimit: redeemInitialGasLimit,
    }),
  );
  }
  for (const iteration of iterations.reverse()) {
    const repayUnits = decimalToUnits(iteration.borrowUsd, borrowAsset.decimals);
    const redeemUnits = unitsFromUsd(iteration.recycledCollateralUsd, collateralPriceUsd, collateralAsset.decimals);
    if (!repayUnits || !redeemUnits) {
      throw new Error(`Failed to derive unwind units for iteration ${iteration.iteration}`);
    }
    const repayUnitsBigInt = BigInt(repayUnits);
    let collateralConsumedForRepay = false;
    const repayApprovalGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: borrowToken,
      data: ERC20_INTERFACE.encodeFunctionData("approve", [borrowMarketAddress, repayUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const repayGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: borrowMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("repayBorrow", [repayUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const redeemGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });

    if (availableBorrowInventoryUnits < repayUnitsBigInt) {
      const fundingRedeemGasLimit = await estimateBufferedGasLimit({
        chain: "base",
        from: signerAddress,
        to: collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemUnits]),
        estimateGasImpl,
        gasBufferBps,
        allowFailure: true,
      });
      const fundingSwap = await buildOdosSwapStep({
        id: `swap-collateral-to-repay-${iteration.iteration}`,
        chain: "base",
        inputToken: collateralToken,
        outputToken: borrowToken,
        amount: redeemUnits,
        amountUsd: iteration.recycledCollateralUsd,
        signerAddress,
        now,
        client,
        quoteType: "token_to_stable",
      });
      const plannedBorrowTopUpUnits = BigInt(fundingSwap.swapStep.quote?.outputAmount || 0n);
      unwind.push(
        contractCallStep({
          id: `redeem-collateral-for-repay-${iteration.iteration}`,
          chain: "base",
          to: collateralMarketAddress,
          data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemUnits]),
          amountUsd: iteration.recycledCollateralUsd,
          now,
          metadata: {
            kind: "withdraw_collateral_for_repay",
            iteration: iteration.iteration,
            fundsBorrowRepay: true,
          },
          gasLimit: fundingRedeemGasLimit,
        }),
        {
          ...fundingSwap.approvalStep,
          metadata: {
            ...fundingSwap.approvalStep.metadata,
            kind: "approve_collateral_for_repay_swap",
            iteration: iteration.iteration,
            fundsBorrowRepay: true,
          },
        },
        {
          ...fundingSwap.swapStep,
          metadata: {
            ...fundingSwap.swapStep.metadata,
            kind: "swap_collateral_to_repay_asset",
            iteration: iteration.iteration,
            fundsBorrowRepay: true,
            plannedBorrowTopUpUnits: plannedBorrowTopUpUnits.toString(),
          },
        },
      );
      availableBorrowInventoryUnits += plannedBorrowTopUpUnits;
      collateralConsumedForRepay = true;
      if (availableBorrowInventoryUnits < repayUnitsBigInt) {
        throw new Error(
          `Iteration ${iteration.iteration} still lacks repay inventory after collateral swap: need ${repayUnits}, planned ${availableBorrowInventoryUnits.toString()}`,
        );
      }
    }

    unwind.push(
      exactApprovalStep({
        id: `approve-repay-usdc-${iteration.iteration}`,
        chain: "base",
        token: borrowToken,
        spender: borrowMarketAddress,
        amount: repayUnits,
        amountUsd: iteration.borrowUsd,
        now,
        metadata: {
          kind: "repay_borrow_asset",
          iteration: iteration.iteration,
          requiresBorrowAssetInventory: !collateralConsumedForRepay,
          inventorySource: collateralConsumedForRepay ? "redeemed_collateral_swap" : "wallet_balance",
          repayUnits,
        },
        gasLimit: repayApprovalGasLimit,
      }),
      contractCallStep({
        id: `repay-usdc-${iteration.iteration}`,
        chain: "base",
        to: borrowMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("repayBorrow", [repayUnits]),
        amountUsd: iteration.borrowUsd,
        now,
        metadata: {
          kind: "repay_borrow_asset",
          iteration: iteration.iteration,
          requiresBorrowAssetInventory: !collateralConsumedForRepay,
          inventorySource: collateralConsumedForRepay ? "redeemed_collateral_swap" : "wallet_balance",
          repayUnits,
          borrowInventoryEffect: "consume",
        },
        gasLimit: repayGasLimit,
      }),
    );
    availableBorrowInventoryUnits -= repayUnitsBigInt;
    if (!collateralConsumedForRepay) {
      unwind.push(
        contractCallStep({
          id: `redeem-collateral-${iteration.iteration}`,
          chain: "base",
          to: collateralMarketAddress,
          data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemUnits]),
          amountUsd: iteration.recycledCollateralUsd,
          now,
          metadata: {
            kind: "withdraw_recycled_collateral",
            iteration: iteration.iteration,
          },
          gasLimit: redeemGasLimit,
        }),
      );
    }
  }
  if (iterations.length > 0) {
    const redeemInitialGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [finalCollateralRedeemUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    unwind.push(
      contractCallStep({
        id: "redeem-initial-collateral",
        chain: "base",
        to: collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [finalCollateralRedeemUnits]),
        amountUsd: strategyConfig.perTradeCapUsd,
        now,
        metadata: {
          kind: "withdraw_initial_collateral",
        },
        gasLimit: redeemInitialGasLimit,
      }),
    );
  }

  return {
    entry,
    unwind,
    notes: [
      "Repo auto-build generated Moonwell core calldata and Odos safe-whitelist swap calldata.",
      iterations.length === 0 ? "Tiny validation mode skipped borrow iterations and only validates collateral deposit plus redeem." : null,
      "Unwind repays from free borrow-asset inventory first and falls back to redeemed collateral swaps when the wallet is short.",
    ].filter(Boolean),
  };
}

export async function readCurrentMoonwellWrappedBtcLoopPosition({
  strategyId = "wrapped-btc-loop-base-moonwell",
  strategyConfig = {},
  signerAddress,
  readErc20BalanceImpl = readErc20Balance,
  simulateTransactionCallImpl = simulateTransactionCall,
} = {}) {
  if (!signerAddress) {
    throw new Error("Signer address is required to read the current Moonwell wrapped BTC loop position");
  }

  const support = resolveWrappedBtcLoopBindingSupport({
    strategyId,
    strategyConfig,
  });
  if (support.executableFromRepo !== true) {
    throw new Error(`Repo auto-build is unavailable: ${(support.missingFacts || []).join(" ")}`);
  }

  const chain = strategyConfig.chain || "base";
  const chainConfig = getEvmChainConfig(chain);
  const collateralToken = BASE_CBBTC_TOKEN;
  const borrowToken = STABLE_QUOTE_TOKENS.base.token;
  const collateralAsset = tokenAsset(chain, collateralToken);
  const borrowAsset = tokenAsset(chain, borrowToken);
  const comptrollerAddress = support.knownContracts.comptroller.address;
  const collateralMarketAddress = support.knownContracts.collateralMarket.mTokenAddress;
  const borrowMarketAddress = support.knownContracts.borrowMarket.mTokenAddress;

  const [collateralWalletBalance, borrowWalletBalance, oracleCall, collateralMarketCall, collateralSnapshotCall, borrowSnapshotCall] =
    await Promise.all([
      readErc20BalanceImpl(
        chain,
        collateralToken,
        signerAddress,
        chainConfig ? { chainConfig } : undefined,
      ),
      readErc20BalanceImpl(
        chain,
        borrowToken,
        signerAddress,
        chainConfig ? { chainConfig } : undefined,
      ),
      simulateTransactionCallImpl(chain, {
        to: comptrollerAddress,
        data: COMPTROLLER_VIEW_INTERFACE.encodeFunctionData("oracle"),
      }, chainConfig ? { chainConfig } : undefined),
      simulateTransactionCallImpl(chain, {
        to: comptrollerAddress,
        data: COMPTROLLER_VIEW_INTERFACE.encodeFunctionData("markets", [collateralMarketAddress]),
      }, chainConfig ? { chainConfig } : undefined),
      simulateTransactionCallImpl(chain, {
        to: collateralMarketAddress,
        data: MTOKEN_VIEW_INTERFACE.encodeFunctionData("getAccountSnapshot", [signerAddress]),
      }, chainConfig ? { chainConfig } : undefined),
      simulateTransactionCallImpl(chain, {
        to: borrowMarketAddress,
        data: MTOKEN_VIEW_INTERFACE.encodeFunctionData("getAccountSnapshot", [signerAddress]),
      }, chainConfig ? { chainConfig } : undefined),
    ]);

  const oracleAddress = COMPTROLLER_VIEW_INTERFACE.decodeFunctionResult("oracle", oracleCall.returnData)[0];
  const marketState = marketStateFromReturnData(collateralMarketCall.returnData);
  if (!oracleAddress || !marketState?.isListed) {
    throw new Error("Moonwell collateral market is not listed or oracle is unavailable");
  }

  const [collateralSnapshotError, collateralTokenBalance, , collateralExchangeRate] =
    MTOKEN_VIEW_INTERFACE.decodeFunctionResult("getAccountSnapshot", collateralSnapshotCall.returnData);
  const [borrowSnapshotError, , borrowBalance] =
    MTOKEN_VIEW_INTERFACE.decodeFunctionResult("getAccountSnapshot", borrowSnapshotCall.returnData);
  if (BigInt(collateralSnapshotError) !== 0n || BigInt(borrowSnapshotError) !== 0n) {
    throw new Error("Moonwell getAccountSnapshot returned a non-zero error code");
  }

  const [collateralPriceMantissa, borrowPriceMantissa] = await Promise.all([
    simulateTransactionCallImpl(chain, {
      to: oracleAddress,
      data: PRICE_ORACLE_INTERFACE.encodeFunctionData("getUnderlyingPrice", [collateralMarketAddress]),
    }, chainConfig ? { chainConfig } : undefined).then((result) =>
      PRICE_ORACLE_INTERFACE.decodeFunctionResult("getUnderlyingPrice", result.returnData)[0]
    ),
    simulateTransactionCallImpl(chain, {
      to: oracleAddress,
      data: PRICE_ORACLE_INTERFACE.encodeFunctionData("getUnderlyingPrice", [borrowMarketAddress]),
    }, chainConfig ? { chainConfig } : undefined).then((result) =>
      PRICE_ORACLE_INTERFACE.decodeFunctionResult("getUnderlyingPrice", result.returnData)[0]
    ),
  ]);

  const collateralUnderlyingUnits = (BigInt(collateralTokenBalance) * BigInt(collateralExchangeRate)) / 10n ** 18n;
  const borrowBalanceUnits = BigInt(borrowBalance);
  const freeBorrowUnits = BigInt(borrowWalletBalance?.balance ?? 0n);
  const freeCollateralUnits = BigInt(collateralWalletBalance?.balance ?? 0n);
  const collateralUsd36 = collateralUnderlyingUnits * BigInt(collateralPriceMantissa);
  const borrowUsd36 = borrowBalanceUnits * BigInt(borrowPriceMantissa);

  return {
    chain,
    signerAddress,
    collateralToken,
    borrowToken,
    collateralDecimals: collateralAsset.decimals,
    borrowDecimals: borrowAsset.decimals,
    collateralMarketAddress,
    borrowMarketAddress,
    collateralFactorMantissa: BigInt(marketState.collateralFactorMantissa),
    collateralPriceMantissa: BigInt(collateralPriceMantissa),
    borrowPriceMantissa: BigInt(borrowPriceMantissa),
    collateralTokenBalance: BigInt(collateralTokenBalance),
    collateralExchangeRate: BigInt(collateralExchangeRate),
    collateralUnderlyingUnits,
    borrowBalanceUnits,
    freeBorrowUnits,
    freeCollateralUnits,
    collateralUsd36,
    borrowUsd36,
    collateralUsd: usd36ToNumber(collateralUsd36),
    borrowUsd: usd36ToNumber(borrowUsd36),
    freeBorrowUsd: usd36ToNumber(freeBorrowUnits * BigInt(borrowPriceMantissa)),
  };
}

export async function buildCurrentWrappedBtcLoopUnwindBinding({
  strategyId = "wrapped-btc-loop-base-moonwell",
  strategyConfig = {},
  signerAddress,
  client = new OdosClient(),
  readErc20BalanceImpl = readErc20Balance,
  simulateTransactionCallImpl = simulateTransactionCall,
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
} = {}) {
  const position = await readCurrentMoonwellWrappedBtcLoopPosition({
    strategyId,
    strategyConfig,
    signerAddress,
    readErc20BalanceImpl,
    simulateTransactionCallImpl,
  });

  if (position.borrowBalanceUnits <= 0n && position.collateralUnderlyingUnits <= 0n) {
    throw new Error("No current Moonwell wrapped BTC loop position is open on Base");
  }
  if (
    (position.borrowUsd ?? 0) < MIN_MATERIAL_CURRENT_POSITION_USD &&
    (position.collateralUsd ?? 0) < MIN_MATERIAL_CURRENT_POSITION_USD
  ) {
    throw new Error("No material current Moonwell wrapped BTC loop position is open on Base");
  }

  const unwind = [];
  let remainingBorrowUnits = position.borrowBalanceUnits;
  const freeRepayUnits = minBigInt(position.freeBorrowUnits, remainingBorrowUnits);
  if (freeRepayUnits > 0n) {
    const freeRepayAmountUsd = usd36ToNumber(freeRepayUnits * position.borrowPriceMantissa);
    const repayFromWalletApprovalGasLimit = await estimateBufferedGasLimit({
      chain: position.chain,
      from: signerAddress,
      to: position.borrowToken,
      data: ERC20_INTERFACE.encodeFunctionData("approve", [position.borrowMarketAddress, freeRepayUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const repayFromWalletGasLimit = await estimateBufferedGasLimit({
      chain: position.chain,
      from: signerAddress,
      to: position.borrowMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("repayBorrow", [freeRepayUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    unwind.push(
      exactApprovalStep({
        id: "approve-repay-usdc-wallet",
        chain: position.chain,
        token: position.borrowToken,
        spender: position.borrowMarketAddress,
        amount: freeRepayUnits.toString(),
        amountUsd: freeRepayAmountUsd,
        now,
        metadata: {
          kind: "repay_borrow_asset",
          inventorySource: "wallet_balance",
          repayUnits: freeRepayUnits.toString(),
        },
        gasLimit: repayFromWalletApprovalGasLimit,
      }),
      contractCallStep({
        id: "repay-usdc-wallet",
        chain: position.chain,
        to: position.borrowMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("repayBorrow", [freeRepayUnits.toString()]),
        amountUsd: freeRepayAmountUsd,
        now,
        metadata: {
          kind: "repay_borrow_asset",
          inventorySource: "wallet_balance",
          repayUnits: freeRepayUnits.toString(),
          borrowInventoryEffect: "consume",
        },
        gasLimit: repayFromWalletGasLimit,
      }),
    );
    remainingBorrowUnits -= freeRepayUnits;
  }

  let redeemedForRepayUnits = 0n;
  if (remainingBorrowUnits > 0n) {
    const remainingBorrowUsd36 = remainingBorrowUnits * position.borrowPriceMantissa;
    const adjustedBorrowUsd36 = ceilDiv(remainingBorrowUsd36 * 10200n, 10000n);
    const maxSafeRedeemUsd36 = position.collateralUsd36 - ((remainingBorrowUsd36 * 10n ** 18n) / position.collateralFactorMantissa);
    if (maxSafeRedeemUsd36 <= 0n) {
      throw new Error("Current Moonwell position has no safe collateral liquidity available for repay funding");
    }
    const maxSafeRedeemUnits = maxSafeRedeemUsd36 / position.collateralPriceMantissa;
    let redeemForRepayUnits = minBigInt(
      maxSafeRedeemUnits,
      ceilDiv(adjustedBorrowUsd36, position.collateralPriceMantissa),
    );
    if (redeemForRepayUnits <= 0n) {
      redeemForRepayUnits = maxSafeRedeemUnits;
    }

    let fundingSwap = await buildOdosSwapStep({
      id: "swap-collateral-to-repay-current",
      chain: position.chain,
      inputToken: position.collateralToken,
      outputToken: position.borrowToken,
      amount: redeemForRepayUnits.toString(),
      amountUsd: usd36ToNumber(redeemForRepayUnits * position.collateralPriceMantissa),
      signerAddress,
      now,
      client,
      quoteType: "token_to_stable",
      gasBufferBps,
    });
    if (BigInt(fundingSwap.swapStep.quote?.outputAmount || 0n) < remainingBorrowUnits && maxSafeRedeemUnits > redeemForRepayUnits) {
      redeemForRepayUnits = maxSafeRedeemUnits;
      fundingSwap = await buildOdosSwapStep({
        id: "swap-collateral-to-repay-current",
        chain: position.chain,
        inputToken: position.collateralToken,
        outputToken: position.borrowToken,
        amount: redeemForRepayUnits.toString(),
        amountUsd: usd36ToNumber(redeemForRepayUnits * position.collateralPriceMantissa),
        signerAddress,
        now,
      client,
      quoteType: "token_to_stable",
      gasBufferBps,
    });
    }
    const plannedBorrowTopUpUnits = BigInt(fundingSwap.swapStep.quote?.outputAmount || 0n);
    if (plannedBorrowTopUpUnits < remainingBorrowUnits) {
      throw new Error(
        `Current Moonwell position still lacks repay inventory after collateral swap plan: need ${remainingBorrowUnits.toString()}, planned ${plannedBorrowTopUpUnits.toString()}`,
      );
    }

    const redeemForRepayGasLimit = await estimateBufferedGasLimit({
      chain: position.chain,
      from: signerAddress,
      to: position.collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemForRepayUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const approveRepayGasLimit = await estimateBufferedGasLimit({
      chain: position.chain,
      from: signerAddress,
      to: position.borrowToken,
      data: ERC20_INTERFACE.encodeFunctionData("approve", [position.borrowMarketAddress, remainingBorrowUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const repayGasLimit = await estimateBufferedGasLimit({
      chain: position.chain,
      from: signerAddress,
      to: position.borrowMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("repayBorrow", [remainingBorrowUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });

    unwind.push(
      contractCallStep({
        id: "redeem-collateral-for-repay-current",
        chain: position.chain,
        to: position.collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemForRepayUnits.toString()]),
        amountUsd: usd36ToNumber(redeemForRepayUnits * position.collateralPriceMantissa),
        now,
        metadata: {
          kind: "withdraw_collateral_for_repay",
          fundsBorrowRepay: true,
        },
        gasLimit: redeemForRepayGasLimit,
      }),
      {
        ...fundingSwap.approvalStep,
        metadata: {
          ...fundingSwap.approvalStep.metadata,
          kind: "approve_collateral_for_repay_swap",
          fundsBorrowRepay: true,
        },
      },
      {
        ...fundingSwap.swapStep,
        metadata: {
          ...fundingSwap.swapStep.metadata,
          kind: "swap_collateral_to_repay_asset",
          fundsBorrowRepay: true,
          plannedBorrowTopUpUnits: plannedBorrowTopUpUnits.toString(),
        },
      },
      exactApprovalStep({
        id: "approve-repay-usdc-current",
        chain: position.chain,
        token: position.borrowToken,
        spender: position.borrowMarketAddress,
        amount: remainingBorrowUnits.toString(),
        amountUsd: usd36ToNumber(remainingBorrowUsd36),
        now,
        metadata: {
          kind: "repay_borrow_asset",
          inventorySource: "redeemed_collateral_swap",
          repayUnits: remainingBorrowUnits.toString(),
          requiresBorrowAssetInventory: false,
        },
        gasLimit: approveRepayGasLimit,
      }),
      contractCallStep({
        id: "repay-usdc-current",
        chain: position.chain,
        to: position.borrowMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("repayBorrow", [remainingBorrowUnits.toString()]),
        amountUsd: usd36ToNumber(remainingBorrowUsd36),
        now,
        metadata: {
          kind: "repay_borrow_asset",
          inventorySource: "redeemed_collateral_swap",
          repayUnits: remainingBorrowUnits.toString(),
          borrowInventoryEffect: "consume",
          requiresBorrowAssetInventory: false,
        },
        gasLimit: repayGasLimit,
      }),
    );
    redeemedForRepayUnits = redeemForRepayUnits;
    remainingBorrowUnits = 0n;
  }

  const residualCollateralUnits = position.collateralUnderlyingUnits - redeemedForRepayUnits;
  if (residualCollateralUnits > 0n) {
    const redeemResidualGasLimit = await estimateBufferedGasLimit({
      chain: position.chain,
      from: signerAddress,
      to: position.collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [residualCollateralUnits.toString()]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    unwind.push(
      contractCallStep({
        id: "redeem-residual-collateral",
        chain: position.chain,
        to: position.collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [residualCollateralUnits.toString()]),
        amountUsd: usd36ToNumber(residualCollateralUnits * position.collateralPriceMantissa),
        now,
        metadata: {
          kind: "withdraw_residual_collateral",
          residualAfterRepay: true,
        },
        gasLimit: redeemResidualGasLimit,
      }),
    );
  }

  return {
    entry: [],
    unwind,
    notes: [
      "Current-position unwind reads live Moonwell snapshots and builds a signer-owned rescue path.",
      "Rescue plan repays from free USDC first, then redeems/sells safe collateral liquidity only if debt remains.",
    ],
    currentPosition: {
      collateralUnderlyingUnits: position.collateralUnderlyingUnits.toString(),
      borrowBalanceUnits: position.borrowBalanceUnits.toString(),
      freeBorrowUnits: position.freeBorrowUnits.toString(),
      freeCollateralUnits: position.freeCollateralUnits.toString(),
      collateralUsd: position.collateralUsd,
      borrowUsd: position.borrowUsd,
    },
  };
}
