#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import {
  stabilizeWrappedBtcLoopLiveProof,
  WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE,
} from "../strategy/wrapped-btc-loop-live-proof.mjs";

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
    attempts: options.attempts ? Number(options.attempts) : 5,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, runId, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [proof, capitalAuditReport] = await Promise.all([
    readJsonIfExists(join(config.dataDir, WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE)),
    readJsonIfExists(join(config.dataDir, "capital-audit.json")),
  ]);
  const hydratedProof = await stabilizeWrappedBtcLoopLiveProof({
    proof,
    capitalAuditReport,
    attempts: args.attempts,
  });

  let writeResult = null;
  if (args.write && hydratedProof) {
    writeResult = await writeTextIfChanged(
      join(config.dataDir, WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE),
      `${JSON.stringify(hydratedProof, null, 2)}\n`,
      {
        normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
      },
    );
  }

  if (args.json) {
    console.log(JSON.stringify({ hydratedProof, writeResult }, null, 2));
    return;
  }

  console.log(`proofPresent=${hydratedProof ? "yes" : "no"}`);
  console.log(`extendedReceiptContextReady=${hydratedProof?.extendedReceiptContextReady === true ? "yes" : "no"}`);
  console.log(`missingFields=${hydratedProof?.missingExtendedReceiptFields?.join(",") || "none"}`);
  console.log(`attempts=${args.attempts}`);
  if (args.write) {
    console.log(`wrote=${writeResult?.changed === true ? WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE : "unchanged"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
