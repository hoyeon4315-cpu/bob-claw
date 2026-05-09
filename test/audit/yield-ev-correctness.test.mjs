import assert from "node:assert/strict";
import { test } from "node:test";
import { evGate } from "../../src/executor/policy/ev-gate.mjs";
import { solveMinViableNotional } from "../../src/strategy/economics/min-viable-notional.mjs";
import { buildStrategyEdgeSnapshots } from "../../src/strategy/economics/strategy-edge-snapshot.mjs";

test("receipt-backed yield edge adds known cost back before min-notional subtracts cost once", () => {
  const [snapshot] = buildStrategyEdgeSnapshots({
    strategies: [
      {
        strategyId: "yield-receipt",
        autoExecute: true,
        caps: { perTxUsd: 1000, perDayUsd: 1000, perChainUsd: { base: 1000 }, maxDailyLossUsd: 25 },
      },
    ],
    receiptRecords: [
      {
        strategyId: "yield-receipt",
        chain: "base",
        intentType: "fund_strategy",
        observedAt: "2026-05-09T00:00:00.000Z",
        notionalUsd: 1000,
        holdingPeriodDays: 30,
        realized: {
          actualKnownCostUsd: 5,
          realizedNetPnlUsd: 3,
        },
      },
    ],
    now: "2026-05-09T01:00:00.000Z",
    policy: { minProfitFloorUsd: 0, minSamples: 1 },
  });

  assert.equal(Number(snapshot.measuredEdgeBpsPerDay.toFixed(6)), 2.666667);
  assert.equal(snapshot.measuredRoundTripCostUsd, 5);

  const solved = solveMinViableNotional({
    edgeBpsPerDay: snapshot.measuredEdgeBpsPerDay,
    roundTripCostUsd: snapshot.measuredRoundTripCostUsd,
    slippageVarianceUsd: snapshot.slippageVarianceUsd,
    varianceFloorUsd: snapshot.varianceFloorUsd,
    holdingPeriodDays: 30,
    caps: { perTxUsd: 1000, perChainUsd: 1000 },
  });
  assert.equal(solved.infeasible, false);
});

test("EV gate refuses transport netEdgeUsd as a yield expected-net alias", () => {
  const verdict = evGate(
    {
      strategyId: "yield-position",
      chain: "base",
      intentType: "fund_strategy",
      amountUsd: 1000,
      netEdgeUsd: 10,
    },
    [],
    { now: "2026-05-09T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_unmeasured"]);
});
