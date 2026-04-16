import { odosSafeSourceWhitelist } from "../dex/odos.mjs";

const MOONWELL_CONTRACTS_DOCS_URL = "https://docs.moonwell.fi/moonwell/protocol-information/contracts";
const MOONWELL_MTOKENS_DOCS_URL = "https://docs.moonwell.fi/moonwell/developers/protocol/mtokens";
const MOONWELL_CORE_MARKET_GUIDE_URL = "https://docs.moonwell.fi/moonwell/developers/guides/core-market-integration";
const ODOS_API_DOCS_URL = "https://docs.odos.xyz/build/quickstart/sor";

export const WRAPPED_BTC_LOOP_BINDINGS_SCHEMA_VERSION = 1;

const OFFICIAL_MOONWELL_BASE_MARKETS = Object.freeze({
  USDC: Object.freeze({
    asset: "USDC",
    marketId: "base:usdc",
    mTokenAddress: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    sourceLabel: "Moonwell USDC",
  }),
  cbBTC: Object.freeze({
    asset: "cbBTC",
    marketId: "base:cbbtc",
    mTokenAddress: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
    sourceLabel: "Moonwell cbBTC",
  }),
});

const OFFICIAL_MOONWELL_BASE_COMPTROLLER = Object.freeze({
  address: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
  sourceLabel: "Moonwell Comptroller",
});

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHexAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function isHexData(value) {
  return /^0x(?:[a-fA-F0-9]{2})+$/.test(String(value || ""));
}

function finitePath(values = []) {
  return Array.isArray(values) ? values.filter(Number.isFinite) : [];
}

function normalizeKnownMarket(market = null) {
  if (!market) return null;
  return {
    asset: market.asset,
    marketId: market.marketId,
    mTokenAddress: market.mTokenAddress,
    source: {
      label: market.sourceLabel,
      url: MOONWELL_CONTRACTS_DOCS_URL,
    },
  };
}

function authoritativeSources() {
  return [
    {
      label: "Moonwell contracts docs",
      url: MOONWELL_CONTRACTS_DOCS_URL,
    },
    {
      label: "Moonwell mTokens docs",
      url: MOONWELL_MTOKENS_DOCS_URL,
    },
    {
      label: "Moonwell core market integration guide",
      url: MOONWELL_CORE_MARKET_GUIDE_URL,
    },
    {
      label: "Odos SOR quickstart",
      url: ODOS_API_DOCS_URL,
    },
  ];
}

