#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { readErc20Allowance, readErc20Balance, readNativeBalance, summarizeRequirement } from "../evm/account-state.mjs";
import { getGasSnapshot } from "../gas/rpc-gas.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { resolveTokenAsset } from "../assets/erc20-metadata.mjs";
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
    address: options.address || config.estimateFrom,
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

function formatNative(value) {
  return Number(value) / 1e18;
}

function skipReason(quote) {
  if (quote.route?.srcChain === "bitcoin") return "bitcoin_source_no_evm_wallet";
  if (!quote.txTo) return "missing_tx_to";
  if (!quote.txData) return "missing_tx_data";
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const quotes = latestByRouteAndAmount(await readJsonl(config.dataDir, "gateway-quotes"));
  const store = new JsonlStore(config.dataDir);
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const gasByChain = new Map();
  const nativeByChain = new Map();
  const tokenBalanceByKey = new Map();
  const allowanceByKey = new Map();
  const selected = quotes
    .filter((quote) => quote.route?.srcChain !== "bitcoin")
    .filter((quote) => matchesRouteSelection(quote, args))
    .slice(0, Number.isFinite(args.routeLimit) && args.routeLimit > 0 ? args.routeLimit : quotes.length);
  const results = [];

  async function gasSnapshot(chain) {
    if (!gasByChain.has(chain)) gasByChain.set(chain, getGasSnapshot(chain));
    return gasByChain.get(chain);
  }

  async function nativeBalance(chain) {
    const key = `${chain}:${args.address.toLowerCase()}`;
    if (!nativeByChain.has(key)) nativeByChain.set(key, readNativeBalance(chain, args.address));
    return nativeByChain.get(key);
  }

  async function tokenBalance(chain, token) {
    const key = `${chain}:${token.toLowerCase()}:${args.address.toLowerCase()}`;
    if (!tokenBalanceByKey.has(key)) tokenBalanceByKey.set(key, readErc20Balance(chain, token, args.address));
    return tokenBalanceByKey.get(key);
  }

  async function allowance(chain, token, spender) {
    const key = `${chain}:${token.toLowerCase()}:${args.address.toLowerCase()}:${spender.toLowerCase()}`;
    if (!allowanceByKey.has(key)) allowanceByKey.set(key, readErc20Allowance(chain, token, args.address, spender));
    return allowanceByKey.get(key);
  }

  for (const quote of selected) {
    const reason = skipReason(quote);
    if (reason) {
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        address: args.address,
        routeKey: quote.routeKey,
        amount: quote.amount,
        srcChain: quote.route.srcChain,
        dstChain: quote.route.dstChain,
        reason,
      };
      await store.append("estimator-wallet-readiness-failures", failure);
      results.push({ ok: false, ...failure });
      if (!args.json) console.log(`${quote.route.srcChain}->${quote.route.dstChain} skipped reason=${reason}`);
      continue;
    }

    const srcAsset = await resolveTokenAsset(quote.route.srcChain, quote.route.srcToken);
    const snapshot = await gasSnapshot(quote.route.srcChain);
    const gasBudgetWei = BigInt(snapshot.gasPriceWei) * BigInt(snapshot.fallbackGasUnits);
    const txValueWei = BigInt(quote.txValueWei || 0);
    const nativeRequiredWei = txValueWei + gasBudgetWei;
    const nativeState = await nativeBalance(quote.route.srcChain);
    const nativeRequirement = summarizeRequirement(nativeState.balanceWei, nativeRequiredWei);

    let tokenRequirement = null;
    let allowanceRequirement = null;
    if (!srcAsset.isNative) {
      const [tokenState, allowanceState] = await Promise.all([
        tokenBalance(quote.route.srcChain, quote.route.srcToken),
        allowance(quote.route.srcChain, quote.route.srcToken, quote.txTo),
      ]);
      const inputUnits = BigInt(quote.inputAmount);
      tokenRequirement = summarizeRequirement(tokenState.balance, inputUnits);
      allowanceRequirement = summarizeRequirement(allowanceState.allowance, inputUnits);
    }

    const record = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      observedAt: new Date().toISOString(),
      address: args.address,
      routeKey: quote.routeKey,
      amount: quote.amount,
      srcChain: quote.route.srcChain,
      dstChain: quote.route.dstChain,
      srcToken: quote.route.srcToken,
      srcTicker: srcAsset.ticker,
      txTo: quote.txTo,
      txValueWei: txValueWei.toString(),
      txDataBytes: quote.txDataBytes,
      fallbackGasUnits: snapshot.fallbackGasUnits,
      gasPriceWei: snapshot.gasPriceWei,
      gasBudgetWei: gasBudgetWei.toString(),
      native: {
        rpcUrl: nativeState.rpcUrl,
        balanceWei: nativeState.balanceWei.toString(),
        requiredWei: nativeRequiredWei.toString(),
        ok: nativeRequirement.ok,
        shortfallWei: nativeRequirement.shortfall,
      },
      token: tokenRequirement
        ? {
            token: quote.route.srcToken,
            balance: tokenRequirement.actual,
            required: tokenRequirement.required,
            ok: tokenRequirement.ok,
            shortfall: tokenRequirement.shortfall,
          }
        : null,
      allowance: allowanceRequirement
        ? {
            spender: quote.txTo,
            allowance: allowanceRequirement.actual,
            required: allowanceRequirement.required,
            ok: allowanceRequirement.ok,
            shortfall: allowanceRequirement.shortfall,
          }
        : null,
      overallReady: nativeRequirement.ok && (tokenRequirement?.ok ?? true) && (allowanceRequirement?.ok ?? true),
    };
    await store.append("estimator-wallet-readiness", record);
    results.push({ ok: true, ...record });
    if (!args.json) {
      const tokenText = record.token ? ` tokenReady=${record.token.ok}` : "";
      const allowanceText = record.allowance ? ` allowanceReady=${record.allowance.ok}` : "";
      console.log(
        `${record.srcChain}->${record.dstChain} nativeReady=${record.native.ok}${tokenText}${allowanceText} native=${formatNative(record.native.balanceWei).toFixed(6)}`,
      );
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, runId, address: args.address, results }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
