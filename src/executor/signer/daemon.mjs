#!/usr/bin/env node

import net from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config, getBooleanEnv, getEnv, getNumberEnv } from "../../config/env.mjs";
import { readJsonl } from "../../lib/jsonl-read.mjs";
import { runReceiptAutoIngest } from "../ingestor/receipt-auto-ingest.mjs";
import { evaluateIntentPolicies } from "../policy/index.mjs";
import { appendSignerAuditRecord, buildSignerAuditRecord, readSignerAuditLog } from "./audit-log.mjs";
import { notifyPolicyRejection } from "./policy-alerts.mjs";
import { notifyLiveTransaction } from "./transaction-alerts.mjs";
import { createBtcLocalKeySigner } from "./btc-local-signer.mjs";
import { createEvmLocalKeySigner } from "./evm-local-signer.mjs";
import { normalizeExecutionIntent } from "./signer-interface.mjs";
import { writeHeartbeat } from "../watchdog/heartbeat.mjs";
import { checkKillSwitch, resolveKillSwitchPath } from "../policy/kill-switch.mjs";
import { loadRuntimeRiskContext } from "../runtime/risk-context.mjs";

export function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    socketPath: options["socket-path"] || getEnv("EXECUTOR_SIGNER_SOCKET_PATH", "./state/executor-signer.sock"),
    heartbeatPath: options["heartbeat-path"] || getEnv("EXECUTOR_HEARTBEAT_PATH", "./state/executor-heartbeat.json"),
    heartbeatIntervalMs: getNumberEnv("EXECUTOR_HEARTBEAT_INTERVAL_MS", 15_000),
    killSwitchPath: resolveKillSwitchPath(),
    activeBudgetUsd: null,
    autoIngest: !flags.has("--no-auto-ingest") && getBooleanEnv("EXECUTOR_AUTO_INGEST", true),
  };
}

function selectSigner(signers, intent) {
  if (intent.family === "evm") return signers.evm;
  if (intent.family === "btc") return signers.btc;
  throw new Error(`Unsupported signer family: ${intent.family}`);
}

function redactSignedEnvelope(signed = {}) {
  if (!signed || typeof signed !== "object") return null;
  const { signedTx: _signedTx, ...redacted } = signed;
  return {
    ...redacted,
    redacted: true,
  };
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "bigint" ? value.toString() : String(value);
}

function serializeReceipt(receipt) {
  if (!receipt) return null;
  const gasUsed = toStringOrNull(receipt.gasUsed);
  const gasPrice = toStringOrNull(receipt.gasPrice);
  const effectiveGasPrice = toStringOrNull(receipt.effectiveGasPrice);
  const fee =
    receipt.fee !== null && receipt.fee !== undefined
      ? toStringOrNull(receipt.fee)
      : gasUsed && (effectiveGasPrice || gasPrice)
        ? (BigInt(gasUsed) * BigInt(effectiveGasPrice || gasPrice)).toString()
        : null;
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed,
    gasPrice,
    effectiveGasPrice,
    fee,
  };
}

function mergeCurrentAllocations(primary = null, fallback = null) {
  const out = {};
  const keys = new Set([
    ...Object.keys(fallback || {}),
    ...Object.keys(primary || {}),
  ]);
  for (const key of keys) {
    const primaryValue = primary?.[key];
    const fallbackValue = fallback?.[key];
    if (
      primaryValue &&
      typeof primaryValue === "object" &&
      !Array.isArray(primaryValue) &&
      fallbackValue &&
      typeof fallbackValue === "object" &&
      !Array.isArray(fallbackValue)
    ) {
      out[key] = { ...fallbackValue, ...primaryValue };
    } else {
      out[key] = primaryValue ?? fallbackValue;
    }
  }
  return out;
}

async function readAddressOrNull(getter) {
  try {
    return await getter();
  } catch {
    return null;
  }
}

async function readAddressInfoOrNull(getter) {
  try {
    return await getter();
  } catch {
    return null;
  }
}

