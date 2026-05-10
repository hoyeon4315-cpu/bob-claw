import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import {
  buildAaveProtocolCanaryPlan,
  decodeAaveReserveConfiguration,
  executeAaveProtocolCanaryPlan,
  resolveAavePoolAddress,
  selectAaveQueueItem,
} from "../src/executor/helpers/aave-protocol-canary.mjs";
import { evGate } from "../src/executor/policy/ev-gate.mjs";

const AAVE_PROVIDER_INTERFACE = new Interface([
  "function getPool() view returns (address)",
]);
const AAVE_POOL_INTERFACE = new Interface([
  "function getConfiguration(address asset) view returns (uint256)",
  "function getReserveData(address asset) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))",
]);

function reserveConfiguration({
  decimals = 6,
  active = true,
  frozen = false,
  paused = false,
  supplyCapWholeTokens = 0n,
} = {}) {
  let value = 0n;
  value |= BigInt(decimals) << 48n;
  if (active) value |= 1n << 56n;
  if (frozen) value |= 1n << 57n;
  if (paused) value |= 1n << 60n;
  value |= BigInt(supplyCapWholeTokens) << 116n;
  return value;
}

function reserveDataResult({
  configuration = reserveConfiguration(),
  aTokenAddress = "0x4444444444444444444444444444444444444444",
} = {}) {
  return [
    configuration,
    1n,
    0n,
    1n,
    0n,
    0n,
    0,
    1,
    aTokenAddress,
    "0x0000000000000000000000000000000000000000",
    "0x5555555555555555555555555555555555555555",
    "0x6666666666666666666666666666666666666666",
    0n,
    0n,
    0n,
  ];
}

test("aave protocol canary resolves pool address through the addresses provider", async () => {
  const poolAddress = await resolveAavePoolAddress({
    chain: "ethereum",
    binding: {
      poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    },
    simulateTransactionCallImpl: async () => ({
      returnData: AAVE_PROVIDER_INTERFACE.encodeFunctionResult("getPool", ["0x1111111111111111111111111111111111111111"]),
    }),
  });

  assert.equal(poolAddress, "0x1111111111111111111111111111111111111111");
});

test("aave protocol canary selects binding-ready item and builds approve/supply plan", async () => {
  const queue = {
    queue: [
      {
        queueId: "merkl:eth-aave",
        opportunityId: "eth-aave",
        chain: "ethereum",
        protocolId: "aave",
        name: "Lend rsETH on Aave",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "aave_v3_pool_supply_withdraw",
          resolvedBinding: {
            assetAddress: "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
            aTokenAddress: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
            poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
            marketName: "proto_mainnet_v3",
            assetSymbol: "rsETH",
            assetDecimals: 18,
            aTokenSymbol: "aEthrsETH",
          },
        },
      },
    ],
  };
  const queueItem = selectAaveQueueItem(queue, { opportunityId: "eth-aave" });
  const plan = await buildAaveProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "1000000000000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    simulateTransactionCallImpl: async (_chain, tx) => {
      if (tx.to === "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e") {
        return {
          returnData: AAVE_PROVIDER_INTERFACE.encodeFunctionResult("getPool", ["0x1111111111111111111111111111111111111111"]),
        };
      }
      if (tx.data.startsWith(AAVE_POOL_INTERFACE.getFunction("getReserveData").selector)) {
        return {
          returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getReserveData", [
            reserveDataResult({
              aTokenAddress: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
            }),
          ]),
        };
      }
      return {
        returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getConfiguration", [reserveConfiguration()]),
      };
    },
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(plan.marketName, "proto_mainnet_v3");
  assert.equal(plan.poolAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.amountUsd, 0.001);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "aave_supply");
  assert.equal(plan.minimumRedeemAssetDelta, "950000000000000");
  assert.equal(plan.reserveState.status, "supplyable");
});

