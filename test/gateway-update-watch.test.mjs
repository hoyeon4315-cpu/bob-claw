import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRouteSnapshot,
  diffProbeHealth,
  diffSchema,
  diffSchemaShapes,
  diffSnapshots,
} from "../src/watch/gateway-update-watch.mjs";

const BTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("route diff detects added and removed routes", () => {
  const oldRoutes = [
    { srcChain: "bob", dstChain: "base", srcToken: BTC, dstToken: BTC },
    { srcChain: "base", dstChain: "bob", srcToken: BTC, dstToken: BTC },
  ];
  const newRoutes = [
    { srcChain: "bob", dstChain: "base", srcToken: BTC, dstToken: BTC },
    { srcChain: "bob", dstChain: "sonic", srcToken: BTC, dstToken: BTC },
  ];

  const diff = diffSnapshots(buildRouteSnapshot(oldRoutes), buildRouteSnapshot(newRoutes));

  assert.equal(diff.changed, true);
  assert.equal(diff.addedRoutes.length, 1);
  assert.equal(diff.removedRoutes.length, 1);
  assert.equal(diff.addedChains.includes("sonic"), true);
});

test("route diff stays quiet for identical snapshots", () => {
  const routes = [
    { srcChain: "bob", dstChain: "base", srcToken: BTC, dstToken: BTC },
    { srcChain: "base", dstChain: "bob", srcToken: BTC, dstToken: BTC },
  ];

  const snapshot = buildRouteSnapshot(routes);
  const diff = diffSnapshots(snapshot, snapshot);

  assert.equal(diff.changed, false);
  assert.deepEqual(diff.addedRoutes, []);
  assert.deepEqual(diff.removedRoutes, []);
});

test("schema diff detects quote shape changes", () => {
  const diff = diffSchema("old-schema-hash", "new-schema-hash");

  assert.equal(diff.changed, true);
  assert.equal(diff.previousSchemaHash, "old-schema-hash");
  assert.equal(diff.currentSchemaHash, "new-schema-hash");
});

test("schema diff stays quiet for identical quote shapes", () => {
  const diff = diffSchema("same-schema-hash", "same-schema-hash");

  assert.equal(diff.changed, false);
});

test("schema shape diff ignores transient probe health changes", () => {
  const previousShapes = [
    { routeKey: "bob->base", shape: { type: "layerZero", quoteKeys: ["tx"] } },
    { routeKey: "bob->bitcoin", shape: { type: "offramp", quoteKeys: ["signedQuoteData"] } },
  ];
  const currentShapes = [{ routeKey: "bob->base", shape: { quoteKeys: ["tx"], type: "layerZero" } }];

  const diff = diffSchemaShapes(previousShapes, currentShapes, "old", "new");

  assert.equal(diff.changed, false);
  assert.deepEqual(diff.sharedRouteKeys, ["bob->base"]);
});

test("probe health diff detects quote probe failures separately", () => {
  const diff = diffProbeHealth("all-ok", "one-failed");

  assert.equal(diff.changed, true);
  assert.equal(diff.previousProbeHealthHash, "all-ok");
  assert.equal(diff.currentProbeHealthHash, "one-failed");
});
