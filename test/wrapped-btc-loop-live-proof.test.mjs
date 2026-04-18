import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import {
  buildWrappedBtcLoopLiveProof,
  enrichWrappedBtcLoopLiveProof,
  hydrateWrappedBtcLoopLiveProof,
  stabilizeWrappedBtcLoopLiveProof,
  summarizeWrappedBtcLoopLiveProof,
} from "../src/strategy/wrapped-btc-loop-live-proof.mjs";

test("wrapped btc loop live proof summarizes successful signer-backed roundtrip", () => {
  const proof = buildWrappedBtcLoopLiveProof({
    result: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      perTradeCapUsdOverride: 7,
      marketAssumptionsOverride: { minIncrementUsd: 2 },
      entryResults: [
        { broadcast: { txHash: "0xentry1" } },
        { broadcast: { txHash: "0xentry2" } },
      ],
      unwindResults: [
        { broadcast: { txHash: "0xunwind1" } },
      ],
      receiptAutoIngest: {
        ran: false,
        reason: "no_matching_ingest_command",
      },
      ok: true,
    },
    receiptContext: {
      observedHealthFactorPath: [1.51, 1.43],
      observedLiquidationBufferPath: [18.2, 13.6],
      actualLoopFeesUsd: 1.2345678,
      actualUnwindCostUsd: 0.7654321,
      realizedNetCarryUsd: 0,
    },
    now: "2026-04-16T21:37:24.879Z",
  });

  assert.equal(proof.proofStatus, "signer_backed_roundtrip_recorded");
  assert.deepEqual(proof.entryTxHashes, ["0xentry1", "0xentry2"]);
  assert.deepEqual(proof.unwindTxHashes, ["0xunwind1"]);
  assert.deepEqual(proof.observedHealthFactorPath, [1.51, 1.43]);
  assert.deepEqual(proof.observedLiquidationBufferPath, [18.2, 13.6]);
  assert.equal(proof.actualLoopFeesUsd, 1.234568);
  assert.equal(proof.oosReceiptStatus, "ingestable_extended_receipt_context_ready");
  assert.equal(proof.extendedReceiptContextReady, true);

  const summary = summarizeWrappedBtcLoopLiveProof(proof);
  assert.equal(summary.proofRecorded, true);
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.unwindCount, 1);
  assert.equal(summary.extendedReceiptContextReady, true);
});

test("wrapped btc loop live proof hydrates missing fee fields from capital audit and exposes remaining blockers", () => {
  const proof = hydrateWrappedBtcLoopLiveProof({
    proof: {
      schemaVersion: 1,
      observedAt: "2026-04-16T21:37:24.879Z",
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      success: true,
      proofStatus: "signer_backed_roundtrip_recorded",
      entryCount: 2,
      unwindCount: 1,
      entryTxHashes: ["0xentry1", "0xentry2"],
      unwindTxHashes: ["0xunwind1"],
      actualLoopFeesUsd: null,
      actualUnwindCostUsd: null,
      realizedNetCarryUsd: null,
      oosReceiptStatus: "extended_receipt_context_pending",
    },
    capitalAuditReport: {
      transactions: [
        { txHash: "0xentry1", gasUsd: 0.11 },
        { txHash: "0xentry2", gasUsd: 0.22 },
        { txHash: "0xunwind1", gasUsd: 0.33 },
      ],
    },
  });

  assert.equal(proof.actualLoopFeesUsd, 0.33);
  assert.equal(proof.actualUnwindCostUsd, 0.33);
  assert.equal(proof.extendedReceiptContextReady, false);
  assert.deepEqual(proof.missingExtendedReceiptFields, [
    "observedHealthFactorPath",
    "observedLiquidationBufferPath",
    "realizedNetCarryUsd",
  ]);
});

