import { arrayBlocker, compactBlockers, enumBlocker, missingFieldBlockers, validationResult } from "./common.mjs";

const CLOSURE_STATUSES = Object.freeze([
  "closed",
  "open",
  "unknown",
  "broken_at_cex",
  "broken_at_mixer",
  "broken_at_unlabeled_hop",
]);

const REQUIRED_FIELDS = Object.freeze([
  "runId",
  "candidateId",
  "entryReceipts",
  "claimReceipts",
  "exitReceipts",
  "userOpHash",
  "bundlerHash",
  "gasCostSats",
  "bridgeCostSats",
  "swapSlippageSats",
  "rewardTokenHaircutSats",
  "grossPnlSats",
  "netRealizedPnlSats",
  "btcPaybackTxid",
  "btcPaybackBlockHash",
  "btcPaybackConfirmations",
  "pnlClosureStatus",
  "sandwichDetectedPostTrade",
  "priceImpactBps",
  "observedAt",
  "settledAt",
]);

function buildLifecycle(input = {}) {
  const hasClosedPnl = input.pnlClosureStatus === "closed" && input.netRealizedPnlSats !== null && input.netRealizedPnlSats !== undefined;
  const hasEntryAndExit = Array.isArray(input.entryReceipts) && input.entryReceipts.length > 0 &&
    Array.isArray(input.exitReceipts) && input.exitReceipts.length > 0;
  const paybackDelivered = Boolean(input.btcPaybackTxid) && Number(input.btcPaybackConfirmations || 0) > 0;
  return {
    strategyRealized: hasClosedPnl && hasEntryAndExit,
    paybackDelivered,
  };
}

export function validateOpportunityRealizationRecord(input = {}) {
  const blockers = [
    ...missingFieldBlockers(input, REQUIRED_FIELDS),
    arrayBlocker(input, "entryReceipts"),
    arrayBlocker(input, "claimReceipts"),
    arrayBlocker(input, "exitReceipts"),
    enumBlocker(input, "pnlClosureStatus", CLOSURE_STATUSES),
  ];

  return validationResult({
    blockers: compactBlockers(blockers),
    value: {
      ...input,
      lifecycle: buildLifecycle(input),
    },
  });
}
