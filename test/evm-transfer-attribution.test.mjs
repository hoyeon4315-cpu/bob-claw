import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ERC20_TRANSFER_TOPIC,
  addressTopic,
  attributeInboundEventFromTransferLogs,
  attributeInboundNativeEventFromTransactions,
  buildErc20InboundTransferFilter,
  normalizeErc20TransferLog,
  normalizeNativeTransferTransaction,
} from "../src/audit/evm-transfer-attribution.mjs";

const OPERATOR = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const SENDER = "0x1111111111111111111111111111111111111111";

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

test("addressTopic pads EVM addresses for indexed log topics", () => {
  assert.equal(
    addressTopic(OPERATOR),
    "0x00000000000000000000000096262be63aa687563789225c2fe898c27a3b0ae4",
  );
});

test("buildErc20InboundTransferFilter targets Transfer logs into the operator address", () => {
  const filter = buildErc20InboundTransferFilter({
    token: TOKEN,
    to: OPERATOR,
    fromBlock: 100,
    toBlock: 200,
  });

  assert.deepEqual(filter, {
    address: TOKEN,
    fromBlock: "0x64",
    toBlock: "0xc8",
    topics: [
      ERC20_TRANSFER_TOPIC,
      null,
      addressTopic(OPERATOR),
    ],
  });
});

test("normalizeErc20TransferLog decodes transfer log identity and amount", () => {
  const normalized = normalizeErc20TransferLog({ chain: "base", token: TOKEN, log: transferLog() });

  assert.equal(normalized.chain, "base");
  assert.equal(normalized.token, TOKEN.toLowerCase());
  assert.equal(normalized.txHash, "0xtransfer");
  assert.equal(normalized.blockNumber, 123);
  assert.equal(normalized.logIndex, 7);
  assert.equal(normalized.from, SENDER.toLowerCase());
  assert.equal(normalized.to, OPERATOR.toLowerCase());
  assert.equal(normalized.amount, "32105");
});

test("attributeInboundEventFromTransferLogs returns exact tx proof for matching amount", () => {
  const record = attributeInboundEventFromTransferLogs({
    event: {
      eventId: "evt-transfer",
      observedAt: "2026-05-01T00:02:00.000Z",
      chain: "base",
      token: TOKEN.toLowerCase(),
      amount: "32105",
      amountDecimal: 0.00032105,
      estimatedUsd: 24.8967854,
    },
    logs: [transferLog()],
    operatorAddress: OPERATOR,
  });

  assert.equal(record.eventId, "evt-transfer");
  assert.equal(record.txHash, "0xtransfer");
  assert.equal(record.chain, "base");
  assert.equal(record.token, TOKEN.toLowerCase());
  assert.equal(record.amount, "32105");
  assert.equal(record.amountDecimal, 0.00032105);
  assert.equal(record.estimatedUsd, 24.8967854);
  assert.equal(record.sourceFile, "rpc:eth_getLogs");
  assert.equal(record.confidence, "tx_attributed_erc20_transfer_log");
  assert.equal(record.from, SENDER.toLowerCase());
  assert.equal(record.to, OPERATOR.toLowerCase());
});

test("attributeInboundEventFromTransferLogs rejects wrong recipient and wrong amount", () => {
  const event = {
    eventId: "evt-transfer",
    observedAt: "2026-05-01T00:02:00.000Z",
    chain: "base",
    token: TOKEN.toLowerCase(),
    amount: "32105",
  };

  assert.equal(attributeInboundEventFromTransferLogs({
    event,
    logs: [transferLog({ topics: [ERC20_TRANSFER_TOPIC, addressTopic(SENDER), addressTopic(SENDER)] })],
    operatorAddress: OPERATOR,
  }), null);

  assert.equal(attributeInboundEventFromTransferLogs({
    event,
    logs: [transferLog({ data: "0x1" })],
    operatorAddress: OPERATOR,
  }), null);
});

test("normalizeNativeTransferTransaction decodes direct native transfers", () => {
  const normalized = normalizeNativeTransferTransaction({
    chain: "sei",
    tx: {
      hash: "0xnative",
      blockNumber: "0x456",
      transactionIndex: "0x3",
      from: SENDER,
      to: OPERATOR,
      value: "0x1c40eeab31b9da00",
    },
  });

  assert.equal(normalized.chain, "sei");
  assert.equal(normalized.txHash, "0xnative");
  assert.equal(normalized.blockNumber, 1110);
  assert.equal(normalized.transactionIndex, 3);
  assert.equal(normalized.from, SENDER.toLowerCase());
  assert.equal(normalized.to, OPERATOR.toLowerCase());
  assert.equal(normalized.amount, "2035889450612546048");
});

test("attributeInboundNativeEventFromTransactions returns exact tx proof for matching native amount", () => {
  const record = attributeInboundNativeEventFromTransactions({
    event: {
      eventId: "evt-native",
      observedAt: "2026-05-01T00:02:00.000Z",
      chain: "sei",
      token: "0x0000000000000000000000000000000000000000",
      amount: "2035889450612546048",
      amountDecimal: 2.035889450612546,
      estimatedUsd: 0.12348687462690398,
    },
    transactions: [
      {
        hash: "0xnative",
        blockNumber: "0x456",
        transactionIndex: "0x3",
        from: SENDER,
        to: OPERATOR,
        value: "0x1c40eeab31b9da00",
      },
    ],
    operatorAddress: OPERATOR,
    sourceFile: "explorer:sei:account_txs",
  });

  assert.equal(record.eventId, "evt-native");
  assert.equal(record.txHash, "0xnative");
  assert.equal(record.chain, "sei");
  assert.equal(record.amount, "2035889450612546048");
  assert.equal(record.amountDecimal, 2.035889450612546);
  assert.equal(record.estimatedUsd, 0.12348687462690398);
  assert.equal(record.sourceFile, "explorer:sei:account_txs");
  assert.equal(record.confidence, "tx_attributed_native_transfer_history");
  assert.equal(record.from, SENDER.toLowerCase());
  assert.equal(record.to, OPERATOR.toLowerCase());
});

test("attributeInboundNativeEventFromTransactions rejects token and amount mismatches", () => {
  const event = {
    eventId: "evt-native",
    observedAt: "2026-05-01T00:02:00.000Z",
    chain: "sei",
    token: "0x0000000000000000000000000000000000000000",
    amount: "2035889450612546048",
  };

  assert.equal(attributeInboundNativeEventFromTransactions({
    event: { ...event, token: TOKEN.toLowerCase() },
    transactions: [{ hash: "0xnative", from: SENDER, to: OPERATOR, value: "0x1c40eeab31b9da00" }],
    operatorAddress: OPERATOR,
  }), null);

  assert.equal(attributeInboundNativeEventFromTransactions({
    event,
    transactions: [{ hash: "0xnative", from: SENDER, to: OPERATOR, value: "0x1" }],
    operatorAddress: OPERATOR,
  }), null);
});
