import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  NFT_POSITION_CACHE_TTL_MS,
  indexNftPositions,
} from "../src/treasury/nft-position-indexer.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "nft-position-indexer-"));
}

test("indexNftPositions uses a 30 minute cache TTL", async () => {
  const dir = tmp();
  try {
    const cachePath = join(dir, "nft.json");
    let calls = 0;
    const indexerFn = async () => {
      calls += 1;
      return [];
    };

    await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:00:00.000Z"),
      currentEthBtcRatio: 0.05,
      indexerFn,
    });
    const cached = await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:29:00.000Z"),
      currentEthBtcRatio: 0.0505,
      indexerFn,
    });
    const refreshed = await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:31:00.000Z"),
      currentEthBtcRatio: 0.0505,
      indexerFn,
    });

    assert.equal(NFT_POSITION_CACHE_TTL_MS, 30 * 60 * 1000);
    assert.equal(cached.fromCache, true);
    assert.equal(refreshed.fromCache, false);
    assert.deepEqual(refreshed.cacheInvalidationReasons, ["cache_ttl_expired"]);
    assert.equal(calls, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("indexNftPositions invalidates cache on ETH/BTC price move, rebalance, or kill-switch toggle", async () => {
  const dir = tmp();
  try {
    const cachePath = join(dir, "nft.json");
    let calls = 0;
    const indexerFn = async () => {
      calls += 1;
      return [];
    };

    await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:00:00.000Z"),
      currentEthBtcRatio: 0.05,
      indexerFn,
    });

    const priceMove = await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:05:00.000Z"),
      currentEthBtcRatio: 0.052,
      indexerFn,
    });
    assert.equal(priceMove.fromCache, false);
    assert.deepEqual(priceMove.cacheInvalidationReasons, ["eth_btc_price_move"]);

    const rebalance = await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:10:00.000Z"),
      currentEthBtcRatio: 0.052,
      rebalanceEvent: { id: "rebalance-1", observedAt: "2026-05-08T00:09:00.000Z" },
      indexerFn,
    });
    assert.equal(rebalance.fromCache, false);
    assert.deepEqual(rebalance.cacheInvalidationReasons, ["explicit_rebalance_event"]);

    const killSwitch = await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { aerodromeCl: "0xPM" } },
      cachePath,
      now: new Date("2026-05-08T00:15:00.000Z"),
      currentEthBtcRatio: 0.052,
      killSwitchToggledAt: "2026-05-08T00:14:00.000Z",
      indexerFn,
    });
    assert.equal(killSwitch.fromCache, false);
    assert.deepEqual(killSwitch.cacheInvalidationReasons, ["kill_switch_toggled"]);
    assert.equal(calls, 4);
    assert.equal(existsSync(cachePath), true);
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    assert.equal(cache.perWallet["0xW"].cacheMetadata.lastKillSwitchToggledAt, "2026-05-08T00:14:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
