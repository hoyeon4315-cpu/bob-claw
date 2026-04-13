#!/usr/bin/env node

import { config, getChainRpcUrls } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { readErc20Allowance, readErc20Balance, readNativeBalance, summarizeRequirement } from "../evm/account-state.mjs";
import { getGasSnapshot } from "../gas/rpc-gas.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { resolveTokenAsset } from "../assets/erc20-metadata.mjs";
import { matchesRouteSelection } from "../estimator/route-filter.mjs";
import { requiresAllowanceForQuote } from "../estimator/wallet-readiness.mjs";

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
    address: options.address || null,
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

function chainConfig(chain) {
  return {
    ...EVM_CHAINS[chain],
    rpcUrls: getChainRpcUrls(chain, EVM_CHAINS[chain]?.rpcUrls || [EVM_CHAINS[chain]?.rpcUrl].filter(Boolean)),
  };
}

function latestGasSnapshotForChain(gasSnapshots, chain) {
  return [...(gasSnapshots || [])]
    .filter((item) => item.chain === chain)
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

function latestTreasuryInventoryForAddress(records, address) {
  return [...(records || [])]
    .filter((item) => String(item.address || "").toLowerCase() === String(address || "").toLowerCase())
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

function accountStateFallbackError(error) {
  return {
    name: error.name,
    message: error.message,
    attempts: error.attempts || [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  args.address = resolved.address;
  const quotes = latestByRouteAndAmount(await readJsonl(config.dataDir, "gateway-quotes"));
  const storedGasSnapshots = await readJsonl(config.dataDir, "gas-snapshots");
  const treasuryInventory = latestTreasuryInventoryForAddress(await readJsonl(config.dataDir, "treasury-inventory"), args.address);
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
    if (!gasByChain.has(chain)) {
      gasByChain.set(
        chain,
        (async () => {
          try {
            return {
              ...(await getGasSnapshot(chain, chainConfig(chain))),
              source: "live_rpc",
            };
          } catch (error) {
            const fallback = latestGasSnapshotForChain(storedGasSnapshots, chain);
            if (!fallback) throw error;
            return {
              ...fallback,
              source: "stored_snapshot",
              liveRpcError: {
                name: error.name,
                message: error.message,
                attempts: error.attempts || [],
              },
            };
          }
        })(),
      );
    }
    return gasByChain.get(chain);
  }

  async function nativeBalance(chain) {
    const key = `${chain}:${args.address.toLowerCase()}`;
    if (!nativeByChain.has(key)) {
      nativeByChain.set(
        key,
        (async () => {
          try {
            return {
              ...(await readNativeBalance(chain, args.address, { chainConfig: chainConfig(chain) })),
              source: "live_rpc",
            };
          } catch (error) {
            const fallback = (treasuryInventory?.native || []).find((item) => item.chain === chain) || null;
            if (!fallback) throw error;
            return {
              rpcUrl: fallback.rpcUrl || null,
              balanceWei: BigInt(fallback.actual || 0),
              source: "stored_inventory",
              observedAt: treasuryInventory?.observedAt || null,
              liveRpcError: accountStateFallbackError(error),
            };
          }
        })(),
      );
    }
    return nativeByChain.get(key);
  }

  async function tokenBalance(chain, token) {
    const key = `${chain}:${token.toLowerCase()}:${args.address.toLowerCase()}`;
    if (!tokenBalanceByKey.has(key)) {
      tokenBalanceByKey.set(
        key,
        (async () => {
          try {
            return {
              ...(await readErc20Balance(chain, token, args.address, { chainConfig: chainConfig(chain) })),
              source: "live_rpc",
            };
          } catch (error) {
            const fallback = (treasuryInventory?.tokens || []).find(
              (item) => item.chain === chain && String(item.token || "").toLowerCase() === String(token || "").toLowerCase(),
            ) || null;
            if (!fallback) throw error;
            return {
              rpcUrl: fallback.rpcUrl || null,
              balance: BigInt(fallback.actual || 0),
              source: "stored_inventory",
              observedAt: treasuryInventory?.observedAt || null,
              liveRpcError: accountStateFallbackError(error),
            };
          }
        })(),
      );
    }
    return tokenBalanceByKey.get(key);
  }

  async function allowance(chain, token, spender) {
    const key = `${chain}:${token.toLowerCase()}:${args.address.toLowerCase()}:${spender.toLowerCase()}`;
    if (!allowanceByKey.has(key)) {
      allowanceByKey.set(
        key,
        (async () => {
          try {
            return {
              ...(await readErc20Allowance(chain, token, args.address, spender, { chainConfig: chainConfig(chain) })),
              source: "live_rpc",
            };
          } catch (error) {
            const fallback = (treasuryInventory?.allowances || []).find(
              (item) =>
                item.chain === chain &&
                String(item.token || "").toLowerCase() === String(token || "").toLowerCase() &&
                String(item.spender || "").toLowerCase() === String(spender || "").toLowerCase(),
            ) || null;
            if (!fallback) throw error;
            return {
              rpcUrl: fallback.rpcUrl || null,
              allowance: BigInt(fallback.actual || 0),
              source: "stored_inventory",
              observedAt: treasuryInventory?.observedAt || null,
              liveRpcError: accountStateFallbackError(error),
            };
          }
        })(),
      );
    }
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
    let tokenState = null;
    let allowanceState = null;
    if (!srcAsset.isNative) {
      const needsAllowance = requiresAllowanceForQuote(quote);
      [tokenState, allowanceState] = await Promise.all([
        tokenBalance(quote.route.srcChain, quote.route.srcToken),
        needsAllowance ? allowance(quote.route.srcChain, quote.route.srcToken, quote.txTo) : Promise.resolve(null),
      ]);
      const inputUnits = BigInt(quote.inputAmount);
      tokenRequirement = summarizeRequirement(tokenState.balance, inputUnits);
      allowanceRequirement = needsAllowance ? summarizeRequirement(allowanceState.allowance, inputUnits) : null;
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
      gasSnapshotObservedAt: snapshot.observedAt || null,
      gasSnapshotSource: snapshot.source || "live_rpc",
      fallbackGasUnits: snapshot.fallbackGasUnits,
      gasPriceWei: snapshot.gasPriceWei,
      gasBudgetWei: gasBudgetWei.toString(),
      native: {
        rpcUrl: nativeState.rpcUrl,
        source: nativeState.source || "live_rpc",
        observedAt: nativeState.observedAt || null,
        balanceWei: nativeState.balanceWei.toString(),
        requiredWei: nativeRequiredWei.toString(),
        ok: nativeRequirement.ok,
        shortfallWei: nativeRequirement.shortfall,
      },
      token: tokenRequirement
        ? {
            token: quote.route.srcToken,
            source: tokenState.source || "live_rpc",
            observedAt: tokenState.observedAt || null,
            balance: tokenRequirement.actual,
            required: tokenRequirement.required,
            ok: tokenRequirement.ok,
            shortfall: tokenRequirement.shortfall,
          }
        : null,
      allowance: allowanceRequirement
        ? {
            spender: quote.txTo,
            source: allowanceState.source || "live_rpc",
            observedAt: allowanceState.observedAt || null,
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