test("wrapped btc loop live proof enriches missing observed entry metrics from historical chain state", async () => {
  const comptroller = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";
  const collateralMarket = "0xF877ACaFA28c19b96727966690b2f44d35aD5976";
  const borrowMarket = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
  const oracle = "0xec942be8a8114bfd0396a5052c36027f2ca6a9d0";
  const account = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
  const comptrollerInterface = new Interface([
    "function oracle() view returns (address)",
    "function markets(address) view returns (bool,uint256,bool)",
  ]);
  const eventInterface = new Interface([
    "event Mint(address minter,uint256 mintAmount,uint256 mintTokens)",
    "event Borrow(address borrower,uint256 borrowAmount,uint256 accountBorrows,uint256 totalBorrows)",
  ]);
  const priceOracleInterface = new Interface([
    "function getUnderlyingPrice(address mToken) view returns (uint256)",
  ]);
  const enriched = await enrichWrappedBtcLoopLiveProof({
    proof: {
      schemaVersion: 1,
      observedAt: "2026-04-16T21:37:24.879Z",
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      success: true,
      proofKind: "signer_backed_roundtrip",
      proofStatus: "signer_backed_roundtrip_recorded",
      entryCount: 2,
      unwindCount: 1,
      entryTxHashes: ["0xentry1", "0xentry2"],
      unwindTxHashes: ["0xunwind1"],
      actualLoopFeesUsd: 0.33,
      actualUnwindCostUsd: 0.11,
      realizedNetCarryUsd: null,
      observedHealthFactorPath: [],
      observedLiquidationBufferPath: [],
      oosReceiptStatus: "extended_receipt_context_pending",
    },
    readTransactionReceiptImpl: async (_chain, txHash) =>
      txHash === "0xentry1"
        ? {
            transactionHash: "0xentry1",
            blockNumber: 120,
            from: account,
            raw: {
              logs: [
                {
                  address: collateralMarket,
                  topics: [eventInterface.getEvent("Mint").topicHash],
                  data: eventInterface.encodeEventLog(eventInterface.getEvent("Mint"), [account, 9337n, 465263n]).data,
                },
              ],
            },
          }
        : {
            transactionHash: "0xentry2",
            blockNumber: 123,
            from: account,
            raw: {
              logs: [
                {
                  address: borrowMarket,
                  topics: [eventInterface.getEvent("Borrow").topicHash],
                  data: eventInterface.encodeEventLog(eventInterface.getEvent("Borrow"), [account, 3140000n, 3140000n, 3140000n]).data,
                },
                {
                  address: collateralMarket,
                  topics: [eventInterface.getEvent("Mint").topicHash],
                  data: eventInterface.encodeEventLog(eventInterface.getEvent("Mint"), [account, 4188n, 208688n]).data,
                },
              ],
            },
          },
    simulateTransactionCallImpl: async (_chain, { to, data }) => {
      const target = String(to).toLowerCase();
      if (target === comptroller.toLowerCase() && data === comptrollerInterface.encodeFunctionData("oracle")) {
        return { returnData: comptrollerInterface.encodeFunctionResult("oracle", [oracle]) };
      }
      if (target === comptroller.toLowerCase() && data === comptrollerInterface.encodeFunctionData("markets", [collateralMarket])) {
        return {
          returnData: `0x${"1".padStart(64, "0")}${BigInt("850000000000000000").toString(16).padStart(64, "0")}`,
        };
      }
      if (target === oracle.toLowerCase() && data === priceOracleInterface.encodeFunctionData("getUnderlyingPrice", [collateralMarket])) {
        return {
          returnData: priceOracleInterface.encodeFunctionResult("getUnderlyingPrice", [750073660000000000000000000000000n]),
        };
      }
      if (target === oracle.toLowerCase() && data === priceOracleInterface.encodeFunctionData("getUnderlyingPrice", [borrowMarket])) {
        return {
          returnData: priceOracleInterface.encodeFunctionResult("getUnderlyingPrice", [999890000000000000000000000000n]),
        };
      }
      throw new Error(`unexpected call: ${to} ${data}`);
    },
  });

  assert.deepEqual(enriched.observedHealthFactorPath, [2.7465]);
  assert.deepEqual(enriched.observedLiquidationBufferPath, [54.0514]);
  assert.equal(enriched.realizedNetCarryUsd, 0);
  assert.equal(enriched.extendedReceiptContextReady, true);
  assert.deepEqual(enriched.missingExtendedReceiptFields, []);
});

