#!/usr/bin/env node
import { Interface, JsonRpcProvider } from "ethers";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { ZERO_TOKEN, tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { config, getEnv, getNumberEnv } from "../config/env.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { getMultiSourcePricesUsd, latestPriceSnapshot, priceForAssetUsd, pricesFromSnapshot } from "../market/prices.mjs";
import { resolveProtocolPositionAdapter } from "../treasury/protocol-position-adapter-registry.mjs";
import { normalizeProtocolPositionMark } from "../treasury/protocol-position-mark-schema.mjs";
import { activeProtocolPositions } from "../treasury/protocol-position-ledger.mjs";
import {
  buildProtocolPositionMarkSummary,
  markActiveProtocolPositions,
} from "../treasury/protocol-position-marker.mjs";
import { bootstrapReaders } from "../protocol-readers/bootstrap.mjs";
import { dispatchPosition } from "../protocol-readers/dispatch.mjs";

// Ensure new protocol-readers registry is bootstrapped before any dispatch.
bootstrapReaders();

const READ_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function exchangeRateStored() view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
];

const readInterface = new Interface(READ_ABI);

function parseArgs(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv)) {
    return {
      json: Boolean(argv?.json),
      write: Boolean(argv?.write),
    };
  }

  return {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
  };
}

function configuredOperatorWalletAddress() {
  return getEnv("BOB_CLAW_OPERATOR_ADDRESS")
    || getEnv("BOB_CLAW_EVM_ADDRESS")
    || config.estimateFrom
    || null;
}

async function resolveOperatorWalletAddress({ dataDir = config.dataDir } = {}) {
  const configured = configuredOperatorWalletAddress();
  if (configured) return configured;
  try {
    const resolved = await resolveOperationalAddress({ dataDir });
    return resolved?.address || null;
  } catch {
    return null;
  }
}

function providerCacheKey(chain, rpcUrl) {
  return `${chain}:${rpcUrl}`;
}

