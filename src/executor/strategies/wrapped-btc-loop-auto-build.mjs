import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import {
  attachOdosAssembly,
  normalizeOdosQuote,
  OdosClient,
  odosRoutingConfig,
  STABLE_QUOTE_TOKENS,
} from "../../dex/odos.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../../strategy/wrapped-btc-lending-loop-slice.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "../../strategy/wrapped-btc-loop-bindings.mjs";

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

function exactApprovalStep({ id, chain, token, spender, amount, amountUsd, now, metadata = {} }) {
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
    },
    metadata,
  };
}

function contractCallStep({ id, chain, to, data, amountUsd, now, metadata = {}, quote = null, tx = {} }) {
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

  const scaffold = buildWrappedBtcLendingLoopScaffold({
    strategyConfig,
    now,
  });
  const collateralMarketAddress = support.knownContracts.collateralMarket.mTokenAddress;
  const borrowMarketAddress = support.knownContracts.borrowMarket.mTokenAddress;
  const comptrollerAddress = support.knownContracts.comptroller.address;

  const initialCollateralUnits = unitsFromUsd(strategyConfig.perTradeCapUsd, collateralPriceUsd, collateralAsset.decimals);
  if (!initialCollateralUnits) {
    throw new Error("Failed to derive initial cbBTC collateral units");
  }

  const entry = [
    exactApprovalStep({
      id: "approve-initial-collateral",
      chain: "base",
      token: collateralToken,
      spender: collateralMarketAddress,
      amount: initialCollateralUnits,
      amountUsd: strategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "approve_exact_collateral",
      },
    }),
    contractCallStep({
      id: "enter-collateral-market",
      chain: "base",
      to: comptrollerAddress,
      data: COMPTROLLER_INTERFACE.encodeFunctionData("enterMarkets", [[collateralMarketAddress]]),
      amountUsd: strategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "enter_markets",
      },
    }),
    contractCallStep({
      id: "mint-initial-collateral",
      chain: "base",
      to: collateralMarketAddress,
      data: MTOKEN_INTERFACE.encodeFunctionData("mint", [initialCollateralUnits]),
      amountUsd: strategyConfig.perTradeCapUsd,
      now,
      metadata: {
        kind: "deposit_initial_collateral",
      },
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
        },
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
        },
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
        },
      }),
    );
  }

  const unwind = [];
  for (const iteration of [...(scaffold.entryPlan?.iterations || [])].reverse()) {
    const repayUnits = decimalToUnits(iteration.borrowUsd, borrowAsset.decimals);
    const redeemUnits = unitsFromUsd(iteration.inputCollateralUsd, collateralPriceUsd, collateralAsset.decimals);
    if (!repayUnits || !redeemUnits) {
      throw new Error(`Failed to derive unwind units for iteration ${iteration.iteration}`);
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
          requiresBorrowAssetInventory: true,
        },
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
      }),
      contractCallStep({
        id: `redeem-collateral-${iteration.iteration}`,
        chain: "base",
        to: collateralMarketAddress,
        data: MTOKEN_INTERFACE.encodeFunctionData("redeemUnderlying", [redeemUnits]),
        amountUsd: iteration.inputCollateralUsd,
        now,
        metadata: {
          kind: "withdraw_collateral",
          iteration: iteration.iteration,
        },
      }),
    );
  }

  return {
    entry,
    unwind,
    notes: [
      "Repo auto-build generated Moonwell core calldata and Odos safe-whitelist swap calldata.",
      "Unwind repayment steps require borrow-asset inventory or equivalent capital-manager funding before execution.",
    ],
  };
}
