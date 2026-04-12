#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildShadowRefreshQueue } from "../session/shadow-refresh-queue.mjs";

function parseArgs(argv) {
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
    limit: options.limit ? Number(options.limit) : 8,
  };
}

async function loadShadowCycle(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing shadow cycle snapshot at ${path}. Run npm run run:shadow-cycle -- --write first.`);
    }
    throw error;
  }
}

function buildRefreshPlan(shadowCycle, { limit = 8 } = {}) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 8;
  const items = buildShadowRefreshQueue({ shadowCycle, limit: safeLimit });
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    shadowCycleObservedAt: shadowCycle?.observedAt || null,
    itemCount: items.length,
    items,
  };
}

function stripVolatile(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return plan;
  const { observedAt, ...stable } = plan;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shadowCyclePath = join(config.dataDir, "shadow-cycle-latest.json");
  const shadowCycle = await loadShadowCycle(shadowCyclePath);
  const plan = buildRefreshPlan(shadowCycle, { limit: args.limit });

  if (args.write) {
    const outputPath = join(config.dataDir, "shadow-refresh-plan.json");
    const result = await writeTextIfChanged(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
    console.log(`${result.changed ? "wrote" : "unchanged"}=${result.path}`);
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`shadowCycleObservedAt=${plan.shadowCycleObservedAt || "n/a"}`);
  console.log(`queueCount=${plan.itemCount}`);
  for (const item of plan.items) {
    console.log(
      [
        `rank=${item.rank}`,
        `priority=${item.priority}`,
        `scope=${item.scope || "unknown"}`,
        `code=${item.code || "unknown"}`,
        `reason=${item.reason || "unknown"}`,
        item.routeLabel ? `route=${item.routeLabel}` : null,
        item.amount ? `amount=${item.amount}` : null,
        item.proxyGroup ? `proxyGroup=${item.proxyGroup}` : null,
        item.chains?.length ? `chains=${item.chains.join(",")}` : null,
        item.command ? `command=${item.command}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