export function createContractReader({
  chainConfigResolver = getEvmChainConfig,
  providerFactory = (rpcUrl, chainId) => new JsonRpcProvider(rpcUrl, chainId),
} = {}) {
  const providers = new Map();

  return async ({ chain, address, functionName, args = [] }) => {
    const chainConfig = chainConfigResolver(chain);
    if (!chainConfig) throw new Error(`No EVM chain config for ${chain || "unknown"}`);
    const rpcUrls = Array.isArray(chainConfig.rpcUrls) && chainConfig.rpcUrls.length > 0
      ? chainConfig.rpcUrls
      : [chainConfig.rpcUrl].filter(Boolean);
    if (rpcUrls.length === 0) throw new Error(`No RPC URL configured for chain ${chain || "unknown"}`);
    if (!address) throw new Error(`Missing contract address for ${functionName}`);
    try {
      readInterface.getFunction(functionName);
    } catch {
      throw new Error(`Unsupported read function ${functionName}`);
    }

    const data = readInterface.encodeFunctionData(functionName, args);
    let lastError = null;

    for (const rpcUrl of rpcUrls) {
      const key = providerCacheKey(chain, rpcUrl);
      let provider = providers.get(key);
      if (!provider) {
        provider = providerFactory(rpcUrl, chainConfig.chainId);
        providers.set(key, provider);
      }

      try {
        const result = await provider.call({ to: address, data });
        const decoded = readInterface.decodeFunctionResult(functionName, result);
        return decoded.length === 1 ? decoded[0] : decoded;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  };
}

const STABLE_SYMBOLS = new Set(["DAI", "RLUSD", "USDC", "USDS", "USDT"]);
const SYMBOL_PRICE_KEYS = new Map([
  ["avax", "avalanche"],
  ["bera", "bera"],
  ["bnb", "bsc"],
  ["btc", "btc"],
  ["cbbtc", "btc"],
  ["cbeth", "ethereum"],
  ["eth", "ethereum"],
  ["fbtc", "btc"],
  ["lbtc", "btc"],
  ["paxg", "paxg"],
  ["s", "sonic"],
  ["sei", "sei"],
  ["solvbtc", "btc"],
  ["solvbtcbbn", "btc"],
  ["tbtc", "btc"],
  ["unibtc", "btc"],
  ["wavax", "avalanche"],
  ["wbera", "bera"],
  ["wbnb", "bsc"],
  ["wbtc", "wbtc"],
  ["wbtcoft", "btc"],
  ["weth", "ethereum"],
  ["ws", "sonic"],
  ["xaut", "xaut"],
  ["xsolvbtc", "btc"],
]);
const RETRYABLE_READER_FAILURES = new Set(["rpc_failed", "reader_throw"]);

function normalizeSymbolKey(symbol) {
  return String(symbol || "").replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function inferPriceKey({ token, symbol, chain } = {}) {
  const asset = token ? tokenAsset(chain, token) : null;
  if (asset?.priceKey) return asset.priceKey;
  if (token === ZERO_TOKEN) return tokenAsset(chain, ZERO_TOKEN).priceKey;
  return SYMBOL_PRICE_KEYS.get(normalizeSymbolKey(symbol)) || null;
}

function hasFinitePriceCoverage(prices = {}) {
  return [
    prices?.btc,
    ...Object.values(prices?.tokenByKey || {}),
    ...Object.values(prices?.nativeByChain || {}),
  ].some(Number.isFinite);
}

async function loadProtocolMarkPrices({
  dataDir = config.dataDir,
  readJsonlImpl = readJsonl,
  readFileImpl = readFile,
  fetchPrices = getMultiSourcePricesUsd,
} = {}) {
  try {
    const snapshot = JSON.parse(await readFileImpl(join(dataDir, "price-snapshot.json"), "utf8"));
    const prices = pricesFromSnapshot(snapshot);
    if (hasFinitePriceCoverage(prices)) return prices;
  } catch {}

  const latestSnapshot = latestPriceSnapshot(await readJsonlImpl(dataDir, "market-price-snapshots"));
  if (latestSnapshot) {
    const prices = pricesFromSnapshot(latestSnapshot);
    if (hasFinitePriceCoverage(prices)) return prices;
  }

  return fetchPrices();
}

function createPriceReader(options = {}) {
  let pricesPromise = null;
  const loadPrices = async () => {
    if (!pricesPromise) pricesPromise = loadProtocolMarkPrices(options);
    return pricesPromise;
  };
  const readPrice = async ({ token, symbol, chain } = {}) => {
    if (STABLE_SYMBOLS.has(String(symbol || "").toUpperCase())) return 1;
    const priceKey = inferPriceKey({ token, symbol, chain });
    if (!priceKey) {
      throw new Error(`No price reader configured for ${symbol || token || "unknown token"} on ${chain || "unknown chain"}`);
    }
    const prices = await loadPrices();
    const priceUsd = priceForAssetUsd({ priceKey }, prices);
    if (Number.isFinite(priceUsd)) return priceUsd;
    throw new Error(`No ${priceKey} price available for ${symbol || token || "unknown token"} on ${chain || "unknown chain"}`);
  };
  readPrice.getBtcPriceUsd = async () => {
    const prices = await loadPrices();
    return prices?.btc ?? prices?.tokenByKey?.btc ?? null;
  };
  return readPrice;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function defaultReaderMarkFailure(position, {
  observedAt,
  adapterId = null,
  failureKind,
  message,
}) {
  return normalizeProtocolPositionMark({
    event: "position_mark_failed",
    status: position.status || "open",
    observedAt,
    positionId: position.positionId,
    opportunityId: position.opportunityId || null,
    strategyId: position.strategyId || null,
    chain: position.chain,
    protocolId: position.protocolId,
    bindingKind: position.bindingKind,
    adapterId,
    failureKind,
    message,
  }, { now: observedAt });
}

function inferObservedAssetSymbol({ position = {}, observed = {} } = {}) {
  const direct = position.assetSymbol || position.symbol || observed.assetSymbol || observed.symbol || null;
  if (direct) return direct;
  const chain = position.chain || observed.chain;
  const assetAddress = observed.assetAddress || observed.underlyingTokenAddress || position.assetAddress || position.underlyingTokenAddress || ZERO_TOKEN;
  return tokenAsset(chain, assetAddress).ticker || null;
}

function readerMarkPositionId(position, observed, { index = 0, total = 1 } = {}) {
  if (total === 1 && position.positionId) return position.positionId;
  return observed.positionId || `${position.positionId || "reader"}:${index}`;
}

async function buildReaderBackedMark({
  position,
  observed,
  observedAt,
  priceReader,
  btcPriceUsd,
  index = 0,
  total = 1,
}) {
  const chain = position.chain || observed.chain;
  const assetAddress = observed.assetAddress || observed.underlyingTokenAddress || position.assetAddress || position.underlyingTokenAddress || null;
  const assetDecimals = finiteNumber(observed.assetDecimals ?? position.assetDecimals);
  const assetBalance = observed.assetBalance ?? null;
  const assetAmount =
    assetBalance !== null && Number.isInteger(assetDecimals) && assetDecimals >= 0
      ? unitsToDecimal(assetBalance, assetDecimals)
      : null;
  let assetPriceUsd = null;
  if (assetBalance !== null && BigInt(assetBalance || 0) > 0n) {
    const assetSymbol = inferObservedAssetSymbol({ position, observed });
    try {
      assetPriceUsd = await priceReader({
        chain,
        token: assetAddress,
        symbol: assetSymbol,
      });
    } catch (error) {
      return defaultReaderMarkFailure(position, {
        observedAt,
        adapterId: observed.adapterId || null,
        failureKind: "price_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return normalizeProtocolPositionMark({
    event: "position_marked",
    status: position.status || "open",
    observedAt,
    positionId: readerMarkPositionId(position, observed, { index, total }),
    opportunityId: position.opportunityId || observed.opportunityId || null,
    strategyId: position.strategyId || observed.strategyId || null,
    chain,
    protocolId: position.protocolId || observed.protocolId || null,
    bindingKind: position.bindingKind || observed.bindingKind || null,
    adapterId: observed.adapterId || null,
    walletAddress: observed.walletAddress || null,
    shareTokenAddress: observed.shareTokenAddress || position.shareTokenAddress || position.vaultAddress || null,
    shareBalance: observed.shareBalance ?? null,
    assetAddress,
    assetSymbol: inferObservedAssetSymbol({ position, observed }),
    assetDecimals,
    assetBalance,
    assetAmount,
    assetPriceUsd,
    debtBalance: observed.debtBalance ?? null,
    debtAmount:
      observed.debtBalance != null && Number.isInteger(assetDecimals) && assetDecimals >= 0
        ? unitsToDecimal(observed.debtBalance, assetDecimals)
        : null,
    healthFactor: finiteNumber(observed.healthFactor),
    markSource: "protocol_reader",
    btcPriceUsd,
    source: "protocol_reader",
  }, { now: observedAt });
}

function assertWritableWalletState({ args, positions, walletAddress }) {
  if (!args.write || positions.length === 0 || walletAddress) return;
  throw new Error("Cannot write protocol position marks without walletAddress while active positions exist");
}

export async function runMarkProtocolPositionMarksCli(options = {}) {
  const {
    args: rawArgs = process.argv.slice(2),
    dataDir = config.dataDir,
    observedAt = new Date().toISOString(),
    positionEvents,
    contractReader = createContractReader(),
    readerProviderFactory = null,
    priceReader: providedPriceReader,
    btcPriceUsd = getNumberEnv("BOB_CLAW_BTC_PRICE_USD", null),
    store,
    readJsonlImpl = readJsonl,
    readFileImpl = readFile,
    fetchPrices = getMultiSourcePricesUsd,
  } = options;
  const args = parseArgs(rawArgs);
  const loadedPositionEvents = positionEvents ?? await readJsonlImpl(dataDir, "merkl-portfolio-positions");
  const positions = activeProtocolPositions(loadedPositionEvents);
  const resolvedWalletAddress = Object.hasOwn(options, "walletAddress")
    ? options.walletAddress
    : await resolveOperatorWalletAddress({ dataDir });
  assertWritableWalletState({ args, positions, walletAddress: resolvedWalletAddress });
  const priceReader = providedPriceReader || createPriceReader({
    dataDir,
    readJsonlImpl,
    readFileImpl,
    fetchPrices,
  });
  const effectiveBtcPriceUsd =
    finiteNumber(btcPriceUsd) ??
    (typeof priceReader.getBtcPriceUsd === "function" ? await priceReader.getBtcPriceUsd() : null);

  // Route every position through dispatchPosition first. Reader hits become
  // synthetic mark-success events; legacy hits fall back to the existing
  // mark-based adapter pipeline so the marker keeps owning legacy mark math.
  const readerEvents = [];
  const legacyPositions = [];
  for (const position of positions) {
    const dispatch = await dispatchPosition({
      position,
      chain: position.chain,
      walletAddress: resolvedWalletAddress,
      _providerFactory: readerProviderFactory,
    });
    if (dispatch.kind === "reader") {
      const result = dispatch.result;
      if (result?.ok) {
        for (const [index, observed] of (result.positions || []).entries()) {
          readerEvents.push(await buildReaderBackedMark({
            position,
            observed,
            observedAt,
            priceReader,
            btcPriceUsd: effectiveBtcPriceUsd,
            index,
            total: result.positions.length,
          }));
        }
      } else {
        const legacyAdapter = resolveProtocolPositionAdapter(position);
        if (legacyAdapter && RETRYABLE_READER_FAILURES.has(result?.code)) {
          legacyPositions.push(position);
          continue;
        }
        readerEvents.push(defaultReaderMarkFailure(position, {
          observedAt,
          adapterId: dispatch.id,
          failureKind: result?.code || "reader_failed",
          message: result?.error || "reader returned error",
        }));
      }
    } else if (dispatch.kind === "legacy") {
      legacyPositions.push(position);
    } else {
      readerEvents.push(defaultReaderMarkFailure(position, {
        observedAt,
        adapterId: null,
        failureKind: "no_reader_no_adapter",
        message: `No reader or legacy adapter for bindingKind ${position.bindingKind || "unknown"}`,
      }));
    }
  }

  const legacyEvents = legacyPositions.length > 0
    ? await markActiveProtocolPositions({
        positions: legacyPositions,
        walletAddress: resolvedWalletAddress,
        contractReader,
        priceReader,
        btcPriceUsd: effectiveBtcPriceUsd,
        observedAt,
      })
    : [];

  const events = [...readerEvents, ...legacyEvents].sort(
    (left, right) => String(left.positionId || "").localeCompare(String(right.positionId || "")),
  );

  const summary = buildProtocolPositionMarkSummary({ observedAt, events });
  if (args.write) {
    const markStore = store || new JsonlStore(dataDir);
    for (const event of events) {
      await markStore.append("protocol-position-marks", event);
    }
  }

  return summary;
}

async function main() {
  const summary = await runMarkProtocolPositionMarksCli();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
