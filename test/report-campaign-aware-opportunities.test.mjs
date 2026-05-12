import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  fetchMerklOpportunities,
  fetchDefiLlamaPools,
  getDefiLlamaPool,
  buildCampaignAwareCandidates,
  classifyRewardToken,
  campaignReportChainIds,
  handleCampaignAwareReportOutput,
  parseArgs,
} from "../src/cli/report-campaign-aware-opportunities.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../src/config/small-capital-campaign-mode.mjs";

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
    assert.deepStrictEqual(result, [{ ...data[0], sourceChainId: 8453 }]);
  });

  test("throws on non-ok response", async () => {
    try {
      await fetchMerklOpportunities({ fetchFn: mockFetch({}, 500) });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("Merkl fetch failed"));
    }
  });

  test("can fetch committed evidence-scope chain ids instead of only Base", async () => {
    const calls = [];
    const result = await fetchMerklOpportunities({
      chainIds: [8453, 10],
      fetchFn: async (url) => {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: url.includes("chainId=10") ? "optimism" : "base" }],
        };
      },
    });

    assert.equal(calls.length, 2);
    assert.ok(calls.some((url) => url.includes("chainId=8453")));
    assert.ok(calls.some((url) => url.includes("chainId=10")));
    assert.deepEqual(result.map((item) => item.sourceChainId).sort((a, b) => a - b), [10, 8453]);
  });
});

describe("campaignReportChainIds", () => {
  test("covers official Gateway EVM destinations from chain profiles", () => {
    const ids = campaignReportChainIds();
    assert.ok(ids.includes(8453));
    assert.ok(ids.includes(10));
    assert.ok(ids.includes(60808));
    assert.equal(ids.includes(42161), false);
    assert.equal(ids.includes(137), false);
  });
});