test("aave Merkl tiny-live plan preserves parent EV evidence for exact approval policy", async () => {
  const plan = await buildAaveProtocolCanaryPlan({
    queueItem: {
      queueId: "merkl:sei-yei",
      opportunityId: "sei-yei",
      chain: "sei",
      protocolId: "yei",
      name: "Supply USDC to Yei",
      mappedStrategyId: "gateway_native_asset_conversion_sleeve",
      validationMode: "tiny_live_canary_only",
      aprPct: 25,
      campaignRemainingHours: 720,
      protocolBindingPlan: {
        status: "binding_ready",
        bindingKind: "aave_v3_pool_supply_withdraw",
        resolvedBinding: {
          poolAddress: "0x1111111111111111111111111111111111111111",
          assetAddress: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
          aTokenAddress: "0x4444444444444444444444444444444444444444",
          marketName: "yei_sei_usdc",
          assetSymbol: "USDC",
          assetDecimals: 6,
          aTokenSymbol: "aYeiNativeUSDC",
        },
      },
    },
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "100000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    simulateTransactionCallImpl: async (_chain, tx) => {
      if (tx.data.startsWith(AAVE_POOL_INTERFACE.getFunction("getReserveData").selector)) {
        return {
          returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getReserveData", [
            reserveDataResult({
              aTokenAddress: "0x4444444444444444444444444444444444444444",
            }),
          ]),
        };
      }
      return {
        returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getConfiguration", [reserveConfiguration()]),
      };
    },
    now: "2026-05-10T00:00:00.000Z",
  });

  const approvalIntent = plan.steps[0].intent;
  const supplyIntent = plan.steps[1].intent;
  assert.equal(supplyIntent.executionReason, "merkl_canary_autopilot");
  assert.equal(supplyIntent.metadata.tinyLiveCanary, true);
  assert.equal(approvalIntent.metadata.tinyLiveCanary, true);
  assert.equal(approvalIntent.metadata.parentIntent.intentType, "aave_supply");
  assert.equal(approvalIntent.metadata.parentEvEvidence.allow, true);
  assert.equal(evGate(approvalIntent, null, { now: "2026-05-10T00:00:00.000Z" }).allow, true);
});

test("aave protocol canary rejects provider pool mismatch", async () => {
  await assert.rejects(
    resolveAavePoolAddress({
      chain: "soneium",
      binding: {
        poolAddress: "0x1111111111111111111111111111111111111111",
        poolAddressProviderAddress: "0x2222222222222222222222222222222222222222",
      },
      simulateTransactionCallImpl: async () => ({
        returnData: AAVE_PROVIDER_INTERFACE.encodeFunctionResult("getPool", ["0x3333333333333333333333333333333333333333"]),
      }),
    }),
    /aave_pool_provider_mismatch/,
  );
});

test("aave reserve configuration decoder surfaces supply blockers", () => {
  const decoded = decodeAaveReserveConfiguration(reserveConfiguration({ frozen: true, paused: true, supplyCapWholeTokens: 8_000_000n }));

  assert.equal(decoded.decimals, 6);
  assert.equal(decoded.active, true);
  assert.equal(decoded.frozen, true);
  assert.equal(decoded.paused, true);
  assert.equal(decoded.supplyCapWholeTokens, "8000000");
});

test("aave protocol canary blocks frozen reserves before gas estimation", async () => {
  const queue = {
    queue: [
      {
        queueId: "representative:soneium",
        opportunityId: "soneium:stablecoin_lending_carry",
        chain: "soneium",
        protocolId: "aave-v3",
        name: "Soneium Aave representative",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "aave_v3_pool_supply_withdraw",
          resolvedBinding: {
            poolAddress: "0x1111111111111111111111111111111111111111",
            assetAddress: "0x3333333333333333333333333333333333333333",
            aTokenAddress: "0x4444444444444444444444444444444444444444",
            assetSymbol: "USDC",
            assetDecimals: 6,
            aTokenSymbol: "aSonUSDC",
          },
        },
      },
    ],
  };
  let gasCalls = 0;

  await assert.rejects(
    buildAaveProtocolCanaryPlan({
      queueItem: selectAaveQueueItem(queue, { opportunityId: "soneium:stablecoin_lending_carry" }),
      senderAddress: "0x2222222222222222222222222222222222222222",
      amount: "2999768",
      estimateGasImpl: async () => {
        gasCalls += 1;
        return { gasUnits: 50_000 };
      },
      simulateTransactionCallImpl: async (_chain, tx) => {
        if (tx.data.startsWith(AAVE_POOL_INTERFACE.getFunction("getReserveData").selector)) {
          return {
            returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getReserveData", [
              reserveDataResult({ configuration: reserveConfiguration({ frozen: true }) }),
            ]),
          };
        }
        return {
          returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getConfiguration", [reserveConfiguration({ frozen: true })]),
        };
      },
    }),
    /aave_reserve_not_supplyable:frozen/,
  );

  assert.equal(gasCalls, 0);
});

