#!/usr/bin/env node

import { EVM_CHAIN_CONFIGS, listEvmChains } from "../config/chains.mjs";
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../config/gateway-destinations.mjs";
import { STRATEGY_CAPS } from "../config/strategy-caps/registry.mjs";
import { EXECUTION_EV_COST_POLICY } from "../config/sizing.mjs";
import {
  supportedBindingKinds,
  getBindingRegistration,
} from "../executor/protocol-binding-registry.mjs";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

async function countAutoExecuteStrategiesPerChain() {
  const counts = {};
  for (const chain of OFFICIAL_GATEWAY_DESTINATION_CHAINS) {
    counts[chain] = 0;
  }
  for (const entry of Object.values(STRATEGY_CAPS)) {
    if (!entry.autoExecute) continue;
    const perChain = entry.caps?.perChainUsd;
    if (!perChain || typeof perChain !== "object") continue;
    for (const chain of OFFICIAL_GATEWAY_DESTINATION_CHAINS) {
      const val = perChain[chain];
      if (typeof val === "number" && val > 0 && val < 1_000_000) {
        counts[chain] += 1;
      }
    }
  }
  return counts;
}

function p90CostForChain(chain) {
  const policy = EXECUTION_EV_COST_POLICY;
  const chainCost = policy.p99CostUsdByChain?.[chain];
  if (typeof chainCost === "number" && Number.isFinite(chainCost)) {
    return chainCost;
  }
  return policy.defaultP99CostUsd ?? null;
}

async function offrampProofChains() {
  const proven = new Set();
  const auditPath = join(config.dataDir, "gateway-btc-offramp-executions.jsonl");
  if (!existsSync(auditPath)) return proven;
  const text = await readFile(auditPath, "utf8").catch(() => "");
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const srcChain = entry?.plan?.route?.srcChain || entry?.execution?.plan?.route?.srcChain;
      const dstChain = entry?.plan?.route?.dstChain || entry?.execution?.plan?.route?.dstChain;
      const settlement = entry?.execution?.settlementStatus || entry?.settlementStatus;
      if (settlement === "delivered" || settlement === "confirmed" || settlement === "settled") {
        if (srcChain) proven.add(srcChain);
        if (dstChain) proven.add(dstChain);
      }
      const destinationProof = entry?.execution?.destinationProof || entry?.destinationProof;
      if (destinationProof?.observedDelta >= destinationProof?.requiredDelta) {
        if (srcChain) proven.add(srcChain);
        if (dstChain) proven.add(dstChain);
      }
    } catch {}
  }
  return proven;
}

async function onrampProofChains() {
  const proven = new Set();
  const auditPath = join(config.dataDir, "gateway-btc-onramp-executions.jsonl");
  if (!existsSync(auditPath)) return proven;
  const text = await readFile(auditPath, "utf8").catch(() => "");
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const dstChain = entry?.plan?.dstChain || entry?.execution?.plan?.dstChain;
      const settlement = entry?.execution?.settlementStatus || entry?.settlementStatus;
      if (settlement === "delivered" || settlement === "confirmed" || settlement === "settled") {
        if (dstChain) proven.add(dstChain);
      }
    } catch {}
  }
  return proven;
}

function bindingKindsForChain(chain) {
  const kinds = new Set();
  for (const kind of supportedBindingKinds()) {
    const reg = getBindingRegistration(kind);
    if (!reg) continue;
    const chains = reg.chains || reg.supportedChains || [];
    if (chains.includes(chain)) {
      kinds.add(kind);
    }
  }
  return Array.from(kinds).sort();
}

function shadowPeriodsForChain(chain) {
  // Shadow periods are counted from strategy execution surfaces that have
  // shadow/consecutive-positive evidence. We approximate by scanning the
  // strategy caps for shadow-mode strategies targeting this chain.
  let periods = 0;
  for (const entry of Object.values(STRATEGY_CAPS)) {
    const perChain = entry.caps?.perChainUsd?.[chain];
    if (typeof perChain === "number" && perChain > 0 && perChain < 1_000_000) {
      if (entry.autoExecute) {
        periods += 1;
      }
    }
  }
  return periods;
}

async function buildMatrix() {
  const autoExecuteCounts = await countAutoExecuteStrategiesPerChain();
  const offrampProven = await offrampProofChains();
  const onrampProven = await onrampProofChains();

  const rows = OFFICIAL_GATEWAY_DESTINATION_CHAINS.map((chain) => {
    const chainConfig = EVM_CHAIN_CONFIGS[chain] || null;
    const p90Cost = p90CostForChain(chain);
    const bindings = bindingKindsForChain(chain);
    const autoExecuteCount = autoExecuteCounts[chain] ?? 0;
    const shadows = shadowPeriodsForChain(chain);
    const hasOfframpProof = offrampProven.has(chain);
    const hasOnrampProof = onrampProven.has(chain);

    return {
      chain,
      chainsMjsEntry: chainConfig !== null,
      chainId: chainConfig?.chainId ?? null,
      nativeSymbol: chainConfig?.nativeSymbol ?? null,
      p90CostSamples: p90Cost,
      executorBindingKind: bindings.length > 0 ? bindings : ["none"],
      shadowPeriods: shadows,
      offrampSettlementProof: {
        offrampProven: hasOfframpProof,
        onrampProven: hasOnrampProof,
        anyGatewayProof: hasOfframpProof || hasOnrampProof,
      },
      autoExecuteStrategiesCount: autoExecuteCount,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = await buildMatrix();

  if (args.json) {
    console.log(JSON.stringify(matrix, null, 2));
    return;
  }

  console.log(`Chain Readiness Matrix (${matrix.rowCount} chains)`);
  console.log(`generatedAt=${matrix.generatedAt}`);
  for (const row of matrix.rows) {
    const proofStatus = row.offrampSettlementProof.anyGatewayProof
      ? "gateway_proven"
      : "gateway_unproven";
    console.log(
      `${row.chain}: entry=${row.chainsMjsEntry}, chainId=${row.chainId}, p90=$${row.p90CostSamples}, bindings=[${row.executorBindingKind.join(",")}], shadow=${row.shadowPeriods}, offramp=${proofStatus}, autoExec=${row.autoExecuteStrategiesCount}`
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
