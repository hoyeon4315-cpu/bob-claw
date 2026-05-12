import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalProtocolId,
  protocolsMatch,
} from "../src/config/protocol-id-aliases.mjs";

test("protocol aliases canonicalize known lending protocol ids", () => {
  assert.equal(canonicalProtocolId("Aave V3"), "aave-v3");
  assert.equal(canonicalProtocolId("compound_v3"), "compound-v3");
  assert.equal(canonicalProtocolId("MetaMorpho"), "morpho");
});

test("protocol matching rejects empty or substring-only matches", () => {
  assert.equal(protocolsMatch("", "aave-v3"), false);
  assert.equal(protocolsMatch("compound", "compounder"), false);
  assert.equal(protocolsMatch("aave", "save"), false);
});

test("protocol matching accepts known aliases only after canonicalization", () => {
  assert.equal(protocolsMatch("morpho-blue", "metamorpho"), true);
  assert.equal(protocolsMatch("aave", "aave-v3"), true);
  assert.equal(protocolsMatch("compound", "compound-v3"), true);
});
