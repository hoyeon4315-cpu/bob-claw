import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

test("blocker resolver recipes do not import signer or mutate hard-stop state", async () => {
  const moduleText = await readFile(resolve("src/executor/blocker-resolution/recipes.mjs"), "utf8");
  for (const pattern of [
    /signSync/u,
    /broadcastTx/u,
    /signer\/local-key/u,
    /BURNER_(?:EVM|BTC|PRIVATE)_KEY/u,
    /KILL_SWITCH_PATH/u,
    /DEV_LOCK_PATH/u,
    /autoExecute\s*=/u,
    /baseRatio\s*=/u,
  ]) {
    assert.equal(pattern.test(moduleText), false, `forbidden pattern ${pattern}`);
  }
});
