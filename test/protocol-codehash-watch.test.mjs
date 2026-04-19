import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProtocolCodehashBaseline,
  buildProtocolCodehashWatch,
  defaultProtocolCodehashTargets,
} from "../src/strategy/protocol-codehash-watch.mjs";

function providerFactory(codesByAddress) {
  return ({ target }) => ({
    getCode: async () => codesByAddress[String(target.address).toLowerCase()] || "0x60016000",
    getBlockNumber: async () => 123,
  });
}

test("protocol codehash watch observes baseline gaps without hard-blocking live gates", async () => {
  const targets = [
    {
      id: "sample_contract",
      label: "Sample contract",
      protocol: "sample",
      chain: "base",
      address: "0x0000000000000000000000000000000000000001",
    },
  ];
  const watch = await buildProtocolCodehashWatch({
    targets,
    providerFactory: providerFactory({}),
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.equal(watch.summary.status, "observe");
  assert.equal(watch.summary.baselineMissingCount, 1);
  assert.equal(watch.summary.nextAction.code, "seed_protocol_codehash_baseline");
  assert.equal(watch.items[0].status, "baseline_missing");
  assert.match(watch.items[0].codehash, /^0x[a-f0-9]{64}$/);
});

test("protocol codehash watch passes against a seeded baseline and blocks drift", async () => {
  const address = "0x0000000000000000000000000000000000000002";
  const targets = [
    {
      id: "sample_contract",
      label: "Sample contract",
      protocol: "sample",
      chain: "base",
      address,
    },
  ];
  const firstWatch = await buildProtocolCodehashWatch({
    targets,
    providerFactory: providerFactory({ [address]: "0x60026000" }),
    now: "2026-04-19T00:00:00.000Z",
  });
  const baseline = buildProtocolCodehashBaseline({ watch: firstWatch, now: "2026-04-19T00:01:00.000Z" });
  const matchedWatch = await buildProtocolCodehashWatch({
    targets,
    baseline,
    providerFactory: providerFactory({ [address]: "0x60026000" }),
    now: "2026-04-19T00:02:00.000Z",
  });
  const driftWatch = await buildProtocolCodehashWatch({
    targets,
    baseline,
    providerFactory: providerFactory({ [address]: "0x60036000" }),
    now: "2026-04-19T00:03:00.000Z",
  });

  assert.equal(matchedWatch.summary.status, "passed");
  assert.equal(matchedWatch.items[0].status, "matched");
  assert.equal(driftWatch.summary.status, "blocked");
  assert.equal(driftWatch.items[0].status, "drift_detected");
  assert.equal(driftWatch.items[0].blockers.includes("protocol_codehash_drift"), true);
});

test("protocol codehash watch blocks missing bytecode and ships default critical targets", async () => {
  const targets = [
    {
      id: "missing_contract",
      label: "Missing contract",
      protocol: "sample",
      chain: "base",
      address: "0x0000000000000000000000000000000000000003",
    },
  ];
  const watch = await buildProtocolCodehashWatch({
    targets,
    providerFactory: providerFactory({ "0x0000000000000000000000000000000000000003": "0x" }),
    now: "2026-04-19T00:00:00.000Z",
  });
  const defaults = defaultProtocolCodehashTargets();

  assert.equal(watch.summary.status, "blocked");
  assert.equal(watch.summary.missingCodeCount, 1);
  assert.equal(defaults.some((item) => item.id === "moonwell_base_comptroller"), true);
  assert.equal(defaults.some((item) => item.id === "gateway_wbtc_oft_base"), true);
});
