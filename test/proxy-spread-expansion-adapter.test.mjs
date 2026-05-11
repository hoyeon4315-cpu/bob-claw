import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultProxySpreadConfig,
  buildProxySpreadMarketFromSources,
  evaluateProxySpreadAdapter,
} from "../src/strategy/proxy-spread-expansion-adapter.mjs";

test("proxy spread market builder clears APR blockers from DefiLlama supply and on-chain borrow rates", () => {
  const market = buildProxySpreadMarketFromSources({
    defiLlamaPool: { apyBase: 5.25, tvlUsd: 2_000_000 },
    borrowRate: { variableBorrowAprBps: 175 },
    market: {
      entrySlippageBps: 5,
      exitSlippageBps: 7,
      pegDriftBps: 2,
    },
  });

  const report = evaluateProxySpreadAdapter({
    config: {
      ...buildDefaultProxySpreadConfig(),
      perTradeCapUsd: 100,
      perDayCapUsd: 100,
    },
    market,
    receipts: [{ signerBacked: true, result: "passed", realizedNetUsd: 1 }],
  });

  assert.equal(report.blockers.includes("supply_apr_missing"), false);
  assert.equal(report.blockers.includes("borrow_apr_missing"), false);
  assert.equal(report.market.supplyAprBps, 525);
  assert.equal(report.market.borrowAprBps, 175);
  assert.equal(report.economics.spreadBps, 350);
});
