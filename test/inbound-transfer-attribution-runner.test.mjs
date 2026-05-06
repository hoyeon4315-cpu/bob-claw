import { test } from "node:test";
import assert from "node:assert/strict";
import { ERC20_TRANSFER_TOPIC, addressTopic } from "../src/audit/evm-transfer-attribution.mjs";
import {
  buildInboundTransferAttributionReport,
  fetchErc20TransferLogsChunked,
  inboundTransferAttributionCandidates,
} from "../src/audit/inbound-transfer-attribution-runner.mjs";

const OPERATOR = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const TOKEN = "0x0555e30da8f98308edb960aa94c0db47230d2b9c";
const SENDER = "0x1111111111111111111111111111111111111111";

function chainConfigFor(chain) {
  if (chain !== "base") return null;
  return {
    chain: "base",
    chainId: 8453,
    rpcUrls: ["https://base.example/rpc-a", "https://base.example/rpc-b"],
  };
}

function inboundEvent(overrides = {}) {
  return {
    eventId: "evt-transfer",
    observedAt: "2026-05-01T00:02:00.000Z",
    previousObservedAt: "2026-05-01T00:00:00.000Z",
    address: OPERATOR,
    chain: "base",
    kind: "token",
    token: TOKEN,
    amount: "32105",
    amountDecimal: 0.00032105,
    estimatedUsd: 24.8967854,
    txHash: null,
    ...overrides,
  };
}

function transferLog(overrides = {}) {
  return {
    address: TOKEN,
    blockNumber: "0x7b",
    transactionHash: "0xtransfer",
    logIndex: "0x7",
    topics: [
      ERC20_TRANSFER_TOPIC,
      addressTopic(SENDER),
      addressTopic(OPERATOR),
    ],
    data: "0x7d69",
    ...overrides,
  };
}

test("inboundTransferAttributionCandidates selects tx-missing ERC20 events only", () => {
  const candidates = inboundTransferAttributionCandidates({
    chainConfigFor,
    existingAttributions: [{ eventId: "already-done" }],
    inboundEvents: [
      inboundEvent({ eventId: "already-done" }),
      inboundEvent({ eventId: "has-tx", txHash: "0xknown" }),
      inboundEvent({ eventId: "native", kind: "native" }),
      inboundEvent({ eventId: "amount-missing", amount: null }),
      inboundEvent({ eventId: "unsupported", chain: "bitcoin" }),
      inboundEvent({ eventId: "selected" }),
    ],
  });

  assert.deepEqual(candidates.map((event) => event.eventId), ["selected"]);
});

test("buildInboundTransferAttributionReport attributes exact logs through deterministic RPC path", async () => {
  const calls = [];
  const rpcImpl = async (rpcUrl, method, params) => {
    calls.push({ rpcUrl, method, params });
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getLogs") return [transferLog()];
    throw new Error(`unexpected ${method}`);
  };
  const report = await buildInboundTransferAttributionReport({
    chainConfigFor,
    rpcImpl,
    blockWindowResolver: async () => ({ fromBlock: 100, toBlock: 200 }),
    inboundEvents: [inboundEvent()],
  });

  assert.equal(report.summary.candidateEventCount, 1);
  assert.equal(report.summary.attributedCount, 1);
  assert.equal(report.records[0].eventId, "evt-transfer");
  assert.equal(report.records[0].txHash, "0xtransfer");
  const getLogsCall = calls.find((call) => call.method === "eth_getLogs");
  assert.equal(getLogsCall.params[0].fromBlock, "0x64");
  assert.equal(getLogsCall.params[0].toBlock, "0xc8");
  assert.equal(getLogsCall.params[0].address, TOKEN);
  assert.deepEqual(getLogsCall.params[0].topics, [
    ERC20_TRANSFER_TOPIC,
    null,
    addressTopic(OPERATOR),
  ]);
});

test("buildInboundTransferAttributionReport records misses without inventing attribution", async () => {
  const report = await buildInboundTransferAttributionReport({
    chainConfigFor,
    rpcImpl: async (_rpcUrl, method) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_getLogs") return [transferLog({ data: "0x1" })];
      throw new Error(`unexpected ${method}`);
    },
    blockWindowResolver: async () => ({ fromBlock: 100, toBlock: 200 }),
    inboundEvents: [inboundEvent()],
  });

  assert.equal(report.summary.attributedCount, 0);
  assert.equal(report.summary.missCount, 1);
  assert.equal(report.misses[0].eventId, "evt-transfer");
});

test("buildInboundTransferAttributionReport attributes native events from imported tx history", async () => {
  const report = await buildInboundTransferAttributionReport({
    chainConfigFor,
    inboundEvents: [inboundEvent({
      eventId: "evt-native",
      chain: "base",
      kind: "native",
      token: "0x0000000000000000000000000000000000000000",
      amount: "2035889450612546048",
      amountDecimal: 2.035889450612546,
      estimatedUsd: 0.12348687462690398,
    })],
    nativeTransactionRecords: [
      {
        chain: "base",
        hash: "0xnative",
        from: SENDER,
        to: OPERATOR,
        value: "0x1c40eeab31b9da00",
        blockNumber: "0x456",
        transactionIndex: "0x3",
        sourceFile: "data/treasury/inbound-native-transfer-history.jsonl",
      },
    ],
    rpcImpl: async () => {
      throw new Error("native history attribution should not call RPC");
    },
  });

  assert.equal(report.summary.candidateEventCount, 1);
  assert.equal(report.summary.attributedCount, 1);
  assert.equal(report.records[0].eventId, "evt-native");
  assert.equal(report.records[0].txHash, "0xnative");
  assert.equal(report.records[0].confidence, "tx_attributed_native_transfer_history");
});

test("buildInboundTransferAttributionReport records native misses when history is absent", async () => {
  const report = await buildInboundTransferAttributionReport({
    chainConfigFor,
    inboundEvents: [inboundEvent({
      eventId: "evt-native",
      chain: "base",
      kind: "native",
      token: "0x0000000000000000000000000000000000000000",
      amount: "2035889450612546048",
    })],
  });

  assert.equal(report.summary.attributedCount, 0);
  assert.equal(report.summary.missCount, 1);
  assert.deepEqual(report.misses[0], {
    eventId: "evt-native",
    chain: "base",
    token: "0x0000000000000000000000000000000000000000",
    reason: "native_transfer_history_missing_or_no_exact_match",
  });
});

test("fetchErc20TransferLogsChunked respects RPC block range limits", async () => {
  const ranges = [];
  const logs = await fetchErc20TransferLogsChunked({
    rpcUrl: "https://base.example/rpc-a",
    maxBlockRange: 75,
    filter: {
      address: TOKEN,
      fromBlock: "0x64",
      toBlock: "0xfa",
      topics: [ERC20_TRANSFER_TOPIC, null, addressTopic(OPERATOR)],
    },
    rpcImpl: async (_rpcUrl, method, params) => {
      assert.equal(method, "eth_getLogs");
      ranges.push([params[0].fromBlock, params[0].toBlock]);
      return [transferLog({ logIndex: params[0].fromBlock })];
    },
  });

  assert.deepEqual(ranges, [
    ["0x64", "0xae"],
    ["0xaf", "0xf9"],
    ["0xfa", "0xfa"],
  ]);
  assert.equal(logs.length, 3);
});
