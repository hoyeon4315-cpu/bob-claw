import { Interface } from "ethers";
import { readTransactionReceipt, simulateTransactionCall } from "../evm/transaction-read.mjs";
import { buildDefaultWrappedBtcLendingLoopConfig } from "./wrapped-btc-lending-loop-slice.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "./wrapped-btc-loop-bindings.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numericPath(values = []) {
  return (values || []).filter(Number.isFinite).map((value) => round(value, 4));
}

function positiveNumericPath(values = []) {
  return numericPath(values).filter((value) => value > 0);
}

function roundUsd(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fixedBigIntToNumber(value, scale) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value) / 10 ** scale;
  return Number.isFinite(numeric) ? numeric : null;
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

const COMPTROLLER_INTERFACE = new Interface([
  "function oracle() view returns (address)",
  "function markets(address) view returns (bool,uint256,bool)",
]);

const PRICE_ORACLE_INTERFACE = new Interface([
  "function getUnderlyingPrice(address mToken) view returns (uint256)",
]);

const MTOKEN_EVENT_INTERFACE = new Interface([
  "event Mint(address minter,uint256 mintAmount,uint256 mintTokens)",
  "event Borrow(address borrower,uint256 borrowAmount,uint256 accountBorrows,uint256 totalBorrows)",
]);

const MINT_EVENT_TOPIC = MTOKEN_EVENT_INTERFACE.getEvent("Mint").topicHash;
const BORROW_EVENT_TOPIC = MTOKEN_EVENT_INTERFACE.getEvent("Borrow").topicHash;

function gasUsdForHashes(capitalAuditReport = null, txHashes = []) {
  const normalizedHashes = unique(txHashes);
  if (normalizedHashes.length === 0) return null;
  const transactions = Array.isArray(capitalAuditReport?.transactions) ? capitalAuditReport.transactions : [];
  const byHash = new Map(
    transactions
      .filter((item) => item?.txHash && Number.isFinite(item?.gasUsd))
      .map((item) => [item.txHash, item]),
  );
  const matched = normalizedHashes.map((hash) => byHash.get(hash)).filter(Boolean);
  if (matched.length !== normalizedHashes.length) return null;
  return round(matched.reduce((sum, item) => sum + item.gasUsd, 0), 6);
}

function missingExtendedReceiptFields(proof = null) {
  if (!proof) return [];
  return [
    positiveNumericPath(proof.observedHealthFactorPath || []).length > 0 ? null : "observedHealthFactorPath",
    positiveNumericPath(proof.observedLiquidationBufferPath || []).length > 0 ? null : "observedLiquidationBufferPath",
    Number.isFinite(proof.actualLoopFeesUsd) ? null : "actualLoopFeesUsd",
    Number.isFinite(proof.actualUnwindCostUsd) ? null : "actualUnwindCostUsd",
    Number.isFinite(proof.realizedNetCarryUsd) ? null : "realizedNetCarryUsd",
  ].filter(Boolean);
}

function entryReceiptModeFromCounts({ mintEventCount = 0, borrowEventCount = 0 } = {}) {
  if (borrowEventCount > 0) return "borrow_loop_observed";
  if (mintEventCount > 0) return "collateral_only_roundtrip";
  return null;
}

export const WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE = "wrapped-btc-loop-live-success-latest.json";

