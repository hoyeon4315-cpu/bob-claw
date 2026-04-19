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
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../../strategy/wrapped-btc-lending-loop-slice.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "../../strategy/wrapped-btc-loop-bindings.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "../helpers/gateway-btc-consolidation.mjs";

const BASE_CBBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const COMPTROLLER_INTERFACE = new Interface([
  "function enterMarkets(address[] mTokens)",
]);

const MTOKEN_INTERFACE = new Interface([
  "function mint(uint256 mintAmount)",
  "function borrow(uint256 borrowAmount)",
  "function repayBorrow(uint256 repayAmount)",
  "function redeemUnderlying(uint256 redeemAmount)",
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
    metadata,
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
    quoteType: "stable_to_token",
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
        executionTrust: executableQuote.executionTrust,
        sourceWhitelist: executableQuote.sourceWhitelist,
      },
      tx: {
        value: executableQuote.txValueWei,
        gasLimit: executableQuote.txGasLimit != null ? String(executableQuote.txGasLimit) : undefined,
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
  const collateralPriceUsd = prices?.tokenByKey?.[collateralAsset.priceKey] ?? prices?.btc ?? null;
  if (!Number.isFinite(collateralPriceUsd)) {
    throw new Error("Repo auto-build requires a current cbBTC/BTC USD price");
  }
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
  const availableCollateralBalance = await readErc20BalanceImpl("base", collateralToken, signerAddress);
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
    const recycledCollateralUnits = unitsFromUsd(
      iteration.recycledCollateralUsd,
      collateralPriceUsd,
      collateralAsset.decimals,
    );
    if (!borrowUnits || !recycledCollateralUnits) {
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
    });
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
      data: ERC20_INTERFACE.encodeFunctionData("approve", [collateralMarketAddress, recycledCollateralUnits]),
      estimateGasImpl,
      gasBufferBps,
      allowFailure: true,
    });
    const recycledMintGasLimit = await estimateBufferedGasLimit({
      chain: "base",
      from: signerAddress,
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("mint", [recycledCollateralUnits]),
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
        amount: recycledCollateralUnits,
        amountUsd: iteration.recycledCollateralUsd,
        now,
        metadata: {
          kind: "approve_recycled_collateral",
          iteration: iteration.iteration,
          capCheckAmountUsd: 0,
        },
        gasLimit: recycledApprovalGasLimit,
      }),
      contractCallStep({
        id: `mint-recycled-collateral-${iteration.iteration}`,
        chain: "base",
        to: collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("mint", [recycledCollateralUnits]),
        amountUsd: iteration.recycledCollateralUsd,
        now,
        metadata: {
          kind: "deposit_recycled_collateral",
          iteration: iteration.iteration,
          capCheckAmountUsd: 0,
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
          requiresBorrowAssetInventory: true,
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
          requiresBorrowAssetInventory: true,
        },
        gasLimit: repayGasLimit,
      }),
      contractCallStep({
        id: `redeem-collateral-${iteration.iteration}`,
        chain: "base",
        to: collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemUnits]),
        amountUsd: iteration.inputCollateralUsd,
        now,
        metadata: {
          kind: "withdraw_recycled_collateral",
          iteration: iteration.iteration,
        },
        gasLimit: redeemGasLimit,
      }),
    );
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
      "Unwind repayment steps require borrow-asset inventory or equivalent capital-manager funding before execution.",
    ].filter(Boolean),
  };
}
