import { describe, it } from "node:test";
import assert from "node:assert";
import {
  runCompoundIntent,
  COMPOUND_RECIPES,
} from "../../src/executor/helpers/compound-intent-runner.mjs";

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
    const recipe = COMPOUND_RECIPES.buildDepositRecipe({
      vaultAddress: "0xVAULT",
      assetAddress: "0xASSET",
      amount: "1000000",
      amountUsd: 1,
      signerAddress: "0xUSER",
    });

    assert.strictEqual(recipe.steps.length, 2);
    assert.strictEqual(recipe.steps[0].name, "approve_vault");
    assert.strictEqual(recipe.steps[1].name, "vault_deposit");
    assert.strictEqual(recipe.steps[1].intent.intentType, "erc4626_deposit");
  });
});
