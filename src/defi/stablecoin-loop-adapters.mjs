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
    id: "morpho_base_usdc_usdt",
    protocol: "morpho",
    chain: "base",
    collateralAsset: "USDC",
    borrowAsset: "USDT",
    stage: "planning_ready",
    collateralMarketId: "base:usdc",
    borrowMarketId: "base:usdt",
    oracleModel: "stable_pair_oracle_with_usd_sanity_check",
    referenceOracles: ["chainlink", "pyth"],
    unwindRoute: "repay USDT debt first, then release USDC collateral back into the treasury sleeve",
    notes: [
      "Stablecoin loops stay deterministic only when peg drift, unwind gas, and borrow spread are checked before every expansion step.",
      "Adapter is planning-safe and avoids hardcoding signer-owned calldata or private venue bindings.",
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

export function resolveStablecoinLoopAdapter(config = {}) {
  return (
    ADAPTERS.find((adapter) =>
      matches(adapter, {
        protocol: config.protocol,
        chain: config.chain,
        collateralAsset: config.collateralAsset,
        borrowAsset: config.borrowAsset,
      })) || null
  );
}

export function buildStablecoinLoopExecutionActions({ adapter = null, loop = null, strategyConfig = {} } = {}) {
  if (!adapter || !loop) return [];
  const collateralAsset = strategyConfig.collateralAsset || adapter.collateralAsset;
  const borrowAsset = strategyConfig.borrowAsset || adapter.borrowAsset;
  const actions = [
    {
      step: 1,
      kind: "approve_exact_collateral",
      asset: collateralAsset,
      amountUsd: round(strategyConfig.perTradeCapUsd),
      target: adapter.collateralMarketId,
    },
    {
      step: 2,
      kind: "deposit_initial_collateral",
      marketId: adapter.collateralMarketId,
      asset: collateralAsset,
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
        asset: borrowAsset,
        amountUsd: iteration.borrowUsd,
      },
      {
        step: actions.length + 2,
        iteration: iteration.iteration,
        kind: "swap_borrow_to_collateral",
        fromAsset: borrowAsset,
        toAsset: collateralAsset,
        inputUsd: iteration.borrowUsd,
        expectedPostFeeCollateralUsd: iteration.recycledCollateralUsd,
      },
      {
        step: actions.length + 3,
        iteration: iteration.iteration,
        kind: "deposit_recycled_collateral",
        marketId: adapter.collateralMarketId,
        asset: collateralAsset,
        amountUsd: iteration.recycledCollateralUsd,
      },
      {
        step: actions.length + 4,
        iteration: iteration.iteration,
        kind: "verify_health_factor",
        minimum: strategyConfig.healthFactorMin,
      },
      {
        step: actions.length + 5,
        iteration: iteration.iteration,
        kind: "verify_peg_drift",
        maximumPct: strategyConfig.pegDriftTriggerPct ?? null,
      },
    );
  }

  return actions;
}

export function buildStablecoinLoopUnwindActions({ adapter = null, loop = null, strategyConfig = {} } = {}) {
  if (!adapter || !loop) return [];
  const collateralAsset = strategyConfig.collateralAsset || adapter.collateralAsset;
  const borrowAsset = strategyConfig.borrowAsset || adapter.borrowAsset;
  const actions = [
    {
      step: 1,
      kind: "halt_new_loop_entries",
      reason: "protect stable collateral before unwind sequence begins",
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
        asset: borrowAsset,
        targetUsd: iteration.borrowUsd,
      },
      {
        step: actions.length + 2,
        iteration: iteration.iteration,
        kind: "withdraw_collateral",
        marketId: adapter.collateralMarketId,
        asset: collateralAsset,
        targetUsd: iteration.inputCollateralUsd,
      },
      {
        step: actions.length + 3,
        iteration: iteration.iteration,
        kind: "verify_health_factor",
        minimum: strategyConfig.unwindTriggerHealthFactor,
      },
      {
        step: actions.length + 4,
        iteration: iteration.iteration,
        kind: "verify_peg_drift",
        maximumPct: strategyConfig.pegDriftTriggerPct ?? null,
      },
    );
  }
  actions.push(
    {
      step: actions.length + 1,
      kind: "withdraw_residual_collateral",
      marketId: adapter.collateralMarketId,
      asset: collateralAsset,
    },
    {
      step: actions.length + 2,
      kind: "return_collateral_to_treasury",
      asset: collateralAsset,
    },
  );
  return actions;
}

export function summarizeStablecoinLoopAdapter(adapter = null) {
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