test("wrapped btc loop live proof stabilization keeps the best enrichment across flaky retries", async () => {
  const comptroller = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";
  const collateralMarket = "0xF877ACaFA28c19b96727966690b2f44d35aD5976";
  const borrowMarket = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
  const oracle = "0xec942be8a8114bfd0396a5052c36027f2ca6a9d0";
  const account = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
  const comptrollerInterface = new Interface([
    "function oracle() view returns (address)",
    "function markets(address) view returns (bool,uint256,bool)",
  ]);
  const eventInterface = new Interface([
    "event Mint(address minter,uint256 mintAmount,uint256 mintTokens)",
    "event Borrow(address borrower,uint256 borrowAmount,uint256 accountBorrows,uint256 totalBorrows)",
  ]);
  const priceOracleInterface = new Interface([
    "function getUnderlyingPrice(address mToken) view returns (uint256)",
  ]);
  let simulateAttempts = 0;

  const stabilized = await stabilizeWrappedBtcLoopLiveProof({
    proof: {
      schemaVersion: 1,
      observedAt: "2026-04-16T21:37:24.879Z",
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      success: true,
      proofKind: "signer_backed_roundtrip",
      proofStatus: "signer_backed_roundtrip_recorded",
      entryCount: 2,
      unwindCount: 1,
      entryTxHashes: ["0xentry1", "0xentry2"],
      unwindTxHashes: ["0xunwind1"],
      actualLoopFeesUsd: 0.33,
      actualUnwindCostUsd: 0.11,
      realizedNetCarryUsd: null,
      observedHealthFactorPath: [],
      observedLiquidationBufferPath: [],
      oosReceiptStatus: "extended_receipt_context_pending",
    },
    attempts: 3,
    readTransactionReceiptImpl: async (_chain, txHash) =>
      txHash === "0xentry1"
        ? {
            transactionHash: "0xentry1",
            blockNumber: 120,
            from: account,
            raw: {
              logs: [
                {
                  address: collateralMarket,
                  topics: [eventInterface.getEvent("Mint").topicHash],
                  data: eventInterface.encodeEventLog(eventInterface.getEvent("Mint"), [account, 9337n, 465263n]).data,
                },
              ],
            },
          }
        : {
            transactionHash: "0xentry2",
            blockNumber: 123,
            from: account,
            raw: {
              logs: [
                {
                  address: borrowMarket,
                  topics: [eventInterface.getEvent("Borrow").topicHash],
                  data: eventInterface.encodeEventLog(eventInterface.getEvent("Borrow"), [account, 3140000n, 3140000n, 3140000n]).data,
                },
                {
                  address: collateralMarket,
                  topics: [eventInterface.getEvent("Mint").topicHash],
                  data: eventInterface.encodeEventLog(eventInterface.getEvent("Mint"), [account, 4188n, 208688n]).data,
                },
              ],
            },
          },
    simulateTransactionCallImpl: async (_chain, { to, data }) => {
      simulateAttempts += 1;
      if (simulateAttempts <= 2) {
        throw new Error("flaky rpc");
      }
      const target = String(to).toLowerCase();
      if (target === comptroller.toLowerCase() && data === comptrollerInterface.encodeFunctionData("oracle")) {
        return { returnData: comptrollerInterface.encodeFunctionResult("oracle", [oracle]) };
      }
      if (target === comptroller.toLowerCase() && data === comptrollerInterface.encodeFunctionData("markets", [collateralMarket])) {
        return {
          returnData: `0x${"1".padStart(64, "0")}${BigInt("850000000000000000").toString(16).padStart(64, "0")}`,
        };
      }
      if (target === oracle.toLowerCase() && data === priceOracleInterface.encodeFunctionData("getUnderlyingPrice", [collateralMarket])) {
        return {
          returnData: priceOracleInterface.encodeFunctionResult("getUnderlyingPrice", [750073660000000000000000000000000n]),
        };
      }
      if (target === oracle.toLowerCase() && data === priceOracleInterface.encodeFunctionData("getUnderlyingPrice", [borrowMarket])) {
        return {
          returnData: priceOracleInterface.encodeFunctionResult("getUnderlyingPrice", [999890000000000000000000000000n]),
        };
      }
      throw new Error(`unexpected call: ${to} ${data}`);
    },
  });

  assert.deepEqual(stabilized.observedHealthFactorPath, [2.7465]);
  assert.deepEqual(stabilized.observedLiquidationBufferPath, [54.0514]);
  assert.equal(stabilized.realizedNetCarryUsd, 0);
  assert.equal(stabilized.extendedReceiptContextReady, true);
  assert.deepEqual(stabilized.missingExtendedReceiptFields, []);
});