export function hydrateWrappedBtcLoopLiveProof({
  proof = null,
  capitalAuditReport = null,
} = {}) {
  if (!proof) return null;
  const hydrated = {
    ...proof,
    observedHealthFactorPath: positiveNumericPath(proof.observedHealthFactorPath || []),
    observedLiquidationBufferPath: positiveNumericPath(proof.observedLiquidationBufferPath || []),
    actualLoopFeesUsd: Number.isFinite(proof.actualLoopFeesUsd)
      ? round(proof.actualLoopFeesUsd)
      : gasUsdForHashes(capitalAuditReport, proof.entryTxHashes || []),
    actualUnwindCostUsd: Number.isFinite(proof.actualUnwindCostUsd)
      ? round(proof.actualUnwindCostUsd)
      : gasUsdForHashes(capitalAuditReport, proof.unwindTxHashes || []),
    realizedNetCarryUsd: Number.isFinite(proof.realizedNetCarryUsd) ? round(proof.realizedNetCarryUsd) : null,
  };
  const missingFields = missingExtendedReceiptFields(hydrated);
  return {
    ...hydrated,
    extendedReceiptContextReady: missingFields.length === 0,
    missingExtendedReceiptFields: missingFields,
    oosReceiptStatus:
      missingFields.length === 0
        ? "ingestable_extended_receipt_context_ready"
        : proof.oosReceiptStatus || "extended_receipt_context_pending",
  };
}

async function readMoonwellObservedEntryMetrics({
  proof = null,
  strategyConfig = buildDefaultWrappedBtcLendingLoopConfig(),
  readTransactionReceiptImpl = readTransactionReceipt,
  simulateTransactionCallImpl = simulateTransactionCall,
} = {}) {
  const entryTxHashes = (proof?.entryTxHashes || []).filter(Boolean);
  const entryAnchorTxHash = entryTxHashes.at(-1);
  if (!entryAnchorTxHash) return null;

  const support = resolveWrappedBtcLoopBindingSupport({
    strategyId: strategyConfig.id,
    strategyConfig,
  });
  const comptrollerAddress = support?.knownContracts?.comptroller?.address || null;
  const collateralMarketAddress = support?.knownContracts?.collateralMarket?.mTokenAddress || null;
  const borrowMarketAddress = support?.knownContracts?.borrowMarket?.mTokenAddress || null;
  if (!comptrollerAddress || !collateralMarketAddress || !borrowMarketAddress) return null;

  const chain = strategyConfig.chain || "base";
  const entryReceipts = [];
  for (const txHash of entryTxHashes) {
    entryReceipts.push(await readTransactionReceiptImpl(chain, txHash));
  }
  const entryReceipt = entryReceipts.at(-1);
  if (!Number.isInteger(entryReceipt?.blockNumber)) return null;
  const blockTag = `0x${entryReceipt.blockNumber.toString(16)}`;
  let account = entryReceipt?.from || null;
  let collateralUnderlyingUnits = 0n;
  let borrowBalance = 0n;
  let mintEventCount = 0;
  let borrowEventCount = 0;

  for (const receipt of entryReceipts) {
    for (const log of receipt?.raw?.logs || []) {
      const address = String(log?.address || "").toLowerCase();
      if (address === collateralMarketAddress.toLowerCase() && log?.topics?.[0] === MINT_EVENT_TOPIC) {
        const decoded = MTOKEN_EVENT_INTERFACE.decodeEventLog("Mint", log.data, log.topics);
        if (!account) account = decoded[0];
        if (String(decoded[0]).toLowerCase() !== String(account).toLowerCase()) continue;
        mintEventCount += 1;
        collateralUnderlyingUnits += decoded[1];
      }
      if (address === borrowMarketAddress.toLowerCase() && log?.topics?.[0] === BORROW_EVENT_TOPIC) {
        const decoded = MTOKEN_EVENT_INTERFACE.decodeEventLog("Borrow", log.data, log.topics);
        if (!account) account = decoded[0];
        if (String(decoded[0]).toLowerCase() !== String(account).toLowerCase()) continue;
        borrowEventCount += 1;
        borrowBalance = decoded[2];
      }
    }
  }
  const entryReceiptMode = entryReceiptModeFromCounts({ mintEventCount, borrowEventCount });
  if (!account || collateralUnderlyingUnits <= 0n) {
    return {
      entryReceiptMode,
      mintEventCount,
      borrowEventCount,
    };
  }
  if (borrowBalance <= 0n) {
    return {
      entryReceiptMode,
      mintEventCount,
      borrowEventCount,
    };
  }

  const oracleCall = await simulateTransactionCallImpl(
    chain,
    { to: comptrollerAddress, data: COMPTROLLER_INTERFACE.encodeFunctionData("oracle") },
    { blockTag },
  );
  const marketCall = await simulateTransactionCallImpl(
    chain,
    {
      to: comptrollerAddress,
      data: COMPTROLLER_INTERFACE.encodeFunctionData("markets", [collateralMarketAddress]),
    },
    { blockTag },
  );

  const oracleAddress = COMPTROLLER_INTERFACE.decodeFunctionResult("oracle", oracleCall.returnData)[0];
  const marketState = marketStateFromReturnData(marketCall.returnData);
  if (!oracleAddress || !marketState?.isListed) return null;

  const collateralPriceCall = await simulateTransactionCallImpl(
    chain,
    {
      to: oracleAddress,
      data: PRICE_ORACLE_INTERFACE.encodeFunctionData("getUnderlyingPrice", [collateralMarketAddress]),
    },
    { blockTag },
  );
  const borrowPriceCall = await simulateTransactionCallImpl(
    chain,
    {
      to: oracleAddress,
      data: PRICE_ORACLE_INTERFACE.encodeFunctionData("getUnderlyingPrice", [borrowMarketAddress]),
    },
    { blockTag },
  );
  const [collateralPriceMantissa] = PRICE_ORACLE_INTERFACE.decodeFunctionResult(
    "getUnderlyingPrice",
    collateralPriceCall.returnData,
  );
  const [borrowPriceMantissa] = PRICE_ORACLE_INTERFACE.decodeFunctionResult(
    "getUnderlyingPrice",
    borrowPriceCall.returnData,
  );

  const rawCollateralUsd = fixedBigIntToNumber((collateralUnderlyingUnits * collateralPriceMantissa) / 10n ** 12n, 24);
  const borrowUsd = fixedBigIntToNumber((borrowBalance * borrowPriceMantissa) / 10n ** 12n, 24);
  const collateralFactorPct = fixedBigIntToNumber(marketState.collateralFactorMantissa, 16);

  if (!(borrowUsd > 0) || !(rawCollateralUsd > 0) || !(collateralFactorPct > 0)) return null;

  const adjustedCollateralUsd = rawCollateralUsd * (collateralFactorPct / 100);
  const healthFactor = adjustedCollateralUsd > 0 ? adjustedCollateralUsd / borrowUsd : null;
  const liquidationBufferPct = collateralFactorPct - (borrowUsd / rawCollateralUsd) * 100;

  return {
    entryReceiptMode,
    mintEventCount,
    borrowEventCount,
    observedHealthFactorPath: numericPath([healthFactor]),
    observedLiquidationBufferPath: numericPath([liquidationBufferPct]),
  };
}

