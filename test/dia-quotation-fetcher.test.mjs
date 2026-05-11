import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diaQuotationToPriceSnapshot,
  fetchDiaQuotationSnapshot,
} from "../src/risk/dia-quotation-fetcher.mjs";

function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("diaQuotationToPriceSnapshot maps DIA quotations into price snapshot fields", () => {
  const snapshot = diaQuotationToPriceSnapshot([
    { Symbol: "BTC", Price: 100, Time: "2026-05-12T00:00:00Z" },
    { Symbol: "cbBTC", Price: 101, Time: "2026-05-12T00:00:01Z" },
    { Symbol: "WETH", Price: 10, Time: "2026-05-12T00:00:02Z" },
    { Symbol: "USDC", Price: 1, Time: "2026-05-12T00:00:03Z" },
  ]);

  assert.equal(snapshot.btc, 100);
  assert.equal(snapshot.tokenByKey.btc, 100);
  assert.equal(snapshot.tokenByKey.wbtc, 100);
  assert.equal(snapshot.tokenByKey.cbbtc, 101);
  assert.equal(snapshot.tokenByKey.ethereum, 10);
  assert.equal(snapshot.tokenByKey.usd_stable, 1);
});

test("fetchDiaQuotationSnapshot omits failed symbols and audits outcomes", async () => {
  const auditRows = [];
  const snapshot = await fetchDiaQuotationSnapshot({
    symbols: ["BTC", "LBTC"],
    fetchFn: async (url) => {
      if (String(url).endsWith("/BTC")) {
        return mockResponse({ Symbol: "BTC", Price: 100, Time: "2026-05-12T00:00:00Z" });
      }
      return mockResponse({}, 404);
    },
    auditFn: async (row) => auditRows.push(row),
  });

  assert.equal(snapshot.btc, 100);
  assert.equal(snapshot.tokenByKey.btc, 100);
  assert.equal(snapshot.source, "dia");
  assert.equal(auditRows.length, 2);
  assert.deepEqual(auditRows.map((row) => row.status), [200, 404]);
  assert.equal(auditRows[0].paramsMasked.symbol, "BTC");
});