test("aave protocol canary blocks reserve aToken mismatches before gas estimation", async () => {
  const queue = {
    queue: [
      {
        queueId: "representative:soneium",
        opportunityId: "soneium:stablecoin_lending_carry",
        chain: "soneium",
        protocolId: "aave-v3",
        name: "Soneium Aave representative",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "aave_v3_pool_supply_withdraw",
          resolvedBinding: {
            poolAddress: "0x1111111111111111111111111111111111111111",
            assetAddress: "0x3333333333333333333333333333333333333333",
            aTokenAddress: "0x4444444444444444444444444444444444444444",
            assetSymbol: "USDC",
            assetDecimals: 6,
            aTokenSymbol: "aSonUSDC",
          },
        },
      },
    ],
  };
  let gasCalls = 0;

  await assert.rejects(
    buildAaveProtocolCanaryPlan({
      queueItem: selectAaveQueueItem(queue, { opportunityId: "soneium:stablecoin_lending_carry" }),
      senderAddress: "0x2222222222222222222222222222222222222222",
      amount: "2999768",
      estimateGasImpl: async () => {
        gasCalls += 1;
        return { gasUnits: 50_000 };
      },
      simulateTransactionCallImpl: async (_chain, tx) => {
        if (tx.data.startsWith(AAVE_POOL_INTERFACE.getFunction("getReserveData").selector)) {
          return {
            returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getReserveData", [
              reserveDataResult({ aTokenAddress: "0x7777777777777777777777777777777777777777" }),
            ]),
          };
        }
        return {
          returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getConfiguration", [reserveConfiguration()]),
        };
      },
    }),
    /aave_reserve_not_supplyable:a_token_mismatch/,
  );

  assert.equal(gasCalls, 0);
});

test("aave protocol canary accepts asset-spent proof when share token delta is opaque", async () => {
  const plan = {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    strategyId: "gateway_native_asset_conversion_sleeve",
    planStatus: "ready",
    chain: "ethereum",
    senderAddress: "0x2222222222222222222222222222222222222222",
    opportunityId: "eth-aave-rlusd",
    protocolId: "aave",
    bindingKind: "aave_v3_pool_supply_withdraw",
    name: "Lend RLUSD on Aave Horizon",
    poolAddress: "0x1111111111111111111111111111111111111111",
    poolAddressProviderAddress: "0x3333333333333333333333333333333333333333",
    marketName: "proto_mainnet_v3",
    assetAddress: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
    shareTokenAddress: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
    amount: "250",
    amountUsd: 25,
    minimumReturnBps: 9500,
    minimumRedeemAssetDelta: "237",
    asset: {
      token: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
      ticker: "RLUSD",
      family: "stablecoin",
      decimals: 18,
      chain: "ethereum",
      isNative: false,
    },
    shareAsset: {
      token: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
      ticker: "aHorRwaRLUSD",
      family: "protocol_share",
      decimals: 18,
      chain: "ethereum",
      isNative: false,
    },
    steps: [
      { id: "approve_asset_to_pool", intent: { tx: {}, amountUsd: 0 } },
      { id: "supply_asset_to_pool", intent: { tx: { data: "0x", gasLimit: "1" }, amountUsd: 25 } },
    ],
  };
  const balances = new Map([
    [`${plan.asset.token.toLowerCase()}:0`, "1000"],
    [`${plan.shareAsset.token.toLowerCase()}:0`, "0"],
    [`${plan.shareAsset.token.toLowerCase()}:1`, "0"],
    [`${plan.asset.token.toLowerCase()}:1`, "750"],
    [`${plan.shareAsset.token.toLowerCase()}:2`, "0"],
  ]);
  const calls = new Map();
  const execution = await executeAaveProtocolCanaryPlan({
    plan,
    sendCommand: async () => ({
      status: "ok",
      broadcast: { txHash: "0xtx" },
    }),
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20BalanceImpl: async (_chain, token) => {
      const lower = token.toLowerCase();
      const index = calls.get(lower) || 0;
      calls.set(lower, index + 1);
      return {
        rpcUrl: "memory",
        balance: balances.get(`${lower}:${index}`) || "0",
      };
    },
    settlementTimeoutMs: 0,
    sleepImpl: async () => {},
    exitAfterProof: false,
  });

  assert.equal(execution.settlementStatus, "position_opened");
  assert.equal(execution.shareProof.status, "unproven_timeout");
  assert.equal(execution.supplyProof.status, "delivered");
  assert.equal(execution.positionProof.proofSource, "erc20_balance_delta");
  assert.equal(execution.positionProof.observedDelta, "250");
});

