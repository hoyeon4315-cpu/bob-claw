import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configuredAddressScanProviders,
  parseZerionWalletPortfolioResponse,
  readZerionWalletPortfolio,
  resolveAddressScanPortfolioReader,
  zerionBasicAuthHeader,
} from "../src/treasury/address-scan-api.mjs";

test("zerion wallet portfolio parser extracts wallet usd without mixing deployed positions", () => {
  const parsed = parseZerionWalletPortfolioResponse({
    data: {
      type: "portfolio",
      id: "0xabc",
      attributes: {
        positions_distribution_by_type: {
          wallet: 1864.774102420957,
          deposited: 78.04192492782934,
          borrowed: 0.9751475798305564,
          locked: 5.780032725068765,
          staked: 66.13183205505294,
        },
        positions_distribution_by_chain: {
          ethereum: 1214.009900354964,
          base: 55.01550749900544,
          optimism: 573.032664994399,
        },
        total: {
          positions: 2017.4858230069574,
        },
        changes: {
          absolute_1d: 102.0271468171374,
          percent_1d: 5.326512552079021,
        },
      },
    },
  }, {
    observedAt: "2026-04-26T07:00:00.000Z",
  });

  assert.equal(parsed.provider, "zerion");
  assert.equal(parsed.walletUsd, 1864.774102420957);
  assert.equal(parsed.totalPortfolioUsd, 2017.4858230069574);
  assert.equal(parsed.chainTotals.length, 3);
  assert.equal(parsed.change1dPct, 5.326512552079021);
  assert.equal(parsed.observedAt, "2026-04-26T07:00:00.000Z");
});

test("configured address scan providers ignore disabled placeholders", () => {
  assert.deepEqual(
    configuredAddressScanProviders({
      providers: ["zerion", "disabled", "", "none", "ZERION"],
    }),
    ["zerion", "zerion"],
  );
});

test("zerion wallet portfolio reader uses basic auth with api key colon form", async () => {
  let seenHeaders = null;
  await readZerionWalletPortfolio({
    address: "0xabc",
    apiKey: "test-key",
    apiBase: "https://api.zerion.test/v1",
    fetchImpl: async (_url, options = {}) => {
      seenHeaders = options.headers;
      return {
        ok: true,
        async json() {
          return {
            data: {
              attributes: {
                positions_distribution_by_type: { wallet: 1 },
                total: { positions: 1 },
              },
            },
          };
        },
      };
    },
  });
  assert.equal(seenHeaders.authorization, zerionBasicAuthHeader("test-key"));
});

test("address scan reader resolves first configured working provider", async () => {
  const calls = [];
  const reader = resolveAddressScanPortfolioReader(
    {
      providers: ["zerion"],
      zerionApiKey: "test-key",
      zerionApiBase: "https://api.zerion.test/v1",
    },
    {
      zerionReader: async ({ address, apiKey, apiBase }) => {
        calls.push({ address, apiKey, apiBase });
        return { provider: "zerion", walletUsd: 12.34 };
      },
    },
  );

  const result = await reader({ address: "0xabc", fetchImpl: async () => null });
  assert.equal(result.provider, "zerion");
  assert.equal(result.walletUsd, 12.34);
  assert.deepEqual(calls, [
    {
      address: "0xabc",
      apiKey: "test-key",
      apiBase: "https://api.zerion.test/v1",
    },
  ]);
});

test("address scan reader returns null when no configured provider has credentials", () => {
  const reader = resolveAddressScanPortfolioReader({
    providers: ["zerion", "tatum"],
    zerionApiKey: "",
    tatumApiKey: "",
  });
  assert.equal(reader, null);
});