export async function handleIntentCommand({
  message,
  signers,
  args,
  cwd,
  transactionNotifyImpl = null,
  loadRuntimeRiskContextImpl = loadRuntimeRiskContext,
}) {
  const intent = normalizeExecutionIntent(message.intent);
  const [auditRecords, receiptRecords] = await Promise.all([
    readSignerAuditLog({ rootDir: cwd }),
    readJsonl(resolve(cwd, config.dataDir), "receipt-reconciliations"),
  ]);
  const runtimeRiskContext = await loadRuntimeRiskContextImpl({
    rootDir: cwd,
    activeBudgetUsd: args.activeBudgetUsd,
    now: intent.observedAt || new Date().toISOString(),
  });
  const metadataRiskContext = intent.metadata?.riskContext || null;
  const riskContext = {
    ...(runtimeRiskContext || {}),
    ...(metadataRiskContext || {}),
    currentAllocations: mergeCurrentAllocations(
      metadataRiskContext?.currentAllocations,
      runtimeRiskContext?.currentAllocations,
    ),
    totalOperatingCapitalUsd:
      metadataRiskContext?.totalOperatingCapitalUsd ??
      runtimeRiskContext?.totalOperatingCapitalUsd ??
      null,
  };
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords,
    receiptRecords,
    activeBudgetUsd: args.activeBudgetUsd,
    killSwitchPath: args.killSwitchPath,
    riskContext,
  });

  if (policy.decision !== "ALLOW") {
    const rejected = buildSignerAuditRecord({
      intent,
      policyVerdict: "rejected",
      lifecycle: {
        stage: "rejected",
        blockers: policy.blockers,
      },
    });
    await appendSignerAuditRecord(rejected, { rootDir: cwd });
    const notification = await notifyPolicyRejection({ intent, policy });
    return {
      status: "rejected",
      policy,
      notification,
      requiresUnwind: policy.requiresUnwind || false,
      emergencyUnwindPath: policy.emergencyUnwindPath || null,
    };
  }

  const signer = selectSigner(signers, intent);
  try {
    const signed = await signer.signIntent(intent, {
      reserveNonce: message.command !== "sign_only",
    });
    await appendSignerAuditRecord(
      buildSignerAuditRecord({
        intent,
        policyVerdict: "approved",
        lifecycle: {
          stage: "signed",
          txHash: signed.txHash,
          signer: signed.metadata || null,
        },
      }),
      { rootDir: cwd },
    );

    let broadcast = null;
    let receipt = null;
    let autoIngest = null;
    let transactionNotification = null;

    if (message.command === "sign_and_broadcast") {
      const broadcastKillSwitch = await checkKillSwitch({
        killSwitchPath: args.killSwitchPath ?? resolveKillSwitchPath(),
      });
      if (broadcastKillSwitch.decision !== "ALLOW") {
        const rejected = buildSignerAuditRecord({
          intent,
          policyVerdict: "rejected",
          lifecycle: {
            stage: "rejected",
            txHash: signed.txHash,
            blockers: broadcastKillSwitch.blockers,
            signedTxVoided: true,
          },
        });
        await appendSignerAuditRecord(rejected, { rootDir: cwd });
        const notification = await notifyPolicyRejection({ intent, policy: broadcastKillSwitch });
        return {
          status: "rejected",
          policy: broadcastKillSwitch,
          notification,
          requiresUnwind: false,
          emergencyUnwindPath: null,
          signed: redactSignedEnvelope(signed),
        };
      }
      broadcast = await signer.broadcastSignedIntent(signed);
      await appendSignerAuditRecord(
        buildSignerAuditRecord({
          intent,
          policyVerdict: "approved",
        lifecycle: {
          stage: "broadcasted",
          txHash: broadcast.txHash,
          signer: signed.metadata || null,
        },
          broadcast,
        }),
        { rootDir: cwd },
      );
      if (message.awaitConfirmation !== true) {
        transactionNotification = await notifyLiveTransaction({
          intent,
          broadcast,
          stage: "broadcasted",
          ...(transactionNotifyImpl ? { sendImpl: transactionNotifyImpl } : {}),
        }).catch((error) => ({
          sent: false,
          skipped: false,
          reason: "telegram_send_failed",
          error: {
            name: error.name,
            message: error.message,
          },
        }));
      }

      if (message.awaitConfirmation === true && intent.family === "evm") {
        receipt = await signer.waitForTransaction(intent.chain, broadcast.txHash, {
          confirmations: Number.isFinite(message.confirmations) ? message.confirmations : 1,
          timeoutMs: Number.isFinite(message.timeoutMs) ? message.timeoutMs : 120_000,
        });
        const serializedReceipt = serializeReceipt(receipt);
        await appendSignerAuditRecord(
          buildSignerAuditRecord({
            intent,
            policyVerdict: receipt?.status === 0 ? "errored" : "approved",
            lifecycle: {
              stage: receipt?.status === 0 ? "reverted" : "confirmed",
              txHash: broadcast.txHash,
            },
            broadcast,
            realized: serializedReceipt
              ? {
                  ...serializedReceipt,
                  actualKnownCostUsd: null,
                  ...(intent.intentType === "emergency_unwind"
                    ? {
                        healthFactorPath: intent.metadata?.healthFactorPath ?? null,
                        liquidationBufferPath: intent.metadata?.liquidationBufferPath ?? null,
                        slippagePct: intent.metadata?.slippagePct ?? null,
                        realizedNetPnlBtc: intent.metadata?.realizedNetPnlBtc ?? null,
                      }
                    : {}),
                }
              : null,
            error:
              receipt?.status === 0
                ? {
                    name: "EvmReceiptReverted",
                    message: "Transaction reverted after broadcast",
                  }
                : null,
          }),
          { rootDir: cwd },
        );
        transactionNotification = await notifyLiveTransaction({
          intent,
          broadcast,
          stage: receipt?.status === 0 ? "reverted" : "confirmed",
          ...(transactionNotifyImpl ? { sendImpl: transactionNotifyImpl } : {}),
        }).catch((error) => ({
          sent: false,
          skipped: false,
          reason: "telegram_send_failed",
          error: {
            name: error.name,
            message: error.message,
          },
        }));
        if (receipt?.status === 0) {
          return {
            status: "error",
            policy,
            signed,
            broadcast,
            receipt: serializedReceipt,
            autoIngest: null,
            transactionNotification,
            error: {
              name: "EvmReceiptReverted",
              message: "Transaction reverted after broadcast",
            },
          };
        }
      }

      const serializedReceipt = serializeReceipt(receipt);
      if (
        args.autoIngest &&
        intent.metadata?.skipAutoIngest !== true &&
        (serializedReceipt || intent.metadata?.jobId || intent.strategyId === "wrapped-btc-loop-base-moonwell")
      ) {
        autoIngest = await runReceiptAutoIngest({
          context: {
            strategyId: intent.strategyId,
            txHash: broadcast.txHash,
            chain: intent.chain,
            receipt: serializedReceipt,
            ...intent.metadata,
          },
          cwd,
        }).catch(async (error) => {
          await appendSignerAuditRecord(
            buildSignerAuditRecord({
              intent,
              policyVerdict: "approved",
              lifecycle: {
                stage: "auto_ingest_error",
                txHash: broadcast.txHash,
              },
              error,
            }),
            { rootDir: cwd },
          );
          return {
            ran: true,
            failed: true,
            error: {
              name: error.name,
              message: error.message,
            },
          };
        });
      }
    }

    return {
      status: "ok",
      policy,
      signed: redactSignedEnvelope(signed),
      broadcast,
      receipt: serializeReceipt(receipt),
      autoIngest,
      transactionNotification,
    };
  } catch (error) {
    await appendSignerAuditRecord(
      buildSignerAuditRecord({
        intent,
        policyVerdict: "errored",
        lifecycle: {
          stage: "error",
        },
        error,
      }),
      { rootDir: cwd },
    );
    return {
      status: "error",
      error: {
        name: error.name,
        message: error.message,
      },
    };
  }
}

