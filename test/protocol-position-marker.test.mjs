import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { resolveProtocolPositionAdapter } from "../src/treasury/protocol-position-adapter-registry.mjs";
import { createContractReader, runMarkProtocolPositionMarksCli } from "../src/cli/mark-protocol-positions.mjs";
import {
  buildProtocolPositionMarkSummary,
  createCachedRetryingContractReader,
  markActiveProtocolPositions,
} from "../src/treasury/protocol-position-marker.mjs";

const OBSERVED_AT = "2026-05-03T12:00:00.000Z";
const READ_INTERFACE = new Interface([
  "function balanceOf(address) view returns (uint256)",
]);
const WALLET_ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

test("resolveProtocolPositionAdapter maps current Merkl ERC4626 bindings to erc4626 adapter", () => {
  const adapter = resolveProtocolPositionAdapter({
    chain: "base",
    protocolId: "yo",
    bindingKind: "erc4626_vault_supply_withdraw",
    shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
  });

  assert.equal(adapter.id, "erc4626");
});

test("resolveProtocolPositionAdapter maps current lending bindings", () => {
  assert.equal(
    resolveProtocolPositionAdapter({ bindingKind: "euler_evault_deposit_withdraw" }).id,
    "erc4626",
  );
  assert.equal(resolveProtocolPositionAdapter({ bindingKind: "aave_v3_supply_withdraw" }).id, "aave-v3");
  assert.equal(
    resolveProtocolPositionAdapter({ bindingKind: "compound_v2_supply_withdraw" }).id,
    "compound-v2",
  );
  assert.equal(resolveProtocolPositionAdapter({ bindingKind: "aave_v3_pool_supply_withdraw" }).id, "aave-v3");
  assert.equal(resolveProtocolPositionAdapter({ bindingKind: "unknown" }), null);
});

