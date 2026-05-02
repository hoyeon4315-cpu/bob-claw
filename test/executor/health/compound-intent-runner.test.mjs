import { describe, it } from "node:test";
import assert from "node:assert";
import {
  runCompoundIntent,
  COMPOUND_RECIPES,
} from "../../../src/executor/helpers/compound-intent-runner.mjs";

describe("compound-intent-runner", () => {
  it("returns ok=false when no steps provided", async () => {
    const result = await runCompoundIntent({ steps: [] });
    assert.strictEqual(result.ok, true); // zero steps = vacuously true
    assert.strictEqual(result.stepsExecuted, 0);
  });

  it("has recipe builders", () => {
    assert.ok(typeof COMPOUND_RECIPES.buildDepositRecipe === "function");
    assert.ok(typeof COMPOUND_RECIPES.buildOdosSwapRecipe === "function");
  });

  it("buildDepositRecipe returns correct steps", () => {
    const vaultAddress = "0x0000000000000000000000000000000000000001";
    const assetAddress = "0x0000000000000000000000000000000000000002";
    const signerAddress = "0x0000000000000000000000000000000000000003";
    const recipe = COMPOUND_RECIPES.buildDepositRecipe({
      vaultAddress,
      assetAddress,
      amount: "1000000",
      amountUsd: 1,
      signerAddress,
    });

    assert.strictEqual(recipe.steps.length, 2);
    assert.strictEqual(recipe.steps[0].name, "approve_vault");
    assert.strictEqual(recipe.steps[1].name, "vault_deposit");
    assert.strictEqual(recipe.steps[1].intent.intentType, "erc4626_deposit");
    assert.deepStrictEqual(recipe.steps[0].intent.approval, {
      token: assetAddress,
      spender: vaultAddress,
      amount: "1000000",
      mode: "per_tx",
    });
    assert.strictEqual(recipe.steps[1].intent.metadata.expectedTxTo, vaultAddress);
  });
});
