#!/usr/bin/env node

import { EVM_CHAINS } from "../chains/registry.mjs";
import { config, getChainRpcUrls } from "../config/env.mjs";
import { classifyGasEstimateError, estimateGas, gasUsdFromSnapshot, getGasSnapshot } from "../gas/rpc-gas.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { matchesRouteSelection } from "../estimator/route-filter.mjs";

const SCHEMA_VERSION = 1;

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
    routeLimit: options["route-limit"] ? Number(options["route-limit"]) : 12,
    from: options.from || config.estimateFrom,
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
  };
}

function latestByRouteAndAmount(quotes) {
  const latest = new Map();
  for (const quote of quotes) {
    if (!quote.routeKey || !quote.amount) continue;
    const key = `${quote.routeKey}|${quote.amount}`;
    const existing = latest.get(key);
    if (!existing || new Date(quote.observedAt) > new Date(existing.observedAt)) {
      latest.set(key, quote);
    }
  }
  return [...latest.values()];
}

function chainConfig(chain) {
  return {
    ...EVM_CHAINS[chain],
    rpcUrls: getChainRpcUrls(chain, EVM_CHAINS[chain].rpcUrls || [EVM_CHAINS[chain].rpcUrl]),
  };
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 4 : 6)}`;
}

function skipReason(quote) {
  if (quote.route.srcChain === "bitcoin") return "bitcoin_source_no_evm_tx";
  if (!EVM_CHAINS[quote.route.srcChain]) return "unsupported_source_chain";
  if (!quote.txTo) return "missing_tx_to";
  if (!quote.txData) return "missing_tx_data";
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new JsonlStore(config.dataDir);
  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const quotes = latestByRouteAndAmount(await readJsonl(config.dataDir, "gateway-quotes"));
  const selectedQuotes = quotes
    .filter((quote) => quote.route?.srcChain !== "bitcoin")
    .filter((quote) => matchesRouteSelection(quote, args))
    .slice(0, Number.isFinite(args.routeLimit) && args.routeLimit > 0 ? args.routeLimit : quotes.length);
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const gasSnapshots = new Map();
  const results = [];

  async function snapshotFor(chain) {
    if (!gasSnapshots.has(chain)) {
      gasSnapshots.set(chain, getGasSnapshot(chain, chainConfig(chain)));
    }
    return gasSnapshots.get(chain);
  }

  for (const quote of selectedQuotes) {
    const reason = skipReason(quote);
    if (reason) {
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        routeKey: quote.routeKey,
        amount: quote.amount,
        srcChain: quote.route.srcChain,
        dstChain: quote.route.dstChain,
        reason,
      };
      await store.append("gateway-gas-estimate-failures", failure);
      results.push({ ok: false, ...failure });
      if (!args.json) console.log(`${quote.route.srcChain}->${quote.route.dstChain} skipped reason=${reason}`);
      continue;
    }

    try {
      const [estimate, snapshot] = await Promise.all([
        estimateGas(
          quote.route.srcChain,
          {
            from: args.from,
            to: quote.txTo,
            data: quote.txData,
            valueWei: quote.txValueWei || "0",
          },
          chainConfig(quote.route.srcChain),
        ),
        snapshotFor(quote.route.srcChain),
      ]);
      const nativeUsd = prices.nativeByChain[quote.route.srcChain];
      const estimatedGasUsd = gasUsdFromSnapshot(snapshot, nativeUsd, estimate.gasUnits);
      const record = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        ...estimate,
        routeKey: quote.routeKey,
        amount: quote.amount,
        srcChain: quote.route.srcChain,
        dstChain: quote.route.dstChain,
        txTo: quote.txTo,
        txValueWei: quote.txValueWei,
        txDataBytes: quote.txDataBytes,
        from: args.from,
        gasPriceWei: snapshot.gasPriceWei,
        nativeUsd,
        estimatedGasUsd,
        source: "eth_estimateGas",
      };
      await store.append("gateway-gas-estimates", record);
      results.push({ ok: true, ...record });
      if (!args.json) {
        console.log(
          `${quote.route.srcChain}->${quote.route.dstChain} gasUnits=${record.gasUnits} gas=${formatUsd(record.estimatedGasUsd)} latency=${record.latencyMs}ms`,
        );
      }
    } catch (error) {
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        routeKey: quote.routeKey,
        amount: quote.amount,
        srcChain: quote.route.srcChain,
        dstChain: quote.route.dstChain,
        txTo: quote.txTo,
        txValueWei: quote.txValueWei,
        txDataBytes: quote.txDataBytes,
        from: args.from,
        reason: classifyGasEstimateError(error),
        error: { name: error.name, message: error.message, attempts: error.attempts || null },
      };
      await store.append("gateway-gas-estimate-failures", failure);
      results.push({ ok: false, ...failure });
      if (!args.json) console.log(`${quote.route.srcChain}->${quote.route.dstChain} failed reason=${failure.reason}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, runId, results }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