export function resolveWrappedBtcLoopBindingSupport({
  strategyId = "wrapped-btc-loop-base-moonwell",
  strategyConfig = {},
} = {}) {
  const requestedVenue = {
    strategyId,
    chain: strategyConfig.chain || null,
    protocol: strategyConfig.protocol || null,
    collateralAsset: strategyConfig.collateralAsset || null,
    borrowAsset: strategyConfig.borrowAsset || null,
  };
  const blockers = [];
  const missingFacts = [];
  const warnings = [];
  const collateralMarket = normalizeKnownMarket(OFFICIAL_MOONWELL_BASE_MARKETS[strategyConfig.collateralAsset]);
  const borrowMarket = normalizeKnownMarket(OFFICIAL_MOONWELL_BASE_MARKETS[strategyConfig.borrowAsset]);
  const swapSource =
    requestedVenue.chain === "base" && collateralMarket && borrowMarket
      ? {
          provider: "odos",
          chain: "base",
          routingMode: "safe_whitelist",
          sourceWhitelist: odosSafeSourceWhitelist("base"),
          source: {
            label: "Odos SOR quickstart",
            url: ODOS_API_DOCS_URL,
          },
        }
      : null;
  const marketResolution = {
    collateralMarketResolved: Boolean(collateralMarket),
    borrowMarketResolved: Boolean(borrowMarket),
    allAuthoritativeMarketsResolved: Boolean(collateralMarket && borrowMarket),
    repoSwapSourceResolved: Boolean(swapSource),
  };

  if (requestedVenue.chain !== "base") {
    blockers.push("unsupported_chain_for_authoritative_registry");
    missingFacts.push(`Authoritative registry currently covers Moonwell Base only; received chain=${requestedVenue.chain || "unknown"}.`);
  }
  if (requestedVenue.protocol !== "moonwell") {
    blockers.push("unsupported_protocol_for_authoritative_registry");
    missingFacts.push(
      `Authoritative registry currently covers Moonwell only; received protocol=${requestedVenue.protocol || "unknown"}.`,
    );
  }
  if (!collateralMarket) {
    blockers.push("authoritative_collateral_market_missing");
    missingFacts.push(
      `Moonwell official Base contracts docs do not currently publish a ${requestedVenue.collateralAsset || "unknown"} market address.`,
    );
  }
  if (!borrowMarket) {
    blockers.push("authoritative_borrow_market_missing");
    missingFacts.push(
      `Moonwell official Base contracts docs do not currently publish a ${requestedVenue.borrowAsset || "unknown"} market address.`,
    );
  }

  if (!swapSource) {
    blockers.push("swap_router_binding_missing");
    missingFacts.push(
      "The repo still does not provide an allowlisted Base swap router/path encoder that can deterministically materialize the USDC↔collateral swap calldata required by the live batch runner.",
    );
  }
  if (marketResolution.allAuthoritativeMarketsResolved) {
    warnings.push(
      swapSource
        ? "Moonwell official Base docs resolve both cbBTC/USDC market addresses for this lane, and repo auto-build can source Odos safe-whitelist swap calldata."
        : "Moonwell official Base docs resolve both cbBTC/USDC market addresses for this lane; live readiness still depends on allowlisted swap calldata plus signer-backed receipts.",
    );
  }
  warnings.push(
    "Moonwell market addresses alone are insufficient for live readiness because the lane still needs signer-backed receiptContext values measured from fork or live execution.",
  );
  const executableFromRepo = Boolean(marketResolution.allAuthoritativeMarketsResolved && swapSource);

  return {
    strategyId,
    status:
      blockers.includes("authoritative_collateral_market_missing") || blockers.includes("authoritative_borrow_market_missing")
        ? "authoritative_market_missing"
        : executableFromRepo
          ? "repo_auto_build_supported"
          : "moonwell_markets_resolved_swap_bindings_missing",
    executableFromRepo,
    requestedVenue,
    marketResolution,
    authoritativeSources: authoritativeSources(),
    knownContracts: {
      comptroller: {
        address: OFFICIAL_MOONWELL_BASE_COMPTROLLER.address,
        source: {
          label: OFFICIAL_MOONWELL_BASE_COMPTROLLER.sourceLabel,
          url: MOONWELL_CONTRACTS_DOCS_URL,
        },
      },
      collateralMarket,
      borrowMarket,
    },
    swapSource,
    deterministicMoonwellPath: [
      "approve collateral underlying to the collateral mToken",
      "enter the collateral market via Comptroller.enterMarkets",
      "mint collateral via collateral mToken.mint",
      "borrow the debt asset via borrow mToken.borrow",
      executableFromRepo
        ? "swap borrowed USDC back into collateral through Odos safe-whitelist quote + assemble"
        : "swap borrowed USDC back into collateral with signer-owned allowlisted calldata",
      "repay via borrow mToken.repayBorrow during unwind",
      "redeem collateral via collateral mToken.redeemUnderlying during unwind",
    ],
    blockers: unique(blockers),
    missingFacts: unique(missingFacts),
    warnings: unique(warnings),
    nextActions: unique([
      collateralMarket
        ? null
        : `confirm an official Moonwell Base ${requestedVenue.collateralAsset || "collateral"} market before attempting live bindings`,
      borrowMarket
        ? null
        : `confirm an official Moonwell Base ${requestedVenue.borrowAsset || "borrow"} market before attempting live bindings`,
      executableFromRepo ? null : "materialize signer-owned swap calldata from an allowlisted Base router/quote path",
      "capture signer-backed entry and unwind receipts before any live promotion",
    ]),
  };
}

function inspectStep(step = {}, label, errors, warnings) {
  if (!isObject(step)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!isObject(step.tx)) {
    errors.push(`${label}.tx must be an object`);
    return;
  }
  if (!isHexAddress(step.tx.to)) {
    errors.push(`${label}.tx.to must be a 20-byte hex address`);
  }
  if (!isHexData(step.tx.data)) {
    errors.push(`${label}.tx.data must be non-empty hex calldata`);
  }
  if (step.tx.value !== undefined && step.tx.value !== null && !/^\d+$/.test(String(step.tx.value))) {
    errors.push(`${label}.tx.value must be an integer string when provided`);
  }
  if (step.amountUsd !== undefined && step.amountUsd !== null && !Number.isFinite(Number(step.amountUsd))) {
    errors.push(`${label}.amountUsd must be finite when provided`);
  }
  if (step.chain !== undefined && step.chain !== null && typeof step.chain !== "string") {
    errors.push(`${label}.chain must be a string when provided`);
  }
  if (step.quote?.observedAt !== undefined && typeof step.quote.observedAt !== "string") {
    errors.push(`${label}.quote.observedAt must be a string when provided`);
  }
  if (step.metadata !== undefined && !isObject(step.metadata)) {
    errors.push(`${label}.metadata must be an object when provided`);
  }
  if (step.approval !== undefined && step.approval !== null && !isObject(step.approval)) {
    warnings.push(`${label}.approval should be an object when provided`);
  }
}

