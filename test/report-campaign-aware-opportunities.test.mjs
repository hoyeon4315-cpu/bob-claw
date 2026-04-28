import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  fetchMerklOpportunities,
  fetchDefiLlamaPools,
  buildCampaignAwareCandidates,
  classifyRewardToken,
} from "../src/cli/report-campaign-aware-opportunities.mjs";

function mockFetch(responseBody, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
  });
}

describe("classifyRewardToken", () => {
  test("stable tokens get 0.0 haircut", () => {
    const r = classifyRewardToken("USDC");
    assert.strictEqual(r.type, "stable");
    assert.strictEqual(r.haircut, 0.0);
  });

  test("liquid bluechip tokens get 0.25 haircut", () => {
    const r = classifyRewardToken("WETH");
    assert.strictEqual(r.type, "liquidBluechip");
    assert.strictEqual(r.haircut, 0.25);
  });

  test("pre-TGE tokens get 0.85 haircut", () => {
    const r = classifyRewardToken("POINTS");
    assert.strictEqual(r.type, "preTgeOrPoints");
    assert.strictEqual(r.haircut, 0.85);
  });

  test("unknown tokens get 0.50 haircut", () => {
    const r = classifyRewardToken("RANDOM");
    assert.strictEqual(r.type, "defaultRewardToken");
    assert.strictEqual(r.haircut, 0.50);
  });
});

describe("fetchMerklOpportunities", () => {
  test("returns parsed JSON on success", async () => {
    const data = [{ id: "1", chain: { name: "Base" } }];
    const result = await fetchMerklOpportunities({ fetchFn: mockFetch(data) });
    assert.deepStrictEqual(result, data);
  });

  test("throws on non-ok response", async () => {
    try {
      await fetchMerklOpportunities({ fetchFn: mockFetch({}, 500) });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("Merkl fetch failed"));
    }
  });
});

describe("fetchDefiLlamaPools", () => {
  test("returns array directly", async () => {
    const data = [{ chain: "Base", project: "aerodrome", apy: 12, tvlUsd: 200_000 }];
    const result = await fetchDefiLlamaPools({ fetchFn: mockFetch(data) });
    assert.deepStrictEqual(result, data);
  });

  test("unwraps .data wrapper if present", async () => {
    const data = { data: [{ chain: "Base", project: "aerodrome", apy: 12, tvlUsd: 200_000 }] };
    const result = await fetchDefiLlamaPools({ fetchFn: mockFetch(data) });
    assert.deepStrictEqual(result, data.data);
  });
});

describe("buildCampaignAwareCandidates status logic", () => {
  const nowMs = Date.now();
  const baseOpp = (overrides = {}) => ({
    id: "test-1",
    chain: { name: "Base" },
    protocol: { id: "aerodrome" },
    apr: 20,
    tvl: 150_000,
    tokens: [{ displaySymbol: "USDC" }],
    campaigns: [
      {
        start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
        end: Math.floor((nowMs + 100 * 3600 * 1000) / 1000),
        rewardToken: { displaySymbol: "USDC", symbol: "USDC" },
      },
    ],
    ...overrides,
  });

  test("auto_allowed for strong Base / known protocol / high APR / high TVL / long remaining", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [baseOpp()],
      defiLlamaPools: [],
      nowMs,
    });
    assert.strictEqual(candidates.length, 1);
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "auto_allowed");
    assert.strictEqual(c.blockers.length, 0);
    assert.strictEqual(c.chain, "base");
    assert.strictEqual(c.protocol, "aerodrome");
    assert.ok(c.expectedRealizedAprAfterHaircut >= 15);
    assert.ok(c.tvlUsd >= 100_000);
    assert.ok(c.hoursRemaining >= 48);
  });

  test("blocked when APR < 5%", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [baseOpp({ apr: 3 })],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("apr_below_5pct"));
  });

  test("blocked when TVL < $50,000", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [baseOpp({ tvl: 10_000 })],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("tvl_below_50k"));
  });

  test("blocked when hoursRemaining < 24", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          campaigns: [
            {
              start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 12 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "USDC", symbol: "USDC" },
            },
          ],
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("hours_remaining_below_24"));
  });

  test("blocked when protocol not in known bindings", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [baseOpp({ protocol: { id: "unknown_protocol" } })],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("protocol_not_bound"));
  });

  test("manual_confirm when campaign age < 48h", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          campaigns: [
            {
              start: Math.floor((nowMs - 10 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 100 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "USDC", symbol: "USDC" },
            },
          ],
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "manual_confirm");
    assert.ok(c.blockers.includes("campaign_age_under_48h"));
  });

  test("manual_confirm when reward token is pre-TGE/points", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          campaigns: [
            {
              start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 100 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "POINTS", symbol: "POINTS" },
            },
          ],
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "manual_confirm");
    assert.ok(c.blockers.includes("pre_tge_or_points_reward"));
  });

  test("manual_confirm when expectedRealizedAprAfterHaircut < 10%", () => {
    // With 0.50 default haircut, APR must be < 20 to get realized < 10
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          apr: 18,
          campaigns: [
            {
              start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 100 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "UNKNOWN", symbol: "UNKNOWN" },
            },
          ],
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "manual_confirm");
    assert.ok(c.blockers.includes("realized_apr_under_10pct"));
  });

  test("observe when no hard blockers but does not meet auto_allowed criteria", () => {
    // Base, known protocol, good APR, good TVL, good remaining, but not on Base? Let's make chain optimism
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          chain: { name: "Optimism" },
          protocol: { id: "aerodrome" },
          apr: 20,
          tvl: 150_000,
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    // Optimism is in baseFirstChains, so no hard blocker. But chain != base, so auto_allowed fails.
    assert.strictEqual(c.entryStatus, "observe");
    assert.strictEqual(c.blockers.length, 0);
  });

  test("cross-references DefiLlama for Base pools when Merkl data is sparse", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        {
          id: "test-dl",
          chain: { name: "Base" },
          protocol: { id: "aerodrome" },
          tokens: [{ displaySymbol: "USDC" }, { displaySymbol: "WETH" }],
          campaigns: [
            {
              start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 100 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "USDC", symbol: "USDC" },
            },
          ],
        },
      ],
      defiLlamaPools: [
        { chain: "Base", project: "aerodrome", symbol: "USDC-WETH", apy: 25, tvlUsd: 300_000 },
      ],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.displayedApr, 25);
    assert.strictEqual(c.tvlUsd, 300_000);
    assert.strictEqual(c.entryStatus, "auto_allowed");
  });
});
