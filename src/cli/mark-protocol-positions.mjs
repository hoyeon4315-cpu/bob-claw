#!/usr/bin/env node
import { Interface, JsonRpcProvider } from "ethers";
import { pathToFileURL } from "node:url";
import { config, getEnv, getNumberEnv } from "../config/env.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { activeProtocolPositions } from "../treasury/protocol-position-ledger.mjs";
import {
  buildProtocolPositionMarkSummary,
  markActiveProtocolPositions,
} from "../treasury/protocol-position-marker.mjs";

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

async function resolveOperatorWalletAddress() {
  const configured = configuredOperatorWalletAddress();
  if (configured) return configured;
  try {
    const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
    return resolved?.address || null;
  } catch {
    return null;
  }
}

function providerCacheKey(chain, rpcUrl) {
  return `${chain}:${rpcUrl}`;
}

function createContractReader() {
  const providers = new Map();

  return async ({ chain, address, functionName, args = [] }) => {
    const chainConfig = getEvmChainConfig(chain);
    if (!chainConfig) throw new Error(`No EVM chain config for ${chain || "unknown"}`);
    const rpcUrl = chainConfig.rpcUrl;
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chain || "unknown"}`);
    if (!address) throw new Error(`Missing contract address for ${functionName}`);
    try {
      readInterface.getFunction(functionName);
    } catch {
      throw new Error(`Unsupported read function ${functionName}`);
    }

    const key = providerCacheKey(chain, rpcUrl);
    let provider = providers.get(key);
    if (!provider) {
      provider = new JsonRpcProvider(rpcUrl, chainConfig.chainId);
      providers.set(key, provider);
    }

    const data = readInterface.encodeFunctionData(functionName, args);
    const result = await provider.call({ to: address, data });
    const decoded = readInterface.decodeFunctionResult(functionName, result);
    return decoded.length === 1 ? decoded[0] : decoded;
  };
}

function createPriceReader() {
  return async ({ token, symbol, chain } = {}) => {
    const stableSymbols = new Set(["DAI", "USDC", "USDT", "USDS"]);
    if (stableSymbols.has(String(symbol || "").toUpperCase())) return 1;
    throw new Error(`No price reader configured for ${symbol || token || "unknown token"} on ${chain || "unknown chain"}`);
  };
}

function assertWritableWalletState({ args, positions, walletAddress }) {
  if (!args.write || positions.length === 0 || walletAddress) return;
  throw new Error("Cannot write protocol position marks without walletAddress while active positions exist");
}

export async function runMarkProtocolPositionMarksCli(options = {}) {
  const {
    args: rawArgs = process.argv.slice(2),
    observedAt = new Date().toISOString(),
    positionEvents,
    contractReader = createContractReader(),
    priceReader = createPriceReader(),
    btcPriceUsd = getNumberEnv("BOB_CLAW_BTC_PRICE_USD", null),
    store,
  } = options;
  const args = parseArgs(rawArgs);
  const loadedPositionEvents = positionEvents ?? await readJsonl(config.dataDir, "merkl-portfolio-positions");
  const positions = activeProtocolPositions(loadedPositionEvents);
  const resolvedWalletAddress = Object.hasOwn(options, "walletAddress")
    ? options.walletAddress
    : await resolveOperatorWalletAddress();
  assertWritableWalletState({ args, positions, walletAddress: resolvedWalletAddress });

  const events = await markActiveProtocolPositions({
    positions,
    walletAddress: resolvedWalletAddress,
    contractReader,
    priceReader,
    btcPriceUsd,
    observedAt,
  });

  const summary = buildProtocolPositionMarkSummary({ observedAt, events });
  if (args.write) {
    const markStore = store || new JsonlStore(config.dataDir);
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
