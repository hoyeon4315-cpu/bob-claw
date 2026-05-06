#!/usr/bin/env node

import process from "node:process";
import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { merklUserRewardPolicy } from "../config/merkl-user-rewards.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  buildMerklUserRewardsSlice,
  buildMerklUserRewardsUrl,
  normalizeMerklUserRewardsPayload,
} from "../status/merkl-user-rewards-slice.mjs";

function parseCsvIntegers(value) {
  if (!value) return null;
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));
}

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((item) => item.startsWith("--") && !item.includes("=")));
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    address: options.address || null,
    apiBase: options["api-base"] || config.merklApiBase,
    out: options.out || join(config.dataDir, "merkl-user-rewards-latest.json"),
    dataDir: options["data-dir"] || config.dataDir,
    chainIds: parseCsvIntegers(options["chain-ids"]),
    reloadChainId: options["reload-chain-id"] ? Number(options["reload-chain-id"]) : null,
  };
}

async function fetchJson(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Merkl rewards request failed ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function reportMerklUserRewards({
  address = null,
  apiBase = config.merklApiBase,
  dataDir = config.dataDir,
  chainIds = null,
  reloadChainId = null,
  observedAt = new Date().toISOString(),
  fetchImpl = fetch,
  write = false,
  out = null,
} = {}) {
  const policy = merklUserRewardPolicy({
    chainIds: chainIds || undefined,
    reloadChainId: reloadChainId || undefined,
  });
  const resolvedAddress = await resolveOperationalAddress({
    explicitAddress: address,
    dataDir,
  });
  const url = buildMerklUserRewardsUrl({
    apiBase,
    address: resolvedAddress.address,
    chainIds: policy.chainIds,
    reloadChainId: policy.reloadChainId,
  });
  const payload = await fetchJson(url, { fetchImpl });
  const rows = normalizeMerklUserRewardsPayload(payload, { observedAt });
  const slice = buildMerklUserRewardsSlice(rows, {
    generatedAt: observedAt,
    minClaimUsd: policy.minClaimUsd,
    maxClaimCostUsdByChainId: policy.maxClaimCostUsdByChainId,
    distributorsByChainId: policy.distributorsByChainId,
  });
  const report = {
    ...slice,
    address: resolvedAddress.address,
    addressSource: resolvedAddress.source || null,
    url,
    rows,
  };

  if (write) {
    await writeTextIfChanged(resolve(out || join(dataDir, "merkl-user-rewards-latest.json")), `${safeJsonStringify(report, 2)}\n`);
    await new JsonlStore(dataDir).append("merkl-user-rewards-runs", {
      ...slice,
      address: resolvedAddress.address,
    });
  }
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await reportMerklUserRewards(args);
  if (args.json) {
    console.log(safeJsonStringify(report, 2));
  } else {
    const plan = report.claimPlan || {};
    console.log(
      [
        `status=${report.status}`,
        `claimableUsd=${Number(report.totalClaimableUsd || 0).toFixed(6)}`,
        `pendingUsd=${Number(report.totalPendingUsd || 0).toFixed(6)}`,
        `readyChains=${plan.readyChainCount || 0}`,
        `blockedChains=${plan.blockedChainCount || 0}`,
        `out=${args.write ? resolve(args.out) : "(not written)"}`,
      ].join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
