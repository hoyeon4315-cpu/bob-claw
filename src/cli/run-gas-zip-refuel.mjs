#!/usr/bin/env node

import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import {
  buildGasZipNativeRefuelPlan,
  executeGasZipNativeRefuelPlan,
  GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID,
} from "../executor/helpers/gas-zip-refuel.mjs";
import { DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "../executor/helpers/gateway-btc-consolidation.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";

export function parseArgs(argv) {
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
    execute: flags.has("--execute"),
    skipRateLimit: flags.has("--skip-rate-limit"),
    srcChain: options["src-chain"] || null,
    dstChain: options["dst-chain"] || null,
    amountWei: options["amount-wei"] || null,
    sender: options.sender || null,
    recipient: options.recipient || null,
    strategyId: options["strategy-id"] || GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    awaitDestinationSettlement: !flags.has("--no-await-destination-settlement"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    destinationSettlementTimeoutMs: options["destination-timeout-ms"] ? Number(options["destination-timeout-ms"]) : null,
    destinationPollIntervalMs: options["destination-poll-interval-ms"] ? Number(options["destination-poll-interval-ms"]) : 10_000,
    gasBufferBps: options["gas-buffer-bps"] ? Number(options["gas-buffer-bps"]) : DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  };
}

async function resolveAddresses(args) {
  if (args.sender && args.recipient) {
    return { sender: args.sender, recipient: args.recipient };
  }
  const health = await readSignerHealth({
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });
  const evmAddress =
    args.sender || args.recipient || health?.addresses?.[args.srcChain] || health?.addresses?.base || null;
  if (!evmAddress) {
    throw new Error(
      "EVM sender/recipient is required; pass --sender/--recipient or start the signer daemon with an EVM key configured",
    );
  }
  return {
    sender: args.sender || evmAddress,
    recipient: args.recipient || evmAddress,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.srcChain) throw new Error("--src-chain is required");
  if (!args.dstChain) throw new Error("--dst-chain is required");
  if (!args.amountWei) throw new Error("--amount-wei is required (source-chain native amount, in wei)");

  const { sender, recipient } = await resolveAddresses(args);

  // Load audit records for rate-limit enforcement
  const auditRecords = await readJsonl(config.dataDir, "signer-audit").catch(() => []);

  // Check destination chain balance status
  let destinationBalanceStatus = null;
  let destinationNativeDecimal = null;
  let destinationMinBalanceDecimal = null;
  try {
    const treasuryPolicy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
    const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
    const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
    const inventory = await scanTreasuryInventory({
      policy: treasuryPolicy,
      address: resolved.address,
      prices,
    });
    const dstNative = inventory.native.find((n) => n.chain === args.dstChain);
    if (dstNative) {
      destinationBalanceStatus = dstNative.status || null;
      destinationNativeDecimal = dstNative.actualDecimal ?? dstNative.actual != null
        ? Number(BigInt(dstNative.actual)) / 10 ** (dstNative.decimals || 18)
        : null;
      destinationMinBalanceDecimal = dstNative.minBalanceDecimal ?? dstNative.minBalance != null
        ? Number(BigInt(dstNative.minBalance)) / 10 ** (dstNative.decimals || 18)
        : null;
    }
  } catch {
    // Inventory scan failure should not block; rate limit still applies via audit records
  }

  const plan = await buildGasZipNativeRefuelPlan({
    srcChain: args.srcChain,
    dstChain: args.dstChain,
    amountWei: args.amountWei,
    senderAddress: sender,
    recipient,
    strategyId: args.strategyId,
    gasBufferBps: args.gasBufferBps,
    auditRecords,
    destinationBalanceStatus,
    destinationNativeDecimal,
    destinationMinBalanceDecimal,
    skipRateLimit: args.skipRateLimit,
  });
  const execution = args.execute
    ? await executeGasZipNativeRefuelPlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        awaitDestinationSettlement: args.awaitDestinationSettlement,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
        destinationSettlementTimeoutMs: args.destinationSettlementTimeoutMs || undefined,
        destinationPollIntervalMs: args.destinationPollIntervalMs,
      })
    : null;

  if (args.write || args.execute) {
    await writeTextIfChanged(
      join(config.dataDir, "gas-zip-refuel-plan-latest.json"),
      `${JSON.stringify({ plan, execution }, null, 2)}\n`,
    );
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("gas-zip-refuel-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`route=${plan.srcChain}->${plan.dstChain}`);
  console.log(`amountWei=${plan.amountWei}`);
  console.log(`amountUsd=${plan.amountUsd}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`recipient=${plan.recipient}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  if (plan.rateLimitBlockers?.length) {
    console.log(`rateLimitBlockers=${plan.rateLimitBlockers.join(",")}`);
  }
  if (plan.gasZipError?.message) console.log(`gasZipError=${plan.gasZipError.message}`);
  if (plan.preflightError?.message) console.log(`preflightError=${plan.preflightError.message}`);
  if (plan.gasPreflight) {
    console.log(`gasUnits=${plan.gasPreflight.gasUnits}`);
    console.log(`gasLimit=${plan.gasPreflight.gasLimit}`);
  }
  if (plan.quote?.expectedOutputWei) {
    console.log(`expectedDestinationWei=${plan.quote.expectedOutputWei}`);
    if (plan.quote.outputValueUsd != null) console.log(`expectedDestinationUsd=${plan.quote.outputValueUsd}`);
  }
  if (execution?.signerResult?.broadcast?.txHash) {
    console.log(`txHash=${execution.signerResult.broadcast.txHash}`);
  }
  if (execution?.signerResult?.status) {
    console.log(`signerStatus=${execution.signerResult.status}`);
  }
  if (execution?.signerResult?.policy?.blockers?.length) {
    console.log(`policyBlockers=${execution.signerResult.policy.blockers.join(",")}`);
  }
  if (execution?.settlementStatus) {
    console.log(`settlementStatus=${execution.settlementStatus}`);
  }
  if (execution?.destinationProof) {
    console.log(`destinationProofSource=${execution.destinationProof.proofSource}`);
    console.log(`destinationObservedDelta=${execution.destinationProof.observedDelta}`);
    console.log(`destinationRequiredDelta=${execution.destinationProof.requiredDelta}`);
    if (execution.destinationProof.status === "near_match_timeout") {
      console.log(`nearMatchBps=${execution.destinationProof.nearMatchBps}`);
    }
  }
  if (execution?.receiptIngest) {
    console.log(`receiptIngestAppended=${execution.receiptIngest.appended === true}`);
    if (execution.receiptIngest.reason) {
      console.log(`receiptIngestReason=${execution.receiptIngest.reason}`);
    }
  }
}

const entrypointHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : null;
if (entrypointHref && import.meta.url === entrypointHref) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
