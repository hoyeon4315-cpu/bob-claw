#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import {
  buildGatewayBtcConsolidationPlan,
  DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  executeGatewayBtcConsolidationPlan,
} from "../executor/helpers/gateway-btc-consolidation.mjs";

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
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    srcChain: options["src-chain"] || null,
    dstChain: options["dst-chain"] || "base",
    token: options.token || "wbtc.oft",
    srcToken: options["src-token"] || null,
    dstToken: options["dst-token"] || null,
    amount: options.amount || "10000",
    gasRefill: options["gas-refill"] || null,
    sender: options.sender || null,
    recipient: options.recipient || null,
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
    return {
      sender: args.sender,
      recipient: args.recipient,
    };
  }
  const health = await readSignerHealth({
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });
  const evmAddress = args.sender || args.recipient || health?.addresses?.base || null;
  if (!evmAddress) {
    throw new Error("EVM sender/recipient is required; pass --sender/--recipient or start the signer daemon with an EVM key configured");
  }
  return {
    sender: args.sender || evmAddress,
    recipient: args.recipient || evmAddress,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.srcChain) {
    throw new Error("--src-chain is required");
  }
  const { sender, recipient } = await resolveAddresses(args);
  const plan = await buildGatewayBtcConsolidationPlan({
    srcChain: args.srcChain,
    dstChain: args.dstChain,
    token: args.token,
    srcToken: args.srcToken || args.token,
    dstToken: args.dstToken || args.token,
    amount: args.amount,
    gasRefill: args.gasRefill,
    senderAddress: sender,
    recipient,
    gasBufferBps: args.gasBufferBps,
  });
  const execution = args.execute
    ? await executeGatewayBtcConsolidationPlan({
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
      join(config.dataDir, "gateway-btc-consolidation-plan-latest.json"),
      `${JSON.stringify({ plan, execution }, null, 2)}\n`,
    );
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("gateway-btc-consolidation-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`route=${plan.route.srcChain}->${plan.route.dstChain}`);
  console.log(`asset=${plan.srcAsset.ticker}->${plan.dstAsset.ticker}`);
  console.log(`amount=${plan.amount}`);
  console.log(`amountUsd=${plan.amountUsd}`);
  if (plan.gasRefill) {
    console.log(`gasRefill=${plan.gasRefill}`);
  }
  console.log(`sender=${plan.senderAddress}`);
  console.log(`recipient=${plan.recipient}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  if (plan.gasPreflight) {
    console.log(`gasUnits=${plan.gasPreflight.gasUnits}`);
    console.log(`gasLimit=${plan.gasPreflight.gasLimit}`);
  }
  if (plan.preflightError?.message) {
    console.log(`preflightError=${plan.preflightError.message}`);
  }
  if (plan.gatewayError?.details?.body?.code) {
    console.log(`gatewayCode=${plan.gatewayError.details.body.code}`);
  }
  if (plan.gatewayError?.details?.body?.message || plan.gatewayError?.message) {
    console.log(`gatewayMessage=${plan.gatewayError.details?.body?.message || plan.gatewayError.message}`);
  }
  if (execution?.signerResult?.broadcast?.txHash) {
    console.log(`txHash=${execution.signerResult.broadcast.txHash}`);
  }
  if (execution?.signerResult?.status) {
    console.log(`signerStatus=${execution.signerResult.status}`);
  }
  if (execution?.signerResult?.error?.message) {
    console.log(`signerError=${execution.signerResult.error.message}`);
  }
  if (execution?.signerResult?.policy?.blockers?.length) {
    console.log(`policyBlockers=${execution.signerResult.policy.blockers.join(",")}`);
  }
  const capCheckResult =
    execution?.signerResult?.policy?.results?.find((item) => item?.policy === "cap_check") || execution?.signerResult?.policy || null;
  if (capCheckResult?.state?.dailyVolumeUsd !== undefined) {
    console.log(`policyDailyVolumeUsd=${capCheckResult.state.dailyVolumeUsd}`);
  }
  if (capCheckResult?.state?.perChainVolumeUsd?.[plan.route.srcChain] !== undefined) {
    console.log(`policyPerChainVolumeUsd=${capCheckResult.state.perChainVolumeUsd[plan.route.srcChain]}`);
  }
  if (capCheckResult?.state?.attemptedCount24h !== undefined) {
    console.log(`policyAttemptedCount24h=${capCheckResult.state.attemptedCount24h}`);
  }
  if (capCheckResult?.metrics?.amountUsd !== undefined) {
    console.log(`policyAmountUsd=${capCheckResult.metrics.amountUsd}`);
  }
  if (capCheckResult?.metrics?.perTxUsd !== undefined) {
    console.log(`policyPerTxUsd=${capCheckResult.metrics.perTxUsd}`);
  }
  if (capCheckResult?.metrics?.perDayUsd !== undefined) {
    console.log(`policyPerDayUsd=${capCheckResult.metrics.perDayUsd}`);
  }
  if (capCheckResult?.metrics?.perChainUsd !== undefined) {
    console.log(`policyPerChainUsd=${capCheckResult.metrics.perChainUsd}`);
  }
  if (execution?.settlementStatus) {
    console.log(`settlementStatus=${execution.settlementStatus}`);
  }
  if (execution?.destinationProof) {
    console.log(`destinationProofSource=${execution.destinationProof.proofSource}`);
    console.log(`destinationObservedDelta=${execution.destinationProof.observedDelta}`);
    console.log(`destinationRequiredDelta=${execution.destinationProof.requiredDelta}`);
  }
  if (execution?.layerZeroMessageStatus?.status) {
    console.log(`layerZeroStatus=${execution.layerZeroMessageStatus.status}`);
  }
  if (execution?.layerZeroMessageStatus?.destinationStatus) {
    console.log(`layerZeroDestinationStatus=${execution.layerZeroMessageStatus.destinationStatus}`);
  }
  if (execution?.layerZeroMessageStatus?.waitingRequiredDvns?.length) {
    console.log(`layerZeroWaitingRequiredDvns=${execution.layerZeroMessageStatus.waitingRequiredDvns.map((item) => item.address).join(",")}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