export function inspectWrappedBtcLoopBindingsDocument({
  bindingsDocument,
  strategyId = "wrapped-btc-loop-base-moonwell",
  scenarioId = null,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(bindingsDocument)) {
    errors.push("bindings document must be an object");
  }
  if (!Number.isInteger(bindingsDocument?.schemaVersion)) {
    warnings.push("bindings document should declare an integer schemaVersion");
  }
  if (!isObject(bindingsDocument?.strategies)) {
    errors.push("bindings document must contain a strategies object");
  }

  const strategyBindings = bindingsDocument?.strategies?.[strategyId];
  if (!isObject(strategyBindings)) {
    errors.push(`strategy bindings missing for ${strategyId}`);
  }
  if (!isObject(strategyBindings?.scenarios)) {
    errors.push(`strategy bindings for ${strategyId} must contain a scenarios object`);
  }

  const scenarioEntries = scenarioId
    ? [[scenarioId, strategyBindings?.scenarios?.[scenarioId]]]
    : Object.entries(strategyBindings?.scenarios || {});

  if (scenarioEntries.length === 0) {
    errors.push(`strategy bindings for ${strategyId} must contain at least one scenario`);
  }

  for (const [currentScenarioId, scenarioBinding] of scenarioEntries) {
    if (!isObject(scenarioBinding)) {
      errors.push(`scenario bindings missing for ${strategyId}:${currentScenarioId}`);
      continue;
    }
    if (!Array.isArray(scenarioBinding.entry)) {
      errors.push(`scenario ${strategyId}:${currentScenarioId} must contain an entry array`);
    } else {
      scenarioBinding.entry.forEach((step, index) =>
        inspectStep(step, `${strategyId}:${currentScenarioId}:entry[${index}]`, errors, warnings),
      );
    }
    if (!Array.isArray(scenarioBinding.unwind)) {
      errors.push(`scenario ${strategyId}:${currentScenarioId} must contain an unwind array`);
    } else {
      scenarioBinding.unwind.forEach((step, index) =>
        inspectStep(step, `${strategyId}:${currentScenarioId}:unwind[${index}]`, errors, warnings),
      );
    }

    const receiptContext = scenarioBinding.receiptContext;
    if (receiptContext !== undefined && receiptContext !== null) {
      if (!isObject(receiptContext)) {
        errors.push(`scenario ${strategyId}:${currentScenarioId} receiptContext must be an object`);
      } else {
        if (
          receiptContext.observedHealthFactorPath !== undefined &&
          !Array.isArray(receiptContext.observedHealthFactorPath)
        ) {
          errors.push(`scenario ${strategyId}:${currentScenarioId} observedHealthFactorPath must be an array when provided`);
        } else if (
          receiptContext.observedHealthFactorPath !== undefined &&
          finitePath(receiptContext.observedHealthFactorPath).length !==
            (receiptContext.observedHealthFactorPath || []).length
        ) {
          errors.push(`scenario ${strategyId}:${currentScenarioId} observedHealthFactorPath must contain only finite numbers`);
        }
        if (
          receiptContext.observedLiquidationBufferPath !== undefined &&
          !Array.isArray(receiptContext.observedLiquidationBufferPath)
        ) {
          errors.push(
            `scenario ${strategyId}:${currentScenarioId} observedLiquidationBufferPath must be an array when provided`,
          );
        } else if (
          receiptContext.observedLiquidationBufferPath !== undefined &&
          finitePath(receiptContext.observedLiquidationBufferPath).length !==
            (receiptContext.observedLiquidationBufferPath || []).length
        ) {
          errors.push(
            `scenario ${strategyId}:${currentScenarioId} observedLiquidationBufferPath must contain only finite numbers`,
          );
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    strategyBindings: isObject(strategyBindings) ? strategyBindings : null,
    scenarioIds: scenarioEntries.map(([id]) => id).filter(Boolean),
  };
}

export function buildWrappedBtcLoopBindingsTemplate({
  strategyId = "wrapped-btc-loop-base-moonwell",
  strategyConfig = {},
  scenarioId = "healthy_baseline",
  now = null,
} = {}) {
  const support = resolveWrappedBtcLoopBindingSupport({ strategyId, strategyConfig });
  return {
    schemaVersion: WRAPPED_BTC_LOOP_BINDINGS_SCHEMA_VERSION,
    generatedAt: now || new Date().toISOString(),
    generatedBy: "generate-wrapped-btc-loop-bindings-template",
    strategies: {
      [strategyId]: {
        chain: strategyConfig.chain || null,
        protocol: strategyConfig.protocol || null,
        collateralAsset: strategyConfig.collateralAsset || null,
        borrowAsset: strategyConfig.borrowAsset || null,
        bindingStatus: support.status,
        marketResolution: support.marketResolution,
        authoritativeSources: support.authoritativeSources,
        knownContracts: support.knownContracts,
        deterministicMoonwellPath: support.deterministicMoonwellPath,
        missingFacts: support.missingFacts,
        warnings: support.warnings,
        swapSource: support.swapSource,
        scenarios: {
          [scenarioId]: {
            status: support.executableFromRepo ? "repo_auto_build_supported" : "requires_manual_signer_binding",
            entry: [],
            unwind: [],
            receiptContext: {
              executionMode: "signer_backed_receipt",
              result: "passed",
              observedHealthFactorPath: [],
              observedLiquidationBufferPath: [],
              notes: unique([
                support.executableFromRepo
                  ? "Entry/unwind arrays may remain empty because the repo can auto-build Moonwell core txs plus Odos safe-whitelist swap calldata at runtime."
                  : "Populate entry/unwind only from signer-owned, allowlisted contract bindings.",
                "Do not invent Moonwell market or swap router calldata inside the repository.",
                "Receipt fields must come from fork-backed or live signer execution, not paper estimates.",
              ]),
            },
          },
        },
      },
    },
  };
}