describe("campaign report CLI output", () => {
  test("parseArgs keeps --json as stdout JSON and --write as file output", () => {
    assert.deepEqual(parseArgs(["--json"]), { json: true, write: false });
    assert.deepEqual(parseArgs(["--write"]), { json: false, write: true });
    assert.deepEqual(parseArgs(["--json", "--write"]), { json: true, write: true });
  });

  test("handleCampaignAwareReportOutput writes only when --write is set", async () => {
    const writes = [];
    const logs = [];
    const output = { candidateCount: 2, candidates: [{ id: "a" }, { id: "b" }] };

    const jsonResult = await handleCampaignAwareReportOutput({
      output,
      args: parseArgs(["--json"]),
      cwd: "/tmp/bob-claw-campaign-test",
      writeFileFn: async (...args) => writes.push(args),
      logFn: (line) => logs.push(line),
    });

    assert.equal(jsonResult.wrote, false);
    assert.equal(writes.length, 0);
    assert.deepEqual(JSON.parse(logs.at(-1)).candidates.map((item) => item.id), ["a", "b"]);

    const writeResult = await handleCampaignAwareReportOutput({
      output,
      args: parseArgs(["--write"]),
      cwd: "/tmp/bob-claw-campaign-test",
      writeFileFn: async (...args) => writes.push(args),
      logFn: (line) => logs.push(line),
    });

    assert.equal(writeResult.wrote, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], "/tmp/bob-claw-campaign-test/data/campaign-aware-opportunities.json");
    assert.equal(JSON.parse(writes[0][1]).candidateCount, 2);
    assert.match(logs.at(-1), /Wrote 2 candidates/);
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

describe("getDefiLlamaPool protocol aliases", () => {
  test("matches Merkl lending protocol aliases to DefiLlama projects on chain and token overlap", () => {
    const pools = [
      { chain: "Base", project: "morpho-blue", symbol: "cbBTC-USDC", pool: "morpho-base-cbbtc-usdc" },
      { chain: "Ethereum", project: "aave-v3", symbol: "USDC", pool: "aave-eth-usdc" },
      { chain: "Base", project: "compound-v3", symbol: "USDC", pool: "compound-base-usdc" },
      { chain: "Avalanche", project: "euler", symbol: "USDC", pool: "euler-avax-usdc" },
      { chain: "Base", project: "moonwell", symbol: "cbBTC", pool: "moonwell-base-cbbtc" },
      { chain: "BNB", project: "pendle", symbol: "USDC", pool: "pendle-bsc-usdc" },
    ];

    assert.equal(
      getDefiLlamaPool({ chain: "Base", protocol: { id: "morpho" }, tokens: ["cbBTC", "USDC"] }, pools)?.pool,
      "morpho-base-cbbtc-usdc",
    );
    assert.equal(
      getDefiLlamaPool({ chain: "Ethereum", protocol: { id: "aave" }, tokens: [{ symbol: "USDC" }] }, pools)?.pool,
      "aave-eth-usdc",
    );
    assert.equal(
      getDefiLlamaPool({ chain: "Base", protocol: { id: "compound" }, tokens: [{ displaySymbol: "USDC" }] }, pools)?.pool,
      "compound-base-usdc",
    );
    assert.equal(
      getDefiLlamaPool({ chain: "Avalanche", protocol: { id: "euler-v2" }, tokens: [{ symbol: "USDC" }] }, pools)?.pool,
      "euler-avax-usdc",
    );
    assert.equal(
      getDefiLlamaPool({ chain: "Base", protocol: { id: "moonwell" }, tokens: [{ symbol: "cbBTC" }] }, pools)?.pool,
      "moonwell-base-cbbtc",
    );
    assert.equal(
      getDefiLlamaPool({ chain: "BNB Chain", protocol: { id: "pendle" }, tokens: [{ symbol: "USDC" }] }, pools)?.pool,
      "pendle-bsc-usdc",
    );
  });

  test("rejects missing protocol and prefers the strongest TVL candidate", () => {
    assert.equal(
      getDefiLlamaPool({
        chain: { name: "Base" },
        protocol: { id: "" },
        tokens: [{ symbol: "USDC" }],
      }, [
        { chain: "Base", project: "aave-v3", symbol: "USDC", tvlUsd: 5_000_000 },
      ]),
      undefined,
    );

    const selected = getDefiLlamaPool({
      chain: { name: "Base" },
      protocol: { id: "aave" },
      tokens: [{ symbol: "USDC" }],
    }, [
      { chain: "Base", project: "aave-v3", symbol: "USDC", tvlUsd: 1_000 },
      { chain: "Base", project: "aave-v3", symbol: "USDC", tvlUsd: 10_000_000 },
    ]);

    assert.equal(selected?.tvlUsd, 10_000_000);
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
      merklOpportunities: [baseOpp({ apr: 25 })],
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
    assert.equal(c.rewardExitLiquidityStatus.ready, true);
  });

  test("does not hard block low displayed APR when tiny-canary EV is positive", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          apr: 4,
          campaigns: [
            {
              start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 720 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "USDC", symbol: "USDC" },
            },
          ],
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.notEqual(c.entryStatus, "blocked");
    assert.equal(c.blockers.includes("apr_below_5pct"), false);
    assert.equal(c.tinyCanaryEvStatus.ready, true);
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

  test("auto_allowed micro_test when campaign age < 48h but Base + known protocol", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          apr: 25,
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
    assert.strictEqual(c.entryStatus, "auto_allowed");
    assert.strictEqual(c.isMicroTest, true);
  });

  test("blocks pre-TGE/points reward without explicit exit liquidity proof", () => {
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
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("pre_tge_or_points_reward"));
    assert.ok(c.blockers.includes("reward_exit_liquidity_unproven"));
  });

  test("blocks micro_test when non-stable reward exit liquidity is unproven", () => {
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
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("reward_exit_liquidity_unproven"));
    assert.equal(c.rewardExitLiquidityStatus.ready, false);
  });

  test("blocks campaigns when tiny-canary EV does not clear chain-aware cost", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          chain: { name: "Optimism" },
          protocol: { id: "aerodrome" },
          apr: 1,
          tvl: 150_000,
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.some((blocker) => blocker.startsWith("tiny_canary_unprofitable")));
    assert.ok(c.marketExpectedNetProfitUsd > 0);
    assert.equal(c.tinyCanaryEvStatus.ready, false);
  });

  test("does not apply the old fixed $10 non-primary floor when chain-aware tiny EV clears", () => {
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
    assert.notEqual(c.entryStatus, "blocked");
    assert.equal(c.blockers.includes("non_primary_chain_and_low_net_profit"), false);
    assert.equal(c.tinyCanaryEvStatus.ready, true);
  });

  test("observe when a non-primary campaign clears the operator-notional cost floor", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          chain: { name: "Optimism" },
          protocol: { id: "aerodrome" },
          apr: 15_000,
          tvl: 150_000,
          campaigns: [
            {
              start: Math.floor((nowMs - 100 * 3600 * 1000) / 1000),
              end: Math.floor((nowMs + 720 * 3600 * 1000) / 1000),
              rewardToken: { displaySymbol: "USDC", symbol: "USDC" },
            },
          ],
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "observe");
    assert.strictEqual(c.blockers.length, 0);
    assert.ok(c.operatorExpectedNetProfitUsd > 0);
    assert.equal(c.tinyCanaryEvStatus.ready, true);
  });

  test("auto_allowed when a non-primary chain is committed as evidence-primary", () => {
    const optimismPrimaryPolicy = {
      ...SMALL_CAPITAL_CAMPAIGN_MODE,
      chainSelection: {
        ...SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection,
        chainProfiles: {
          base: { ...SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.chainProfiles.base, role: "candidate" },
          optimism: {
            role: "primary",
            maxSharePct: 0.70,
            evidenceStatus: "live_evidence_primary",
            evidenceSource: "test committed evidence",
            reviewBy: "2026-05-16",
          },
        },
      },
    };
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
      policy: optimismPrimaryPolicy,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "auto_allowed");
    assert.strictEqual(c.blockers.length, 0);
    assert.strictEqual(c.chain, "optimism");
  });

  test("separates display-scale market projection from operator-notional expected PnL", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [baseOpp({ apr: 20, tvl: 150_000 })],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];

    assert.equal(c.operatorPositionUsd, SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.initialMicroUsd);
    assert.equal(c.expectedNetProfitUsd, c.operatorExpectedNetProfitUsd);
    assert.ok(c.marketExpectedNetProfitUsd > c.operatorExpectedNetProfitUsd);
    assert.ok(c.estimatedGasClaimSwapBridgeCostUsd < 0.05);
  });

  test("blocks Arbitrum campaign candidates because it is not an official Gateway destination", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          chain: { name: "Arbitrum" },
          protocol: { id: "aerodrome" },
          apr: 5.1,
          tvl: 50_001,
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.entryStatus, "blocked");
    assert.ok(c.blockers.includes("unsupported_gateway_destination"));
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

  test("cross-references DefiLlama by candidate chain instead of only Base", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        {
          id: "test-dl-optimism",
          chain: { name: "Optimism" },
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
        { chain: "Base", project: "aerodrome", symbol: "USDC-WETH", apy: 4, tvlUsd: 10_000 },
        { chain: "Optimism", project: "aerodrome", symbol: "USDC-WETH", apy: 25, tvlUsd: 300_000 },
      ],
      nowMs,
    });
    const c = candidates[0];
    assert.strictEqual(c.displayedApr, 25);
    assert.strictEqual(c.tvlUsd, 300_000);
    assert.strictEqual(c.chain, "optimism");
  });

  test("normalizes external chain aliases to official internal chain ids", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        baseOpp({
          chain: { name: "BNB Chain" },
          protocol: { id: "aave" },
          apr: 20,
          tvl: 150_000,
        }),
        baseOpp({
          id: "test-bera",
          chain: { name: "Berachain" },
          protocol: { id: "euler" },
          apr: 20,
          tvl: 150_000,
        }),
      ],
      defiLlamaPools: [],
      nowMs,
    });

    assert.deepEqual(candidates.map((candidate) => candidate.chain), ["bsc", "bera"]);
  });

  test("does not require reward exit liquidity proof for native or share-price yield without explicit reward token", () => {
    const candidates = buildCampaignAwareCandidates({
      merklOpportunities: [
        {
          id: "native-yield",
          chain: { name: "Base" },
          protocol: { id: "morpho" },
          apr: 12,
          tvl: 150_000,
          tokens: [{ displaySymbol: "USDC" }],
        },
      ],
      defiLlamaPools: [],
      nowMs,
    });
    const c = candidates[0];
    assert.equal(c.rewardToken, null);
    assert.equal(c.rewardExitLiquidityStatus.ready, true);
    assert.equal(c.blockers.includes("reward_exit_liquidity_unproven"), false);
  });
});