async function prepareSocket(socketPath) {
  const resolved = resolve(socketPath);
  await mkdir(dirname(resolved), { recursive: true });
  await rm(resolved, { force: true });
  return resolved;
}

export async function startSignerDaemon() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const socketPath = await prepareSocket(args.socketPath);
  const signers = {
    evm: createEvmLocalKeySigner(),
    btc: createBtcLocalKeySigner(),
  };
  const heartbeatMetadata = {
    socketPath,
    status: "listening",
    lastCommand: null,
  };

  async function writeDaemonHeartbeat(extra = {}) {
    Object.assign(heartbeatMetadata, extra);
    await writeHeartbeat({
      path: args.heartbeatPath,
      metadata: heartbeatMetadata,
    });
  }

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", async (chunk) => {
      buffer += chunk;
      const frames = buffer.split("\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        if (!frame.trim()) continue;
        let message;
        try {
          message = JSON.parse(frame);
        } catch (error) {
          socket.write(`${JSON.stringify({ status: "error", error: { message: "invalid_json" } })}\n`);
          continue;
        }

        await writeDaemonHeartbeat({
          lastCommand: message.command || null,
        });

        if (message.command === "health") {
          const baseAddress = await readAddressOrNull(() => signers.evm.getAddress("base"));
          const bitcoinInfo = await readAddressInfoOrNull(() => signers.btc.getAddressInfo("bitcoin"));
          socket.write(
            `${JSON.stringify({
              status: "ok",
              pid: process.pid,
              socketPath,
              addresses: {
                base: baseAddress,
                bitcoin: bitcoinInfo?.address || null,
              },
              addressTypes: {
                bitcoin: bitcoinInfo?.addressType || null,
              },
              addressDetails: {
                bitcoin: bitcoinInfo,
              },
              nonceManagers: signers.evm.describeNonceManagers(),
            })}\n`,
          );
          continue;
        }

        if (!["sign_only", "sign_and_broadcast"].includes(message.command)) {
          socket.write(`${JSON.stringify({ status: "error", error: { message: "unsupported_command" } })}\n`);
          continue;
        }

        try {
          const result = await handleIntentCommand({
            message,
            signers,
            args,
            cwd,
          });
          socket.write(`${JSON.stringify(result)}\n`);
        } catch (error) {
          socket.write(
            `${JSON.stringify({
              status: "error",
              error: {
                name: error.name || "Error",
                message: error.message || "unknown_error",
              },
            })}\n`,
          );
        }
      }
    });
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(socketPath, () => resolvePromise());
  });

  await writeDaemonHeartbeat();
  const heartbeatTimer = setInterval(() => {
    writeDaemonHeartbeat().catch(() => {});
  }, Math.max(1_000, args.heartbeatIntervalMs));
  heartbeatTimer.unref();
  const startupBtcInfo = await readAddressInfoOrNull(() => signers.btc.getAddressInfo("bitcoin"));
  console.log(JSON.stringify({
    status: "listening",
    socketPath,
    btcAddress: startupBtcInfo?.address || null,
    btcAddressType: startupBtcInfo?.addressType || null,
  }));

  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    server.close();
    await rm(socketPath, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSignerDaemon().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
