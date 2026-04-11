import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesRouteSelection } from "../src/estimator/route-filter.mjs";

test("route filter matches exact route key and amount when provided", () => {
  const record = { routeKey: "bob:token->base:token", amount: "10000" };
  assert.equal(matchesRouteSelection(record, { routeKey: "bob:token->base:token", amount: "10000" }), true);
  assert.equal(matchesRouteSelection(record, { routeKey: "bob:token->base:token", amount: "25000" }), false);
  assert.equal(matchesRouteSelection(record, { routeKey: "bob:token->ethereum:token" }), false);
});

test("route filter allows all records when no filter is provided", () => {
  assert.equal(matchesRouteSelection({ routeKey: "x", amount: "1" }, {}), true);
});

test("route filter matches destination chain selection when provided", () => {
  const record = { routeKey: "bob:token->base:token", amount: "10000", route: { dstChain: "base" } };
  assert.equal(matchesRouteSelection(record, { dstChains: ["base", "ethereum"] }), true);
  assert.equal(matchesRouteSelection(record, { dstChains: ["ethereum"] }), false);
});

test("route filter matches source or destination touch-chain selection when provided", () => {
  const record = { routeKey: "bob:token->base:token", amount: "10000", route: { srcChain: "bob", dstChain: "base" } };
  assert.equal(matchesRouteSelection(record, { touchChains: ["base", "ethereum"] }), true);
  assert.equal(matchesRouteSelection(record, { touchChains: ["bob"] }), true);
  assert.equal(matchesRouteSelection(record, { touchChains: ["ethereum"] }), false);
});
