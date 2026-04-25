import assert from "node:assert/strict";
import { test } from "node:test";
import { requiresAllowanceForQuote } from "../src/estimator/wallet-readiness.mjs";

test("LayerZero OFT self-send quote does not require allowance", () => {
  assert.equal(
    requiresAllowanceForQuote({
      route: { srcToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
      txTo: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
      txData: "0xc7c7f5b300000000",
    }),
    false,
  );
});

test("non-self quote still requires allowance", () => {
  assert.equal(
    requiresAllowanceForQuote({
      route: { srcToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
      txTo: "0xc87de04e2ec1f4282dff2933a2d58199f688fc3d",
      txData: "0x095ea7b300000000",
    }),
    true,
  );
});
