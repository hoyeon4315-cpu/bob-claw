import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ERC20_TRANSFER_TOPIC,
  addressTopic,
  attributeInboundEventFromTransferLogs,
  buildErc20InboundTransferFilter,
  normalizeErc20TransferLog,
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
