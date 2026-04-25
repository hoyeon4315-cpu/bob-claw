function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const ADAPTERS = Object.freeze([
  {
    id: "moonwell_base_cbbtc_usdc",
    protocol: "moonwell",
    chain: "base",
    collateralAsset: "cbBTC",
    borrowAsset: "USDC",
    stage: "planning_ready",
    collateralMarketId: "base:cbbtc",
    borrowMarketId: "base:usdc",
    oracleModel: "protocol_oracle_with_btc_usd_sanity_check",
    referenceOracles: ["chainlink", "pyth"],
    unwindRoute: "swap borrowed USDC back into collateral only when repay inventory is insufficient",
    notes: [
      "Moonwell Base official docs publish cbBTC and USDC markets, and the repo can now auto-build Odos safe-whitelist swap calldata for this lane.",
      "Exact contract addresses stay outside the LLM planning path until the signer/executor binds the allowlisted deployment.",
      "Adapter assumes exact-amount approvals only and post-action health-factor verification after every borrow leg.",
    ],
  },
]);

function matches(adapter, { protocol = null, chain = null, collateralAsset = null, borrowAsset = null } = {}) {
  return (
    adapter.protocol === protocol &&
    adapter.chain === chain &&
    adapter.collateralAsset === collateralAsset &&
    adapter.borrowAsset === borrowAsset
  );
}

export function resolveWrappedBtcLoopAdapter(config = {}) {
  return (
    ADAPTERS.find((adapter) =>
      matches(adapter, {
        protocol: config.protocol,
        chain: config.chain,
        collateralAsset: config.collateralAsset,
        borrowAsset: config.borrowAsset,
      }),
    ) || null
  );
}

export function buildWrappedBtcLoopExecutionActions({ adapter = null, loop = null, strategyConfig = {} } = {}) {
  if (!adapter || !loop) return [];
  const actions = [
    {
      step: 1,
      kind: "approve_exact_collateral",
      asset: strategyConfig.collateralAsset || adapter.collateralAsset,
      amountUsd: round(strategyConfig.perTradeCapUsd),
      target: adapter.collateralMarketId,
    },
    {
      step: 2,
      kind: "deposit_initial_collateral",
      marketId: adapter.collateralMarketId,
      asset: strategyConfig.collateralAsset || adapter.collateralAsset,
      amountUsd: round(strategyConfig.perTradeCapUsd),
    },
  ];

  for (const iteration of loop.iterations || []) {
    actions.push(
      {
        step: actions.length + 1,
        iteration: iteration.iteration,
        kind: "borrow_against_collateral",
        marketId: adapter.borrowMarketId,
        asset: strategyConfig.borrowAsset || adapter.borrowAsset,
        amountUsd: iteration.borrowUsd,
      },
      {
        step: actions.length + 2,
        iteration: iteration.iteration,
        kind: "swap_borrow_to_collateral",
        fromAsset: strategyConfig.borrowAsset || adapter.borrowAsset,
        toAsset: strategyConfig.collateralAsset || adapter.collateralAsset,
        inputUsd: iteration.borrowUsd,
        expectedPostFeeCollateralUsd: iteration.recycledCollateralUsd,
      },
      {
        step: actions.length + 3,
        iteration: iteration.iteration,
        kind: "deposit_recycled_collateral",
        marketId: adapter.collateralMarketId,
        asset: strategyConfig.collateralAsset || adapter.collateralAsset,
        amountUsd: iteration.recycledCollateralUsd,
      },
      {
        step: actions.length + 4,
        iteration: iteration.iteration,
        kind: "verify_health_factor",
        minimum: strategyConfig.healthFactorMin,
      },
    );
  }

  return actions;
}

export function buildWrappedBtcLoopUnwindActions({ adapter = null, loop = null, strategyConfig = {} } = {}) {
  if (!adapter || !loop) return [];
  const actions = [
    {
      step: 1,
      kind: "halt_new_loop_entries",
      reason: "protect collateral before unwind sequence begins",
    },
  ];
  const reversedIterations = [...(loop.iterations || [])].reverse();
  for (const iteration of reversedIterations) {
    actions.push(
      {
        step: actions.length + 1,
        iteration: iteration.iteration,
        kind: "repay_borrow_asset",
        marketId: adapter.borrowMarketId,
        asset: strategyConfig.borrowAsset || adapter.borrowAsset,
        targetUsd: iteration.borrowUsd,
      },
      {
        step: actions.length + 2,
        iteration: iteration.iteration,
        kind: "withdraw_collateral",
        marketId: adapter.collateralMarketId,
        asset: strategyConfig.collateralAsset || adapter.collateralAsset,
        targetUsd: iteration.inputCollateralUsd,
      },
      {
        step: actions.length + 3,
        iteration: iteration.iteration,
        kind: "verify_health_factor",
        minimum: strategyConfig.unwindTriggerHealthFactor,
      },
    );
  }
  actions.push(
    {
      step: actions.length + 1,
      kind: "withdraw_residual_collateral",
      marketId: adapter.collateralMarketId,
      asset: strategyConfig.collateralAsset || adapter.collateralAsset,
    },
    {
      step: actions.length + 2,
      kind: "return_collateral_to_treasury",
      asset: strategyConfig.collateralAsset || adapter.collateralAsset,
    },
  );
  return actions;
}

export function summarizeWrappedBtcLoopAdapter(adapter = null) {
  if (!adapter) return null;
  return {
    id: adapter.id,
    protocol: adapter.protocol,
    chain: adapter.chain,
    collateralAsset: adapter.collateralAsset,
    borrowAsset: adapter.borrowAsset,
    stage: adapter.stage,
    marketIds: unique([adapter.collateralMarketId, adapter.borrowMarketId]),
    oracleModel: adapter.oracleModel || null,
    referenceOracles: unique(adapter.referenceOracles || []),
  };
}
