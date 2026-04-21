import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeBeefySnapshot } from "../src/strategy/snapshots/beefy-snapshot.mjs";

const VAULT_ID = "moonwell-folded-cbbtc";
const CHAIN_ID = 8453;

function fixture(overrides = {}) {
  return {
    vaults: [{ id: VAULT_ID, status: "active", chain: "base" }],
    apy: { [VAULT_ID]: 0.0612 },
    tvl: { [String(CHAIN_ID)]: { [VAULT_ID]: 4_500_000 } },
    fees: { [VAULT_ID]: { performance: { total: 0.095 } } },
    vaultId: VAULT_ID,
    chainId: CHAIN_ID,
    ...overrides,
  };
}

describe("beefy-snapshot normalizer", () => {
  test("requires vaultId + chainId", () => {
    assert.throws(() => normalizeBeefySnapshot({ chainId: 8453 }));
    assert.throws(() => normalizeBeefySnapshot({ vaultId: "x" }));
  });

  test("happy path: full Beefy data → market subset", () => {
    const r = normalizeBeefySnapshot(fixture());
    assert.equal(r.partial, true);
    assert.deepEqual([...r.missing], []);
    assert.equal(r.market.vaultTvlUsd, 4_500_000);
    assert.equal(r.market.reportedNetApyBps, 612);
    assert.equal(r.market.beefyPerformanceFeeBps, 950);
    assert.equal(r.market.vaultPaused, false);
    assert.equal(r.sourceStatus, "active");
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.market));
  });

  test("paused status → vaultPaused=true", () => {
    const r = normalizeBeefySnapshot(fixture({
      vaults: [{ id: VAULT_ID, status: "paused" }],
    }));
    assert.equal(r.market.vaultPaused, true);
    assert.equal(r.sourceStatus, "paused");
  });

  test("eol status → vaultPaused=true", () => {
    const r = normalizeBeefySnapshot(fixture({
      vaults: [{ id: VAULT_ID, status: "eol" }],
    }));
    assert.equal(r.market.vaultPaused, true);
  });

  test("unknown status → vaultPaused=null + status missing", () => {
    const r = normalizeBeefySnapshot(fixture({
      vaults: [{ id: VAULT_ID, status: "experimental" }],
    }));
    assert.equal(r.market.vaultPaused, null);
    assert.ok(r.missing.includes("vault_status"));
  });

  test("missing vault entry → vault_metadata + vault_status missing", () => {
    const r = normalizeBeefySnapshot(fixture({ vaults: [] }));
    assert.ok(r.missing.includes("vault_metadata"));
    assert.ok(r.missing.includes("vault_status"));
    assert.equal(r.market.vaultPaused, null);
  });

  test("missing apy entry → reportedNetApyBps null + apy missing", () => {
    const r = normalizeBeefySnapshot(fixture({ apy: {} }));
    assert.equal(r.market.reportedNetApyBps, null);
    assert.ok(r.missing.includes("apy"));
  });

  test("apy non-number is treated as missing", () => {
    const r = normalizeBeefySnapshot(fixture({ apy: { [VAULT_ID]: "0.05" } }));
    assert.equal(r.market.reportedNetApyBps, null);
    assert.ok(r.missing.includes("apy"));
  });

  test("missing tvl bucket for chain → tvl missing", () => {
    const r = normalizeBeefySnapshot(fixture({ tvl: {} }));
    assert.equal(r.market.vaultTvlUsd, null);
    assert.ok(r.missing.includes("tvl"));
  });

  test("missing fees → performance_fee missing", () => {
    const r = normalizeBeefySnapshot(fixture({ fees: {} }));
    assert.equal(r.market.beefyPerformanceFeeBps, null);
    assert.ok(r.missing.includes("performance_fee"));
  });

  test("malformed performance fee shape → missing", () => {
    const r = normalizeBeefySnapshot(fixture({
      fees: { [VAULT_ID]: { performance: null } },
    }));
    assert.ok(r.missing.includes("performance_fee"));
  });

  test("decimal-to-bps conversion edge cases", () => {
    const r = normalizeBeefySnapshot(fixture({
      apy: { [VAULT_ID]: 0.0001 },          // 1 bps
      fees: { [VAULT_ID]: { performance: { total: 0.1 } } }, // 1000 bps
    }));
    assert.equal(r.market.reportedNetApyBps, 1);
    assert.equal(r.market.beefyPerformanceFeeBps, 1000);
  });

  test("frozen output and missing list", () => {
    const r = normalizeBeefySnapshot(fixture());
    assert.ok(Object.isFrozen(r.missing));
    assert.throws(() => { r.market.vaultPaused = true; });
  });
});
