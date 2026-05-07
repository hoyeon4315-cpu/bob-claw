#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, getChainRpcUrls } from "../config/env.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { rpc } from "../evm/json-rpc.mjs";
import { buildGatewayMulticall3Matrix } from "../evm/multicall3-availability.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function rpcUrlsForChain(chain) {
  const chainConfig = EVM_CHAINS[chain] || {};
  const fallback = [...new Set([...(chainConfig.rpcUrls || []), chainConfig.rpcUrl].filter(Boolean))];
  return getChainRpcUrls(chain, fallback);
}

async function readCodeFromConfiguredRpc({ chain, address }) {
  const attempts = [];
  for (const rpcUrl of rpcUrlsForChain(chain)) {
    try {
      const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
      return { rpcUrl, code };
    } catch (error) {
      attempts.push(`${rpcUrl}: ${error.message}`);
    }
  }
  throw new Error(attempts.length ? attempts.join(" | ") : `no_rpc_config_for_${chain}`);
}

export async function runReportMulticall3GatewayMatrix(args = parseArgs()) {
  const report = await buildGatewayMulticall3Matrix({
    readCode: readCodeFromConfiguredRpc,
  });
  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "multicall3-gateway-matrix.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs();
  runReportMulticall3GatewayMatrix(args)
    .then((report) => {
      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`kind=${report.kind}`);
      console.log(`chainCount=${report.summary.chainCount}`);
      console.log(`available=${report.summary.availableCount}`);
      console.log(`missing=${report.summary.missingCount}`);
      console.log(`rpcError=${report.summary.rpcErrorCount}`);
      console.log(`blockers=${report.summary.blockers.join(",") || "none"}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
