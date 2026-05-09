import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildClosedCanaryCycleRecords,
  evaluateRepeatCanaryProfitabilityGate,
  normalizeExplorationKey,
} from "../src/executor/canary/realized-cycle-truth.mjs";

test("normalizeExplorationKey survives renamed candidates and canonicalizes chain aliases", () => {
  const left = normalizeExplorationKey({
    strategyId: "merkl-canary",
    chain: "BNB Chain",
    protocolId: "venus",
    assetPair: ["USDC", "WETH"],
    rewardToken: "MERKL",
    campaignId: "campaign-1",
    bindingKind: "aave_v3_pool_supply_withdraw",
    candidateId: "old-name",
  });
  const right = normalizeExplorationKey({
    strategyId: "merkl-canary",
    chain: "bsc",
    protocolId: "venus",
    assetPair: "weth/usdc",
    rewardToken: "merkl",
    opportunityId: "campaign-1",
    bindingKind: "aave_v3_pool_supply_withdraw",
    candidateId: "new-name",
  });

  assert.equal(left, right);
});

test("normalizeExplorationKey separates unrelated protocol or asset-pair opportunities", () => {
  const venus = normalizeExplorationKey({
    strategyId: "merkl-canary",
    chain: "base",
    protocolId: "venus",
    assetPair: "weth/usdc",
    rewardToken: "merkl",
    opportunityId: "campaign-1",
    bindingKind: "aave_v3_pool_supply_withdraw",
  });
  const moonwell = normalizeExplorationKey({
    strategyId: "merkl-canary",
    chain: "base",
    protocolId: "moonwell",
    assetPair: "weth/usdc",
    rewardToken: "merkl",
    opportunityId: "campaign-1",
    bindingKind: "aave_v3_pool_supply_withdraw",
  });

  assert.notEqual(venus, moonwell);
});

test("closed canary cycle records require terminal reconciliation and all realized cost fields", () => {
  const records = buildClosedCanaryCycleRecords({
    positionRecords: [
      {
        positionId: "pos-1",
        strategyId: "merkl-canary",
        chain: "base",
        protocolId: "moonwell",
        opportunityId: "campaign-1",
        bindingKind: "erc4626_vault_supply_withdraw",
        openedAt: "2026-05-09T00:00:00.000Z",
        closedAt: "2026-05-09T01:00:00.000Z",
        entryUsd: 20,
        exitUsd: 20.8,
        entryGasUsd: 0.05,
        exitGasUsd: 0.05,
        claimCostUsd: 0,
        rewardSwapCostUsd: 0,
        rewardUsd: 0.1,
        bridgeCostUsd: 0,
        slippageUsd: 0.01,
        terminalReconciliationStatus: "reconciled",
        sourceObservedAt: "2026-05-09T01:01:00.000Z",
      },
      {
        positionId: "pos-2",
        strategyId: "merkl-canary",
        chain: "base",
        protocolId: "moonwell",
        opportunityId: "campaign-2",
        bindingKind: "erc4626_vault_supply_withdraw",
        openedAt: "2026-05-09T02:00:00.000Z",
        closedAt: "2026-05-09T03:00:00.000Z",
        entryUsd: 20,
        exitUsd: 19.9,
        terminalReconciliationStatus: "pending",
        sourceObservedAt: "2026-05-09T03:01:00.000Z",
      },
    ],
    btcUsd: 100000,
  });

  assert.equal(records[0].completenessStatus, "complete");
  assert.equal(records[0].realizedNetUsd, 0.79);
  assert.equal(records[0].realizedNetBtcSats, 790);
  assert.equal(records[1].completenessStatus, "incomplete");
  assert.ok(records[1].missingFields.includes("entryGasUsd"));
  assert.ok(records[1].missingFields.includes("terminalReconciliationStatus:reconciled"));
});

