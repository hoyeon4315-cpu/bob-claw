#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildProtocolCodehashBaseline, buildProtocolCodehashWatch } from "../strategy/protocol-codehash-watch.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    writeBaseline: flags.has("--write-baseline"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, items = [], ...stable } = value;
  return JSON.stringify({
    ...stable,
    items: items.map(({ observedAt, blockNumber, ...item }) => item),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselinePath = join(config.dataDir, "protocol-codehash-baseline.json");
  const outputPath = join(config.dataDir, "protocol-codehash-watch.json");
  const baseline = await readJsonIfExists(baselinePath);
  const watch = await buildProtocolCodehashWatch({ baseline });

  if (args.write || args.writeBaseline) {
    await writeTextIfChanged(outputPath, `${JSON.stringify(watch, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return stripVolatile(JSON.parse(contents));
      },
    });
  }

  if (args.writeBaseline) {
    const nextBaseline = buildProtocolCodehashBaseline({ watch });
    await writeTextIfChanged(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return stripVolatile(JSON.parse(contents));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(watch, null, 2));
    return;
  }

  console.log(`targets=${watch.summary?.targetCount ?? 0}`);
  console.log(`status=${watch.summary?.status || "unknown"}`);
  console.log(`drift=${watch.summary?.driftCount ?? 0}`);
  console.log(`missingCode=${watch.summary?.missingCodeCount ?? 0}`);
  console.log(`baselineMissing=${watch.summary?.baselineMissingCount ?? 0}`);
  console.log(`rpcErrors=${watch.summary?.rpcErrorCount ?? 0}`);
  console.log(`nextAction=${watch.summary?.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
