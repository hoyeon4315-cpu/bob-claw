import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDefaultWrappedBtcLendingLoopConfig } from "../src/strategy/wrapped-btc-lending-loop-slice.mjs";
import {
  buildWrappedBtcLoopBindingsTemplate,
  inspectWrappedBtcLoopBindingsDocument,
  resolveWrappedBtcLoopBindingSupport,
} from "../src/strategy/wrapped-btc-loop-bindings.mjs";

test("wrapped BTC loop binding support resolves Moonwell Base cbBTC/USDC markets and enables repo auto-build", () => {
  const strategyConfig = buildDefaultWrappedBtcLendingLoopConfig();
  const support = resolveWrappedBtcLoopBindingSupport({
    strategyId: strategyConfig.id,
    strategyConfig,
  });

  assert.equal(support.status, "repo_auto_build_supported");
  assert.equal(support.executableFromRepo, true);
  assert.equal(support.marketResolution.allAuthoritativeMarketsResolved, true);
  assert.equal(support.marketResolution.repoSwapSourceResolved, true);
  assert.equal(support.blockers.length, 0);
  assert.equal(support.knownContracts.collateralMarket.mTokenAddress, "0xF877ACaFA28c19b96727966690b2f44d35aD5976");
  assert.equal(support.knownContracts.borrowMarket.mTokenAddress, "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22");
  assert.equal(support.swapSource.provider, "odos");
});

test("wrapped BTC loop binding template preserves the missing-facts boundary without fabricating calldata", () => {
  const strategyConfig = buildDefaultWrappedBtcLendingLoopConfig();
  const template = buildWrappedBtcLoopBindingsTemplate({
    strategyId: strategyConfig.id,
    strategyConfig,
    now: "2026-04-15T22:00:00.000Z",
  });

  const scenario = template.strategies[strategyConfig.id].scenarios.healthy_baseline;
  assert.equal(template.schemaVersion, 1);
  assert.equal(template.strategies[strategyConfig.id].bindingStatus, "repo_auto_build_supported");
  assert.equal(template.strategies[strategyConfig.id].marketResolution.allAuthoritativeMarketsResolved, true);
  assert.deepEqual(scenario.entry, []);
  assert.deepEqual(scenario.unwind, []);
  assert.equal(
    scenario.receiptContext.notes.includes("Entry/unwind arrays may remain empty because the repo can auto-build Moonwell core txs plus Odos safe-whitelist swap calldata at runtime."),
    true,
  );
});

test("wrapped BTC loop binding validator rejects malformed tx payloads", () => {
  const inspection = inspectWrappedBtcLoopBindingsDocument({
    bindingsDocument: {
      schemaVersion: 1,
      strategies: {
        "wrapped-btc-loop-base-moonwell": {
          scenarios: {
            healthy_baseline: {
              entry: [{ tx: { to: "0x1234", data: "0xdeadbeef" } }],
              unwind: [{ tx: { to: "0x0000000000000000000000000000000000000001", data: "0x1" } }],
            },
          },
        },
      },
    },
  });

  assert.equal(inspection.ok, false);
  assert.equal(inspection.errors.some((item) => item.includes("entry[0].tx.to")), true);
  assert.equal(inspection.errors.some((item) => item.includes("unwind[0].tx.data")), true);
});
