#!/usr/bin/env node

import { config, getChainRpcUrls } from "../config/env.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { getGasSnapshot, gasUsdFromSnapshot } from "../gas/rpc-gas.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    chains: options.chains
      ? options.chains.split(",").map((item) => item.trim()).filter(Boolean)
      : [],
  };
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 4 : 6)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new JsonlStore(config.dataDir);
  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const selectedChains = args.chains.length > 0 ? args.chains : Object.keys(EVM_CHAINS).sort();
  const unknownChains = selectedChains.filter((chain) => !EVM_CHAINS[chain]);
  if (unknownChains.length > 0) {
    throw new Error(`Unknown gas snapshot chains: ${unknownChains.join(",")}`);
  }

  for (const chain of selectedChains) {
    try {
      const chainConfig = {
        ...EVM_CHAINS[chain],
        rpcUrls: getChainRpcUrls(chain, EVM_CHAINS[chain].rpcUrls || [EVM_CHAINS[chain].rpcUrl]),
      };
      const snapshot = await getGasSnapshot(chain, chainConfig);
      const nativeUsd = prices.nativeByChain[chain];
      const fallbackTxUsd = gasUsdFromSnapshot(snapshot, nativeUsd);
      const record = { schemaVersion: SCHEMA_VERSION, runId, ...snapshot, nativeUsd, fallbackTxUsd };
      await store.append("gas-snapshots", record);
      console.log(
        [
          chain,
          `gasPriceWei=${snapshot.gasPriceWei}`,
          `block=${snapshot.blockNumber}`,
          `latency=${snapshot.latencyMs}ms`,
          `fallbacks=${snapshot.rpcFallbacksTried}`,
          `fallbackGasUnits=${snapshot.fallbackGasUnits}`,
          `fallbackTx=${formatUsd(fallbackTxUsd)}`,
        ].join(" "),
      );
    } catch (error) {
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        chain,
        ok: false,
        error: { name: error.name, message: error.message, attempts: error.attempts || null },
      };
      await store.append("gas-snapshot-failures", failure);
      console.log(`${chain} failed: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
