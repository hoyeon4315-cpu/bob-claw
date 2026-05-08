export const CHAIN_HYPOTHESIS_CONFIG = Object.freeze({
  strategyPrimaryHypotheses: Object.freeze([
    Object.freeze({
      chain: "base",
      role: "strategy_primary_reference",
      assertedAt: "2026-04-27T00:00:00.000Z",
      expiresAt: "2026-05-16T00:00:00.000Z",
      evidenceSource: "live receipts, low same-chain cost, inventory, and supported executor paths",
      renewalRequires: "committed evidence-profile diff with receipt-backed chain score",
    }),
  ]),
  paybackReserveProofs: Object.freeze([
    Object.freeze({
      chain: "base",
      status: "proven",
      proofPath: "profit reserve -> BOB L2 -> Bitcoin L1",
      assertedAt: "2026-04-27T00:00:00.000Z",
      committedDiffRequired: true,
    }),
  ]),
  expiresSoonDays: 3,
});
