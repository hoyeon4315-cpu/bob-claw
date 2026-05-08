import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const HOT_PATH_FILES = [
  "src/executor/dispatcher/strategy-catalog-dispatcher.mjs",
  "src/executor/policy/index.mjs",
  "src/executor/signer/daemon.mjs",
  "src/executor/all-chain-autopilot.mjs",
  "src/session/strategy-dispatch-runner.mjs",
];

test("evaluateAutoPromotion is not called from runtime hot paths", async () => {
  for (const file of HOT_PATH_FILES) {
    const source = await readFile(file, "utf8");
    assert.equal(
      /evaluateAutoPromotion\s*\(/u.test(source),
      false,
      `${file} must not call evaluateAutoPromotion at runtime`,
    );
  }
});
