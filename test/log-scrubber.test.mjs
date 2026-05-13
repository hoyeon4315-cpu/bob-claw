import assert from "node:assert/strict";
import test from "node:test";

import { redactLogValue, sanitizeLogRecord } from "../src/lib/log-scrubber.mjs";

const EXAMPLE_TEST_ONLY_PRIVATE_KEY = `0x${"a".repeat(64)}`;
const EXAMPLE_TEST_ONLY_BEARER = `Bearer ${"testonly".repeat(12)}`;
const EXAMPLE_TEST_ONLY_WIF = `K${"TestOnlyNoFunds".repeat(4)}`;
const EXAMPLE_TEST_ONLY_SIGNED_TX = `0x02${"f".repeat(180)}`;
const EXAMPLE_TEST_ONLY_KEY_PATH = "/Users/test-only/.bob-claw/keys/burner-evm.key";

test("sanitizeLogRecord redacts fake sensitive fields while preserving operational context", () => {
  const input = {
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    policyVerdict: "approved",
    txHash: `0x${"1".repeat(64)}`,
    token: "USDC",
    signer: {
      privateKey: EXAMPLE_TEST_ONLY_PRIVATE_KEY,
      wif: EXAMPLE_TEST_ONLY_WIF,
      keyPath: EXAMPLE_TEST_ONLY_KEY_PATH,
    },
    headers: {
      authorization: EXAMPLE_TEST_ONLY_BEARER,
    },
    signed: {
      signedTx: EXAMPLE_TEST_ONLY_SIGNED_TX,
    },
    env: {
      OPENAI_API_KEY: "sk-test-only-not-real-example-value",
      BOB_CLAW_SAFE_MODE: "true",
    },
  };

  const output = sanitizeLogRecord(input);
  const serialized = JSON.stringify(output);

  assert.equal(output.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(output.chain, "base");
  assert.equal(output.policyVerdict, "approved");
  assert.equal(output.txHash, `0x${"1".repeat(64)}`);
  assert.equal(output.token, "USDC");
  assert.equal(output.env.BOB_CLAW_SAFE_MODE, "true");

  assert.equal(output.signer.privateKey, "[REDACTED:private_key]");
  assert.equal(output.signer.wif, "[REDACTED:private_key]");
  assert.equal(output.signer.keyPath, "[REDACTED:key_path]");
  assert.equal(output.headers.authorization, "[REDACTED:secret]");
  assert.equal(output.signed.signedTx, "[REDACTED:signed_tx]");
  assert.equal(output.env.OPENAI_API_KEY, "[REDACTED:secret]");

  assert.equal(serialized.includes(EXAMPLE_TEST_ONLY_PRIVATE_KEY), false);
  assert.equal(serialized.includes(EXAMPLE_TEST_ONLY_BEARER), false);
  assert.equal(serialized.includes(EXAMPLE_TEST_ONLY_WIF), false);
  assert.equal(serialized.includes(EXAMPLE_TEST_ONLY_SIGNED_TX), false);
  assert.equal(serialized.includes(EXAMPLE_TEST_ONLY_KEY_PATH), false);
});

test("redactLogValue handles strings, arrays, and circular objects without crashing", () => {
  const circular = { ok: true };
  circular.self = circular;

  const output = redactLogValue([
    "safe status line",
    `seed phrase: test only abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`,
    circular,
  ]);

  assert.equal(output[0], "safe status line");
  assert.match(output[1], /\[REDACTED:seed_phrase\]/);
  assert.equal(output[2].ok, true);
  assert.equal(output[2].self, "[Circular]");
});
