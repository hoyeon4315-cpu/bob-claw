#!/usr/bin/env node

import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { buildLeverageAutoUnwindRuntime } from "../defi/leverage-auto-unwind-runtime.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    strategy: options.strategy || "wrapped-btc-loop-base-moonwell",
    healthFactor: finiteOrNull(options["health-factor"]),
    liquidationBufferPct: finiteOrNull(options["liquidation-buffer-pct"]),
    oracleDriftPct: finiteOrNull(options["oracle-drift-pct"]),
    unwindGasUsd: finiteOrNull(options["unwind-gas-usd"]),
  };
}

export function resolveLeverageAutoUnwindRuntimePaths(strategyId) {
  if (strategyId === "wrapped-btc-loop-base-moonwell") {
    return {
      scaffoldPath: "wrapped-btc-lending-loop-slice.json",
      latestPath: `${strategyId}-auto-unwind-runtime-latest.json`,
    };
  }
  return {
    scaffoldPath: `${strategyId}-scaffold.json`,
    latestPath: `${strategyId}-auto-unwind-runtime-latest.json`,
  };
}

export async function loadLeverageScaffold(strategyId, { readJsonImpl = readJsonIfExists } = {}) {
  const paths = resolveLeverageAutoUnwindRuntimePaths(strategyId);
  const scaffold = await readJsonImpl(join(config.dataDir, paths.scaffoldPath));
  if (!scaffold?.strategy?.id) {
    throw new Error(`Missing leverage scaffold for strategy: ${strategyId}`);
  }
  return {
    scaffold,
    paths,
  };
}

export async function buildLeverageAutoUnwindRuntimeReport(args, { readJsonImpl = readJsonIfExists } = {}) {
  const { scaffold, paths } = await loadLeverageScaffold(args.strategy, { readJsonImpl });
  const report = buildLeverageAutoUnwindRuntime({
    scaffold,
    observedPosition: {
      currentHealthFactor: args.healthFactor,
      currentLiquidationBufferPct: args.liquidationBufferPct,
    },
    observedMarket: {
      oracleDriftPct: args.oracleDriftPct,
      unwindGasUsd: args.unwindGasUsd,
    },
  });
  return {
    report,
    paths,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { report, paths } = await buildLeverageAutoUnwindRuntimeReport(args);

  if (args.write) {
    const latestPath = join(config.dataDir, paths.latestPath);
    await writeTextIfChanged(latestPath, `${JSON.stringify(report, null, 2)}\n`);
    if ((report.watcherDecision?.triggers || []).length > 0) {
      const store = new JsonlStore(config.dataDir);
      await store.append("risk-events", report.riskEvent);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`strategy=${report.strategy?.id || "n/a"}`);
  console.log(`status=${report.runtime?.status || "unknown"} severity=${report.runtime?.severity || "n/a"}`);
  console.log(`triggers=${(report.watcherDecision?.triggers || []).join(",") || "none"}`);
  console.log(`unwindStatus=${report.emergencyUnwindExecution?.status || "n/a"}`);
  console.log(`unwindActions=${report.emergencyUnwindExecution?.actions?.length ?? 0}`);
  console.log(`nextAction=${report.nextAction?.code || "n/a"}`);
}

const entrypointHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : null;
if (entrypointHref && import.meta.url === entrypointHref) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
