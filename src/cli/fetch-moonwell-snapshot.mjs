#!/usr/bin/env node

/**
 * fetch-moonwell-snapshot.mjs
 *
 * Thin async fetcher: reads Moonwell market state via public Base RPC
 * (or any operator-provided RPC), decodes it, normalizes through
 * normalizeMoonwellSnapshot(), and writes the frozen snapshot to disk.
 *
 *   node src/cli/fetch-moonwell-snapshot.mjs \
 *     --rpc=https://mainnet.base.org \
 *     --chain-id=8453 \
 *     --market=0x...        # mToken address
 *     --asset=cbBTC \
 *     --comptroller=0x... \
 *     [--account=0x...]     # for HF/position; omitted → HF=null (allowed)
 *     [--blocks-per-year=15768000] \
 *     [--out=data/snapshots/moonwell-<asset>-<chain>-<ts>.json] \
 *     [--json] [--quiet]
 *
 * Exit code 0 always (incl. partial). RPC failure → exit 2 (no snapshot
 * written). Operator decides what to do with `partial: true`.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { JsonRpcProvider, Contract, Interface } from "ethers";
import { normalizeMoonwellSnapshot } from "../strategy/snapshots/moonwell-snapshot.mjs";

const FETCH_TIMEOUT_MS = 20_000;

const MTOKEN_ABI = [
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function balanceOfUnderlying(address) view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
];

const COMPTROLLER_ABI = [
  "function markets(address) view returns (bool isListed,uint256 collateralFactorMantissa,bool isComped)",
];

function parseArgs(argv) {
  const out = { json: false, quiet: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--quiet") { out.quiet = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label}: timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.rpc) {
    console.error("ERR: --rpc=<url> required");
    process.exit(2);
  }
  if (!args.market || !args.comptroller || !args.asset || !args["chain-id"]) {
    console.error("ERR: --market, --comptroller, --asset, --chain-id all required");
    process.exit(2);
  }

  const provider = new JsonRpcProvider(args.rpc, Number(args["chain-id"]), {
    staticNetwork: true,
  });
  const mToken = new Contract(args.market, MTOKEN_ABI, provider);
  const comptroller = new Contract(args.comptroller, COMPTROLLER_ABI, provider);

  const callWithCatch = async (fn, label) => {
    try {
      return { value: await withTimeout(fn(), FETCH_TIMEOUT_MS, label) };
    } catch (err) {
      return { error: `${label}: ${err.shortMessage || err.message}` };
    }
  };

  const [
    supplyRateR, borrowRateR, cashR, totalBorrowsR, totalReservesR, exchangeRateR, marketTupleR,
  ] = await Promise.all([
    callWithCatch(() => mToken.supplyRatePerBlock(), "supplyRatePerBlock"),
    callWithCatch(() => mToken.borrowRatePerBlock(), "borrowRatePerBlock"),
    callWithCatch(() => mToken.getCash(), "getCash"),
    callWithCatch(() => mToken.totalBorrows(), "totalBorrows"),
    callWithCatch(() => mToken.totalReserves(), "totalReserves"),
    callWithCatch(() => mToken.exchangeRateStored(), "exchangeRateStored"),
    callWithCatch(() => comptroller.markets(args.market), "comptroller.markets"),
  ]);

  const callErrors = [supplyRateR, borrowRateR, cashR, totalBorrowsR, totalReservesR, exchangeRateR, marketTupleR]
    .filter((r) => r.error)
    .map((r) => r.error);

  // Pass undefined for failed calls so the normalizer records them in
  // `missing[]` instead of treating them as 0.
  const supplyRate = supplyRateR.value;
  const borrowRate = borrowRateR.value;
  const cash = cashR.value;
  const totalBorrows = totalBorrowsR.value;
  const totalReserves = totalReservesR.value;
  const exchangeRate = exchangeRateR.value;
  const marketTuple = marketTupleR.value;

  let position = null;
  if (args.account) {
    try {
      const [collateralUnderlying, borrowBalance] = await withTimeout(
        Promise.all([
          mToken.balanceOfUnderlying.staticCall(args.account),
          mToken.borrowBalanceStored(args.account),
        ]),
        FETCH_TIMEOUT_MS,
        "moonwell account rpc",
      );
      // Caller does not pass per-asset USD price here; downstream
      // adapter is responsible for USD conversion. We pass through raw
      // underlying units so the normalizer's HF stays null until USD
      // priced. If the operator wants HF computed inline they can
      // supply --collateral-usd / --borrow-usd as overrides.
      position = {
        collateralUnderlyingRaw: collateralUnderlying.toString(),
        borrowUnderlyingRaw: borrowBalance.toString(),
        // explicit USD must be passed in by adapter; leaving null forces
        // the HF guard to block until properly priced.
        collateralUsd: args["collateral-usd"] !== undefined ? Number(args["collateral-usd"]) : null,
        borrowUsd: args["borrow-usd"] !== undefined ? Number(args["borrow-usd"]) : null,
      };
    } catch (err) {
      console.error(`WARN: account read failed (${err.message}); proceeding without position`);
    }
  }

  const snapshot = normalizeMoonwellSnapshot({
    market: {
      address: args.market,
      asset: args.asset,
      chainId: Number(args["chain-id"]),
      blocksPerYear: Number(args["blocks-per-year"] || 15_768_000),
    },
    comptroller: { address: args.comptroller },
    position,
    rates: {
      supplyRatePerBlockMantissa: supplyRate !== undefined ? Number(supplyRate) : undefined,
      borrowRatePerBlockMantissa: borrowRate !== undefined ? Number(borrowRate) : undefined,
    },
    reserves: cash !== undefined && totalBorrows !== undefined && totalReserves !== undefined ? {
      cashRaw: Number(cash),
      totalBorrowsRaw: Number(totalBorrows),
      totalReservesRaw: Number(totalReserves),
      exchangeRateMantissa: exchangeRate !== undefined ? Number(exchangeRate) : undefined,
    } : null,
    comptrollerMarket: marketTuple !== undefined ? {
      isListed: marketTuple[0],
      collateralFactorMantissa: Number(marketTuple[1]),
    } : null,
    fetchedAtMs: Date.now(),
  });

  // Surface call errors alongside the snapshot for operator visibility.
  if (callErrors.length > 0 && !args.quiet) {
    console.error(`WARN: ${callErrors.length} RPC call(s) failed:`);
    for (const e of callErrors) console.error(`  - ${e}`);
  }

  const out = args.out || resolve(
    "data/snapshots",
    `moonwell-${args.asset}-${args["chain-id"]}-${snapshot.fetchedAtMs}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2));

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify({ outPath: out, snapshot }));
    } else {
      console.log(`moonwell snapshot written: ${out}`);
      console.log(`  partial=${snapshot.partial} missing=${snapshot.missing.join(",") || "(none)"}`);
      console.log(`  utilizationBps=${snapshot.utilizationBps} supplyApyBps=${snapshot.supplyApyBps} borrowApyBps=${snapshot.borrowApyBps}`);
      console.log(`  collateralFactorBps=${snapshot.collateralFactorBps} HF=${snapshot.healthFactor}`);
    }
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