test("closed canary cycle records hydrate production nested receipt records", () => {
  const records = buildClosedCanaryCycleRecords({
    positionRecords: [
      {
        positionId: "pos-nested",
        status: "delivered",
        observedAt: "2026-05-09T04:00:00.000Z",
        queueItem: {
          mappedStrategyId: "merkl-canary",
          chain: "base",
          protocolId: "morpho",
          opportunityId: "campaign-nested",
          assetPair: "usdc/steakusdc",
          rewardToken: null,
          bindingKind: "erc4626_vault_supply_withdraw",
        },
        plan: {
          observedAt: "2026-05-09T03:00:00.000Z",
          amountUsd: 0.25,
        },
        execution: {
          settlementStatus: "delivered",
          receiptIngest: {
            receiptRecord: {
              observedAt: "2026-05-09T04:00:00.000Z",
              reconciliationStatus: "reconciled",
              routeContext: {
                estimatedInputUsd: 0.25,
              },
              output: {
                actualOutputUsd: 0.27,
              },
              realized: {
                actualKnownCostUsd: 0.003,
                receiptGasUsd: 0.003,
                realizedNetPnlUsd: 0.017,
                realizedNetPnlSats: 17,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(records[0].completenessStatus, "complete");
  assert.equal(records[0].terminalReconciliationStatus, "reconciled");
  assert.equal(records[0].entryUsd, 0.25);
  assert.equal(records[0].exitUsd, 0.27);
  assert.equal(records[0].entryGasUsd, 0);
  assert.equal(records[0].exitGasUsd, 0.003);
  assert.equal(records[0].realizedNetUsd, 0.017);
  assert.equal(records[0].realizedNetBtcSats, 17);
});

test("failed protocol position marks become same-key repeat blockers", () => {
  const keyInput = {
    strategyId: "merkl-canary",
    chain: "base",
    protocolId: "moonwell",
    assetPair: "cbbtc/usdc",
    rewardToken: "well",
    opportunityId: "campaign-protocol-gap",
    bindingKind: "erc4626_vault_supply_withdraw",
  };
  const records = buildClosedCanaryCycleRecords({
    protocolPositionMarks: [
      {
        ...keyInput,
        status: "failed",
        failureKind: "reader_timeout",
        observedAt: "2026-05-09T04:10:00.000Z",
      },
    ],
  });
  const gate = evaluateRepeatCanaryProfitabilityGate({
    explorationKey: normalizeExplorationKey(keyInput),
    closedCycles: records,
  });

  assert.equal(records[0].completenessStatus, "incomplete");
  assert.equal(gate.blockers[0], "protocol_position_unmeasured_blocks_repeat_canary");
});

test("repeat canary gate allows first exploration without history but blocks bad same-key repeats", () => {
  const key = normalizeExplorationKey({
    strategyId: "merkl-canary",
    chain: "base",
    protocolId: "moonwell",
    assetPair: "weth/usdc",
    rewardToken: "merkl",
    opportunityId: "campaign-1",
    bindingKind: "erc4626_vault_supply_withdraw",
  });

  assert.equal(
    evaluateRepeatCanaryProfitabilityGate({ explorationKey: key, closedCycles: [] }).decision,
    "ALLOW",
  );
  assert.equal(
    evaluateRepeatCanaryProfitabilityGate({
      explorationKey: key,
      closedCycles: [{ explorationKey: key, completenessStatus: "incomplete", closedAt: "2026-05-09T00:00:00.000Z" }],
    }).blockers[0],
    "accounting_incomplete_blocks_repeat_canary",
  );
  assert.equal(
    evaluateRepeatCanaryProfitabilityGate({
      explorationKey: key,
      closedCycles: [{ explorationKey: key, completenessStatus: "complete", realizedNetUsd: -0.01, closedAt: "2026-05-09T00:00:00.000Z" }],
    }).blockers[0],
    "realized_net_non_positive_blocks_repeat_canary",
  );
  assert.equal(
    evaluateRepeatCanaryProfitabilityGate({
      explorationKey: key,
      closedCycles: [{ explorationKey: key, completenessStatus: "complete", realizedNetUsd: 0.01, closedAt: "2026-05-09T00:00:00.000Z" }],
    }).decision,
    "ALLOW",
  );
});