test("markActiveProtocolPositions marks active positions and returns appendable events", async () => {
  const marks = await markActiveProtocolPositions({
    positions: [
      {
        event: "position_opened",
        status: "open",
        positionId: "p-erc4626",
        opportunityId: "op",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        shareTokenAddress: "0xVault",
        assetAddress: "0xAsset",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 5_000_000n;
      if (functionName === "convertToAssets") return 5_100_000n;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      if (functionName === "asset") return "0xAsset";
      throw new Error(functionName);
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(marks.length, 1);
  assert.equal(marks[0].event, "position_marked");
  assert.equal(marks[0].positionId, "p-erc4626");
  assert.equal(marks[0].adapterId, "erc4626");
  assert.equal(marks[0].valueUsd, 5.1);
});

test("markActiveProtocolPositions returns failed event for unknown adapters", async () => {
  const marks = await markActiveProtocolPositions({
    positions: [
      {
        status: "open",
        positionId: "p-unknown",
        chain: "base",
        protocolId: "mystery",
        bindingKind: "unsupported_binding",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    contractReader: async () => 0n,
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(marks.length, 1);
  assert.equal(marks[0].event, "position_mark_failed");
  assert.equal(marks[0].failureKind, "adapter_missing");
  assert.equal(marks[0].confidence, "adapter_missing");
});

test("markActiveProtocolPositions isolates adapter errors and sorts by positionId", async () => {
  const marks = await markActiveProtocolPositions({
    positions: [
      {
        status: "open",
        positionId: "z-ok",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        shareTokenAddress: "0xVault",
        assetAddress: "0xAsset",
      },
      {
        status: "open",
        positionId: "a-fail",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        shareTokenAddress: "0xBrokenVault",
        assetAddress: "0xAsset",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ address, functionName }) => {
      if (address === "0xBrokenVault") throw new Error("rpc exploded");
      if (functionName === "balanceOf") return 5_000_000n;
      if (functionName === "convertToAssets") return 5_100_000n;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      if (functionName === "asset") return "0xAsset";
      throw new Error(functionName);
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.deepEqual(marks.map((mark) => mark.positionId), ["a-fail", "z-ok"]);
  assert.equal(marks[0].event, "position_mark_failed");
  assert.equal(marks[0].failureKind, "adapter_error");
  assert.match(marks[0].message, /rpc exploded/u);
  assert.equal(marks[1].event, "position_marked");
});

test("buildProtocolPositionMarkSummary totals marked and failed events", () => {
  const summary = buildProtocolPositionMarkSummary({
    observedAt: OBSERVED_AT,
    events: [
      { event: "position_mark_failed", valueUsd: null },
      { event: "position_marked", valueUsd: 2.25 },
      { event: "position_marked", valueUsd: 3.75 },
    ],
  });

  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.observedAt, OBSERVED_AT);
  assert.equal(summary.markedCount, 2);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.totalValueUsd, 6);
});

test("createCachedRetryingContractReader retries transient read failures and caches successes", async () => {
  let calls = 0;
  const reader = createCachedRetryingContractReader(async () => {
    calls += 1;
    if (calls === 1) throw new Error("transient rpc read failed");
    return 42n;
  });

  assert.equal(await reader({ chain: "base", address: "0xVault", functionName: "balanceOf", args: [WALLET_ADDRESS] }), 42n);
  assert.equal(await reader({ chain: "base", address: "0xVault", functionName: "balanceOf", args: [WALLET_ADDRESS] }), 42n);
  assert.equal(calls, 2);
});

test("createContractReader falls back to later configured rpcUrls when the first rpc call reverts", async () => {
  const rpcCalls = [];
  const contractReader = createContractReader({
    chainConfigResolver: () => ({
      chainId: 8453,
      rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
    }),
    providerFactory: (rpcUrl) => ({
      call: async () => {
        rpcCalls.push(rpcUrl);
        if (rpcUrl === "https://rpc-one.example") {
          throw new Error("missing revert data");
        }
        return READ_INTERFACE.encodeFunctionResult("balanceOf", [42n]);
      },
    }),
  });

  const value = await contractReader({
    chain: "base",
    address: "0xVault",
    functionName: "balanceOf",
    args: [WALLET_ADDRESS],
  });

  assert.equal(value, 42n);
  assert.deepEqual(rpcCalls, ["https://rpc-one.example", "https://rpc-two.example"]);
});

test("runMarkProtocolPositionMarksCli refuses to write active positions without walletAddress", async () => {
  const writes = [];

  await assert.rejects(
    () => runMarkProtocolPositionMarksCli({
      args: { write: true, json: true },
      observedAt: OBSERVED_AT,
      positionEvents: [
        {
          event: "position_opened",
          status: "open",
          observedAt: OBSERVED_AT,
          positionId: "p-active",
          chain: "base",
          protocolId: "yo",
          bindingKind: "erc4626_vault_supply_withdraw",
          shareTokenAddress: "0xVault",
          assetAddress: "0xAsset",
        },
      ],
      walletAddress: null,
      contractReader: async () => {
        throw new Error("contractReader should not run before wallet guard");
      },
      priceReader: async () => 1,
      store: {
        append: async (name, event) => {
          writes.push({ name, event });
        },
      },
    }),
    /Cannot write protocol position marks without walletAddress/u,
  );

  assert.deepEqual(writes, []);
});

test("runMarkProtocolPositionMarksCli preview allows missing walletAddress diagnostics", async () => {
  const summary = await runMarkProtocolPositionMarksCli({
    args: { write: false, json: true },
    observedAt: OBSERVED_AT,
    positionEvents: [
      {
        event: "position_opened",
        status: "open",
        observedAt: OBSERVED_AT,
        positionId: "p-active",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        shareTokenAddress: "0xVault",
        assetAddress: "0xAsset",
      },
    ],
    walletAddress: null,
    contractReader: async () => {
      throw new Error("contractReader should not run before wallet guard");
    },
    priceReader: async () => 1,
  });

  assert.equal(summary.markedCount, 0);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.events[0].failureKind, "missing_params");
});

test("runMarkProtocolPositionMarksCli writes reader-backed logical marks with USD hydration", async () => {
  const summary = await runMarkProtocolPositionMarksCli({
    args: { write: false, json: true },
    observedAt: OBSERVED_AT,
    positionEvents: [
      {
        event: "position_opened",
        status: "open",
        observedAt: OBSERVED_AT,
        positionId: "merkl:base:yo-opportunity:0xentry",
        opportunityId: "yo-opportunity",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        vaultAddress: "0xVault",
        shareTokenAddress: "0xVault",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    readerProviderFactory: ({ address }) => {
      if (address === "0xVault") {
        return {
          balanceOf: async () => 5_000_000n,
          convertToAssets: async () => 5_100_000n,
          asset: async () => "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          decimals: async () => 6,
          symbol: async () => "YO-USDC",
        };
      }
      return {
        decimals: async () => 6,
      };
    },
    fetchPrices: async () => {
      throw new Error("stable reader-backed marks should not fetch remote prices");
    },
  });

  assert.equal(summary.markedCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.equal(
    summary.events[0].positionId,
    "protocol:base:yo:yo-opportunity:erc4626_vault_supply_withdraw:0xvault",
  );
  assert.equal(summary.events[0].markSource, "protocol_reader");
  assert.equal(summary.events[0].valueUsd, 5.1);
});

test("runMarkProtocolPositionMarksCli supports aave_v3 pool bindings through the reader path", async () => {
  const summary = await runMarkProtocolPositionMarksCli({
    args: { write: false, json: true },
    observedAt: OBSERVED_AT,
    positionEvents: [
      {
        event: "position_opened",
        status: "open",
        observedAt: OBSERVED_AT,
        positionId: "merkl:ethereum:aave-opportunity:0xentry",
        opportunityId: "aave-opportunity",
        chain: "ethereum",
        protocolId: "aave",
        bindingKind: "aave_v3_pool_supply_withdraw",
        poolAddress: "0xPool",
        vaultAddress: "0xAToken",
        shareTokenAddress: "0xAToken",
        assetAddress: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
        marketName: "proto_mainnet_v3",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    readerProviderFactory: ({ address }) => {
      if (address === "0xPool") {
        return {
          getUserAccountData: async () => ({ healthFactor: 2_000000000000000000n, ltv: 7500n, currentLiquidationThreshold: 8000n }),
        };
      }
      if (address === "0xAToken") {
        return {
          balanceOf: async () => 25_000000000000000000n,
          decimals: async () => 18,
          symbol: async () => "aEthRLUSD",
        };
      }
      throw new Error(`unexpected address ${address}`);
    },
    fetchPrices: async () => {
      throw new Error("known aave asset marks should not fetch remote prices");
    },
  });

  assert.equal(summary.markedCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.events[0].bindingKind, "aave_v3_pool_supply_withdraw");
  assert.equal(summary.events[0].protocolId, "aave");
  assert.equal(summary.events[0].valueUsd, 25);
});

test("runMarkProtocolPositionMarksCli falls back to the legacy adapter after retryable reader rpc failures", async () => {
  const summary = await runMarkProtocolPositionMarksCli({
    args: { write: false, json: true },
    observedAt: OBSERVED_AT,
    positionEvents: [
      {
        event: "position_opened",
        status: "open",
        observedAt: OBSERVED_AT,
        positionId: "merkl:base:yo-opportunity:0xentry",
        opportunityId: "yo-opportunity",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        vaultAddress: "0xVault",
        shareTokenAddress: "0xVault",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        assetDecimals: 6,
        assetSymbol: "USDC",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    readerProviderFactory: () => ({
      balanceOf: async () => {
        throw new Error("reader rpc exploded");
      },
    }),
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 5_000_000n;
      if (functionName === "convertToAssets") return 5_100_000n;
      if (functionName === "asset") return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      throw new Error(functionName);
    },
    fetchPrices: async () => {
      throw new Error("legacy stable fallback should not fetch remote prices");
    },
  });

  assert.equal(summary.markedCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.events[0].markSource, "onchain_erc4626_convert_to_assets");
  assert.equal(summary.events[0].valueUsd, 5.1);
});

test("runMarkProtocolPositionMarksCli uses persisted price snapshot for legacy adapter marks", async () => {
  let fetched = 0;
  const summary = await runMarkProtocolPositionMarksCli({
    args: { write: false, json: true },
    dataDir: "/tmp/bob-claw-protocol-mark-prices",
    observedAt: OBSERVED_AT,
    positionEvents: [
      {
        event: "position_opened",
        status: "open",
        observedAt: OBSERVED_AT,
        positionId: "p-weth-vault",
        chain: "base",
        protocolId: "compound",
        bindingKind: "compound_v2_supply_withdraw",
        cTokenAddress: "0xVault",
        assetAddress: "0x4200000000000000000000000000000000000006",
        assetDecimals: 18,
        assetSymbol: "WETH",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 2_000_000_000_000_000_000n;
      if (functionName === "exchangeRateStored") return 1_000_000_000_000_000_000n;
      throw new Error(functionName);
    },
    readFileImpl: async () => JSON.stringify({
      schemaVersion: 1,
      observedAt: OBSERVED_AT,
      btcUsd: 103000,
      tokenByKey: {
        btc: 103000,
        wbtc: 103000,
        ethereum: 2500,
        usd_stable: 1,
      },
      nativeByChain: {
        base: 2500,
      },
    }),
    fetchPrices: async () => {
      fetched += 1;
      return {};
    },
  });

  assert.equal(fetched, 0);
  assert.equal(summary.markedCount, 1);
  assert.equal(summary.events[0].valueUsd, 5000);
});

test("runMarkProtocolPositionMarksCli skips remote price fetch for stable legacy positions", async () => {
  let fetched = 0;
  const summary = await runMarkProtocolPositionMarksCli({
    args: { write: false, json: true },
    dataDir: "/tmp/bob-claw-protocol-mark-stables",
    observedAt: OBSERVED_AT,
    positionEvents: [
      {
        event: "position_opened",
        status: "open",
        observedAt: OBSERVED_AT,
        positionId: "p-usdc-vault",
        chain: "base",
        protocolId: "compound",
        bindingKind: "compound_v2_supply_withdraw",
        cTokenAddress: "0xVault",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        assetDecimals: 6,
        assetSymbol: "USDC",
      },
    ],
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 5_100_000n;
      if (functionName === "exchangeRateStored") return 1_000_000_000_000_000_000n;
      throw new Error(functionName);
    },
    readFileImpl: async () => {
      throw new Error("price snapshot should not be read for stable-only marks");
    },
    fetchPrices: async () => {
      fetched += 1;
      return {};
    },
  });

  assert.equal(fetched, 0);
  assert.equal(summary.markedCount, 1);
  assert.equal(summary.events[0].valueUsd, 5.1);
});
