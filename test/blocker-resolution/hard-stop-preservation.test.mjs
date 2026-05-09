import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKER_CODES } from "../../src/executor/policy/blocker-codes.mjs";
import { registerBlockerRecipe } from "../../src/executor/blocker-resolution/recipes.mjs";

test("every hard safety stop rejects recipe registration", () => {
  for (const [code, meta] of Object.entries(BLOCKER_CODES)) {
    if (meta.category !== "hard_safety_stop") continue;
    assert.throws(() => registerBlockerRecipe(code, {
      recipeId: `bad_${code}`,
      kind: "hard_safety_stop",
      costClass: "cheap",
      dependencies: [],
      build: () => ({}),
    }));
  }
});