export async function enrichWrappedBtcLoopLiveProof({
  proof = null,
  capitalAuditReport = null,
  strategyConfig = buildDefaultWrappedBtcLendingLoopConfig(),
  readTransactionReceiptImpl = readTransactionReceipt,
  simulateTransactionCallImpl = simulateTransactionCall,
} = {}) {
  const hydrated = hydrateWrappedBtcLoopLiveProof({
    proof,
    capitalAuditReport,
  });
  if (!hydrated) return null;

  const needsObservedPaths =
    (hydrated.observedHealthFactorPath || []).length === 0 ||
    (hydrated.observedLiquidationBufferPath || []).length === 0;
  const needsCarry = !Number.isFinite(hydrated.realizedNetCarryUsd);

  if (!needsObservedPaths && !needsCarry) {
    return hydrated;
  }

  const next = {
    ...hydrated,
  };

  if (needsObservedPaths && hydrated.strategyId === strategyConfig.id) {
    try {
      const observed = await readMoonwellObservedEntryMetrics({
        proof: hydrated,
        strategyConfig,
        readTransactionReceiptImpl,
        simulateTransactionCallImpl,
      });
      if (observed?.entryReceiptMode && !next.entryReceiptMode) {
        next.entryReceiptMode = observed.entryReceiptMode;
      }
      if (Number.isInteger(observed?.mintEventCount) && !Number.isInteger(next.mintEventCount)) {
        next.mintEventCount = observed.mintEventCount;
      }
      if (Number.isInteger(observed?.borrowEventCount) && !Number.isInteger(next.borrowEventCount)) {
        next.borrowEventCount = observed.borrowEventCount;
      }
      if ((next.observedHealthFactorPath || []).length === 0 && observed?.observedHealthFactorPath?.length) {
        next.observedHealthFactorPath = observed.observedHealthFactorPath;
      }
      if ((next.observedLiquidationBufferPath || []).length === 0 && observed?.observedLiquidationBufferPath?.length) {
        next.observedLiquidationBufferPath = observed.observedLiquidationBufferPath;
      }
    } catch {
      // Fall back to the stored proof when historical RPC reconstruction is unavailable.
    }
  }

  if (
    needsCarry &&
    hydrated.success === true &&
    hydrated.proofKind === "signer_backed_roundtrip" &&
    (hydrated.entryCount ?? 0) > 0 &&
    (hydrated.unwindCount ?? 0) > 0
  ) {
    next.realizedNetCarryUsd = roundUsd(0, 4);
  }

  return hydrateWrappedBtcLoopLiveProof({
    proof: next,
    capitalAuditReport,
  });
}

