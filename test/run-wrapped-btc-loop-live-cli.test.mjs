import assert from "node:assert/strict";
import test from "node:test";

import { wrappedBtcLoopLiveExitCode } from "../src/cli/run-wrapped-btc-loop-live.mjs";

test("wrapped BTC live CLI returns non-zero when signer execution did not complete", () => {
  assert.equal(wrappedBtcLoopLiveExitCode({ ok: false }), 2);
  assert.equal(wrappedBtcLoopLiveExitCode({ ok: true, blockedReason: "policy_reject" }), 2);
  assert.equal(wrappedBtcLoopLiveExitCode({ ok: true }), 0);
});
