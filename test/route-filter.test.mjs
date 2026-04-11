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