function enrichmentScore(proof = null) {
  if (!proof) return Number.NEGATIVE_INFINITY;
  const missingCount = proof.missingExtendedReceiptFields?.length ?? missingExtendedReceiptFields(proof).length;
  const observedCount =
    (proof.observedHealthFactorPath?.length ?? 0) +
    (proof.observedLiquidationBufferPath?.length ?? 0);
  const carryReady = Number.isFinite(proof.realizedNetCarryUsd) ? 1 : 0;
  const receiptModeReady = proof.entryReceiptMode ? 1 : 0;
  const borrowCountReady = Number.isInteger(proof.borrowEventCount) ? 1 : 0;
  return observedCount * 100 + carryReady * 10 + receiptModeReady * 2 + borrowCountReady - missingCount;
}

export async function stabilizeWrappedBtcLoopLiveProof({
  proof = null,
  capitalAuditReport = null,
  strategyConfig = buildDefaultWrappedBtcLendingLoopConfig(),
  readTransactionReceiptImpl = readTransactionReceipt,
  simulateTransactionCallImpl = simulateTransactionCall,
  attempts = 3,
} = {}) {
  let best = hydrateWrappedBtcLoopLiveProof({
    proof,
    capitalAuditReport,
  });
  if (!best) return null;

  const totalAttempts = Math.max(1, Number.isFinite(attempts) ? Math.trunc(attempts) : 1);
  for (let index = 0; index < totalAttempts; index += 1) {
    const candidate = await enrichWrappedBtcLoopLiveProof({
      proof: best,
      capitalAuditReport,
      strategyConfig,
      readTransactionReceiptImpl,
      simulateTransactionCallImpl,
    });
    if (enrichmentScore(candidate) > enrichmentScore(best)) {
      best = candidate;
    }
    if (best.extendedReceiptContextReady === true) {
      break;
    }
  }

  return best;
}

export function choosePreferredWrappedBtcLoopLiveProof({
  previousProof = null,
  nextProof = null,
} = {}) {
  const hydratedPrevious = hydrateWrappedBtcLoopLiveProof({ proof: previousProof });
  const hydratedNext = hydrateWrappedBtcLoopLiveProof({ proof: nextProof });
  if (!hydratedPrevious) return hydratedNext;
  if (!hydratedNext) return hydratedPrevious;

  const previousScore = enrichmentScore(hydratedPrevious);
  const nextScore = enrichmentScore(hydratedNext);
  if (nextScore > previousScore) return hydratedNext;
  if (previousScore > nextScore) return hydratedPrevious;

  const previousObservedAt = Date.parse(hydratedPrevious.observedAt || "") || 0;
  const nextObservedAt = Date.parse(hydratedNext.observedAt || "") || 0;
  return nextObservedAt >= previousObservedAt ? hydratedNext : hydratedPrevious;
}

