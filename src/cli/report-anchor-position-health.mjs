#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { fetchRealtimePortfolio } from "../executor/realtime-portfolio.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const tokenIdsArg = argv.find((a) => a.startsWith("--token-ids="));
  return {
    json: flags.has("--json"),
    address: argv.find((a) => a.startsWith("--address="))?.slice("--address=".length) || null,
    tokenIds: tokenIdsArg ? tokenIdsArg.slice("--token-ids=".length).split(",").filter(Boolean).map(Number) : [],
  };
}

export async function collectAnchorPositionHealth({ address, tokenIds = [] } = {}) {
  const walletAddress = address || "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

  const portfolio = await fetchRealtimePortfolio(walletAddress, {
    includeProtocols: true,
    useCache: false,
    aerodromeTokenIds: tokenIds,
  });

  const aerodromePositions = (portfolio.protocolPositions || []).filter((p) => p.protocol === "aerodrome");

  if (aerodromePositions.length === 0) {
    return {
      observedAt: new Date().toISOString(),
      walletAddress,
      status: "no_positions",
      message: "No active Aerodrome CL positions detected.",
      positions: [],
    };
  }

  const positions = aerodromePositions.map((pos) => {
    const currentTick = pos.currentTick ?? null;
    let inRange = "unknown";
    if (currentTick !== null && pos.tickLower !== undefined && pos.tickUpper !== undefined) {
      inRange = currentTick >= pos.tickLower && currentTick <= pos.tickUpper;
    }

    return {
      tokenId: pos.tokenId,
      poolAddress: pos.poolAddress || "unknown",
      token0: pos.token0,
      token1: pos.token1,
      tickLower: pos.tickLower,
      tickUpper: pos.tickUpper,
      currentTick,
      liquidity: pos.liquidity,
      unclaimedFees: {
        token0: pos.tokensOwed0 || "0",
        token1: pos.tokensOwed1 || "0",
      },
      estimatedIlPct: pos.estimatedIlPct ?? "unknown",
      estimatedIlUsd: pos.estimatedIlUsd ?? "unknown",
      timeInRange: pos.timeInRange ?? "unknown",
      inRange,
      exitRoute: "remove liquidity -> swap to USDC via Aerodrome router",
    };
  });

  return {
    observedAt: new Date().toISOString(),
    walletAddress,
    status: "active",
    positionCount: positions.length,
    positions,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await collectAnchorPositionHealth({
    address: args.address,
    tokenIds: args.tokenIds,
  });

  if (args.json) {
    const fs = await import("node:fs");
    await fs.promises.mkdir("data", { recursive: true });
    const outputPath = "data/anchor-position-health.json";
    await fs.promises.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
