import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AERODROME_NFP_ADDRESS,
  clearAerodromeTokenIdCacheForTesting,
  enumerateAerodromeTokenIds,
} from "../src/protocol-readers/readers/aerodrome-nft-enumerator.mjs";

test("aerodrome NFT enumerator reads owned tokenIds from ERC721Enumerable", async () => {
  clearAerodromeTokenIdCacheForTesting();
  const calls = [];
  const tokenIds = await enumerateAerodromeTokenIds({
    chain: "base",
    ownerAddress: "0x0000000000000000000000000000000000000abc",
    nowMs: 1_000,
    _providerFactory: ({ chain, address, abi }) => {
      calls.push({ chain, address, abi });
      return {
        balanceOf: async (owner) => {
          assert.equal(owner, "0x0000000000000000000000000000000000000abc");
          return 3n;
        },
        tokenOfOwnerByIndex: async (owner, index) => {
          assert.equal(owner, "0x0000000000000000000000000000000000000abc");
          return [101n, 202n, 303n][Number(index)];
        },
      };
    },
  });

  assert.deepEqual(tokenIds, ["101", "202", "303"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chain, "base");
  assert.equal(calls[0].address, AERODROME_NFP_ADDRESS);
  assert.equal(calls[0].abi.some((entry) => entry.includes("tokenOfOwnerByIndex")), true);

  const cached = await enumerateAerodromeTokenIds({
    chain: "base",
    ownerAddress: "0x0000000000000000000000000000000000000abc",
    nowMs: 2_000,
    _providerFactory: () => {
      throw new Error("cache_miss");
    },
  });
  assert.deepEqual(cached, ["101", "202", "303"]);
});