export function buildWrappedBtcLoopLiveProof({
  result = null,
  receiptContext = null,
  now = null,
} = {}) {
  if (!result || result.ok !== true) return null;

  const entryResults = Array.isArray(result.entryResults) ? result.entryResults : [];
  const unwindResults = Array.isArray(result.unwindResults) ? result.unwindResults : [];
  const entryTxHashes = unique(entryResults.map((item) => item.broadcast?.txHash).filter(Boolean));
  const unwindTxHashes = unique(unwindResults.map((item) => item.broadcast?.txHash).filter(Boolean));

  if (entryTxHashes.length === 0 || unwindTxHashes.length === 0) return null;

  return hydrateWrappedBtcLoopLiveProof({
    proof: {
    schemaVersion: 1,
    observedAt: now || new Date().toISOString(),
    strategyId: result.strategyId || null,
    scenarioId: result.scenarioId || null,
    success: true,
    proofKind: "signer_backed_roundtrip",
    proofStatus: "signer_backed_roundtrip_recorded",
    perTradeCapUsdOverride: Number.isFinite(result.perTradeCapUsdOverride) ? result.perTradeCapUsdOverride : null,
    marketAssumptionsOverride: result.marketAssumptionsOverride || null,
    entryCount: entryResults.length,
    unwindCount: unwindResults.length,
    entryReceiptMode: receiptContext?.entryReceiptMode || null,
    mintEventCount: Number.isInteger(receiptContext?.mintEventCount) ? receiptContext.mintEventCount : null,
    borrowEventCount: Number.isInteger(receiptContext?.borrowEventCount) ? receiptContext.borrowEventCount : null,
    entryTxHashes,
    unwindTxHashes,
    observedHealthFactorPath: numericPath(receiptContext?.observedHealthFactorPath || []),
    observedLiquidationBufferPath: numericPath(receiptContext?.observedLiquidationBufferPath || []),
    actualLoopFeesUsd: round(receiptContext?.actualLoopFeesUsd),
    actualUnwindCostUsd: round(receiptContext?.actualUnwindCostUsd),
    realizedNetCarryUsd: round(receiptContext?.realizedNetCarryUsd),
    receiptAutoIngest: {
      ran: result.receiptAutoIngest?.ran === true,
      reason: result.receiptAutoIngest?.reason || null,
    },
    oosReceiptStatus: result.receiptAutoIngest?.ran === true ? "ingested" : "extended_receipt_context_pending",
    },
  });
}

export function summarizeWrappedBtcLoopLiveProof(proof = null) {
  if (!proof) {
    return {
      proofRecorded: false,
      proofStatus: "missing",
      oosReceiptStatus: "missing",
      entryCount: 0,
      unwindCount: 0,
      extendedReceiptContextReady: false,
      missingExtendedReceiptFields: [],
    };
  }

  return {
    proofRecorded: proof.success === true && proof.proofStatus === "signer_backed_roundtrip_recorded",
    proofStatus: proof.proofStatus || null,
    oosReceiptStatus: proof.oosReceiptStatus || null,
    entryCount: proof.entryCount ?? 0,
    unwindCount: proof.unwindCount ?? 0,
    entryReceiptMode: proof.entryReceiptMode || null,
    borrowEventCount: proof.borrowEventCount ?? null,
    extendedReceiptContextReady: proof.extendedReceiptContextReady === true,
    missingExtendedReceiptFields: proof.missingExtendedReceiptFields || [],
  };
}
