import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIndirectStablecoinLaneInventory,
  summarizeIndirectStablecoinLaneInventory,
} from "../src/strategy/indirect-stablecoin-lane-inventory.mjs";

test("inventory covers all 7 gateway-relevant chains", () => {
  const inventory = buildIndirectStablecoinLaneInventory();
  const chains = inventory.chains.map((c) => c.chain).sort();
  assert.deepEqual(chains, ["avalanche", "base", "bera", "bsc", "soneium", "sonic", "unichain"]);
  assert.equal(inventory.summary.chainCount, 7);
});

test("base and bsc have direct stable review_only (evidence stale), not blocked", () => {
  const inventory = buildIndirectStablecoinLaneInventory();
  for (const chain of ["base", "bsc"]) {
    const c = inventory.chains.find((c) => c.chain === chain);
    assert.ok(c, `${chain} must be in inventory`);
    assert.equal(c.directStableGatewayArrival.status, "review_only", `${chain} direct stable should be review_only`);
    assert.equal(c.directStableGatewayArrival.blockers.includes("evidence_stale"), true);
    assert.equal(c.primaryStableLane, "direct");
    assert.equal(c.stableAccessible, true);
  }
  assert.equal(inventory.summary.directStableChains.includes("base"), true);
  assert.equal(inventory.summary.directStableChains.includes("bsc"), true);
});

test("priority expansion chains have blocked direct stable but review_only indirect via wrapped BTC", () => {
  const inventory = buildIndirectStablecoinLaneInventory();
  for (const chain of ["avalanche", "sonic", "bera", "unichain", "soneium"]) {
    const c = inventory.chains.find((c) => c.chain === chain);
    assert.ok(c, `${chain} must be in inventory`);
    assert.equal(c.directStableGatewayArrival.status, "blocked", `${chain} direct stable should be blocked`);
    assert.equal(
      c.directStableGatewayArrival.blockers.includes("no_stablecoin_gateway_arrival_route"),
      true,
      `${chain} must have no_stablecoin_gateway_arrival_route blocker`,
    );
    assert.equal(c.indirectStableViaWrappedBtc.status, "review_only", `${chain} indirect stable should be review_only`);
    assert.equal(c.indirectStableViaWrappedBtc.blockers.some((blocker) => blocker.startsWith("wrapped_btc_to_stable_dex_swap")), true);
    assert.equal(c.primaryStableLane, "indirect_via_wrapped_btc");
    assert.equal(c.stableAccessible, true);
  }
  assert.deepEqual(
    inventory.summary.indirectStableReviewChains.sort(),
    ["avalanche", "bera", "soneium", "sonic", "unichain"],
  );
});

test("avalanche, sonic, and unichain have quote-only DEX proof while bera/soneium need router integration", () => {
  const inventory = buildIndirectStablecoinLaneInventory();

  for (const chain of ["avalanche", "sonic", "unichain"]) {
    const c = inventory.chains.find((c) => c.chain === chain);
    assert.equal(c.indirectStableViaWrappedBtc.dexConversionProof, "quote_only_untrusted");
    assert.equal(c.indirectStableViaWrappedBtc.latestDexQuoteTrust, "quote_only_untrusted");
    assert.equal(c.indirectStableViaWrappedBtc.arrivalProof, "live_delivery");
  }

  for (const chain of ["bera", "soneium"]) {
    const c = inventory.chains.find((c) => c.chain === chain);
    assert.equal(c.indirectStableViaWrappedBtc.dexConversionProof, "not_proven");
    assert.equal(c.indirectStableViaWrappedBtc.routerSupport, "repo_safe_router_missing");
    assert.equal(c.indirectStableViaWrappedBtc.arrivalProof, "live_delivery");
  }
});

test("all 5 priority chains have identified DEX venue and nextAction", () => {
  const inventory = buildIndirectStablecoinLaneInventory();
  const expectedVenues = {
    avalanche: "odos",
    sonic: "shadow_or_odos",
    bera: "kodiak",
    unichain: "catex",
    soneium: "kyo",
  };
  for (const [chain, venue] of Object.entries(expectedVenues)) {
    const c = inventory.chains.find((c) => c.chain === chain);
    assert.equal(c.indirectStableViaWrappedBtc.dexVenue, venue, `${chain} DEX venue mismatch`);
    assert.ok(c.indirectStableViaWrappedBtc.nextAction, `${chain} must have nextAction`);
  }
  assert.equal(inventory.summary.indirectLanesWithDexVenue.length, 5);
});

test("summarize returns correct counts and chain lists", () => {
  const inventory = buildIndirectStablecoinLaneInventory();
  const summary = summarizeIndirectStablecoinLaneInventory(inventory);
  assert.deepEqual(summary.directStableChains.sort(), ["base", "bsc"]);
  assert.deepEqual(summary.indirectStableReviewChains.sort(), ["avalanche", "bera", "soneium", "sonic", "unichain"]);
  assert.deepEqual(summary.indirectQuoteOnlyChains.sort(), ["avalanche", "sonic", "unichain"]);
  assert.deepEqual(summary.indirectRouterMissingChains.sort(), ["bera", "soneium"]);
  assert.equal(summary.fullyBlockedStableChains.length, 0);
  assert.equal(summary.indirectLanesWithDexVenue.length, 5);
  assert.equal(summary.chainCount, 7);
});

test("summarize returns null when inventory is null", () => {
  assert.equal(summarizeIndirectStablecoinLaneInventory(null), null);
});