test("aave protocol canary revokes approval and blocks before supply broadcast when supply preflight reverts", async () => {
  const plan = {
    schemaVersion: 1,
    observedAt: "2026-05-05T00:00:00.000Z",
    strategyId: "gateway_native_asset_conversion_sleeve",
    planStatus: "ready",
    chain: "soneium",
    senderAddress: "0x2222222222222222222222222222222222222222",
    opportunityId: "soneium:stablecoin_lending_carry",
    protocolId: "aave-v3",
    bindingKind: "aave_v3_pool_supply_withdraw",
    name: "Soneium Aave representative",
    poolAddress: "0x1111111111111111111111111111111111111111",
    assetAddress: "0x3333333333333333333333333333333333333333",
    shareTokenAddress: "0x4444444444444444444444444444444444444444",
    amount: "2999768",
    amountUsd: 2.999768,
    minimumReturnBps: 9500,
    minimumRedeemAssetDelta: "2849779",
    asset: {
      token: "0x3333333333333333333333333333333333333333",
      ticker: "USDC",
      family: "stablecoin",
      decimals: 6,
      chain: "soneium",
      isNative: false,
    },
    shareAsset: {
      token: "0x4444444444444444444444444444444444444444",
      ticker: "aSonUSDC",
      family: "protocol_share",
      decimals: 6,
      chain: "soneium",
      isNative: false,
    },
    steps: [
      {
        id: "approve_asset_to_pool",
        intent: {
          strategyId: "gateway_native_asset_conversion_sleeve",
          chain: "soneium",
          family: "evm",
          intentType: "approve_exact",
          amountUsd: 0,
          mode: "live",
          tx: { to: "0x3333333333333333333333333333333333333333", data: "0x", value: "0", gasLimit: "80000" },
          approval: {
            token: "0x3333333333333333333333333333333333333333",
            spender: "0x1111111111111111111111111111111111111111",
            amount: "2999768",
            mode: "per_tx",
          },
          metadata: { capCheckAmountUsd: 0 },
        },
      },
      {
        id: "supply_asset_to_pool",
        intent: {
          strategyId: "gateway_native_asset_conversion_sleeve",
          chain: "soneium",
          family: "evm",
          intentType: "aave_supply",
          amountUsd: 2.999768,
          mode: "live",
          tx: { to: "0x1111111111111111111111111111111111111111", data: "0x", value: "0", gasLimit: "432000" },
          metadata: { capCheckAmountUsd: 2.999768 },
        },
      },
    ],
  };
  const sent = [];

  await assert.rejects(
    executeAaveProtocolCanaryPlan({
      plan,
      sendCommand: async ({ message }) => {
        sent.push(message.intent);
        return {
          status: "ok",
          broadcast: { txHash: `0x${sent.length}` },
        };
      },
      estimateGasImpl: async () => {
        throw new Error("execution reverted: m0X");
      },
      readErc20BalanceImpl: async (_chain, token) => ({
        rpcUrl: "memory",
        balance: token.toLowerCase() === plan.asset.token.toLowerCase() ? "3293553" : "0",
      }),
      settlementTimeoutMs: 0,
      sleepImpl: async () => {},
    }),
    /aave_supply_preflight_failed/,
  );

  assert.deepEqual(sent.map((intent) => intent.intentType), ["approve_exact", "approve_exact"]);
  assert.equal(sent[1].approval.amount, "0");
  assert.equal(sent[1].metadata.approvalResetReason, "aave_supply_preflight_failed");
});
