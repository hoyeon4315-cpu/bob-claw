import { spawn } from "node:child_process";

export const DEFAULT_RECEIPT_AUTO_INGEST_TIMEOUT_MS = 60_000;
export const RECEIPT_AUTO_INGEST_KILL_GRACE_MS = 5_000;

export class ReceiptAutoIngestTimeoutError extends Error {
  constructor({ timeoutMs, command } = {}) {
    super(`Receipt auto-ingest timed out after ${timeoutMs}ms`);
    this.name = "ReceiptAutoIngestTimeoutError";
    this.timeoutMs = timeoutMs;
    this.command = command;
    this.timedOut = true;
  }
}

function nonEmptyList(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function numericList(values = []) {
  return (values || []).map((value) => Number(value)).filter(Number.isFinite);
}

function appendIfFinite(args, flag, value) {
  if (Number.isFinite(value)) {
    args.push(`${flag}=${value}`);
  }
}

function buildWrappedBtcLoopCommand(context = {}) {
  const scenario = context.scenario || context.scenarioId || "healthy_baseline";
  const executionMode = context.executionMode || "signer_backed_receipt";
  const result =
    context.result ||
    (context.receipt?.status === 0 ? "failed" : null) ||
    "passed";
  const entryTxHashes = nonEmptyList(context.entryTxHashes || (context.txHash ? [context.txHash] : []));
  const unwindTxHashes = nonEmptyList(context.unwindTxHashes || []);
  const observedHealthFactorPath = numericList(context.observedHealthFactorPath || []);
  const observedLiquidationBufferPath = numericList(context.observedLiquidationBufferPath || []);
  const args = [
    "run",
    "ingest:wrapped-btc-loop-receipt",
    "--",
    "--write",
    "--no-refresh-live-packet",
    `--scenario=${scenario}`,
    `--execution-mode=${executionMode}`,
    `--result=${result}`,
  ];

  if (entryTxHashes.length === 0 || unwindTxHashes.length === 0) {
    return null;
  }

  args.push(`--entry-tx-hashes=${entryTxHashes.join(",")}`);
  args.push(`--unwind-tx-hashes=${unwindTxHashes.join(",")}`);
  if (observedHealthFactorPath.length > 0) {
    args.push(`--health-factor-path=${observedHealthFactorPath.join(",")}`);
  }
  if (observedLiquidationBufferPath.length > 0) {
    args.push(`--liquidation-buffer-path=${observedLiquidationBufferPath.join(",")}`);
  }
  appendIfFinite(args, "--actual-loop-fees-usd", Number(context.actualLoopFeesUsd));
  appendIfFinite(args, "--actual-unwind-cost-usd", Number(context.actualUnwindCostUsd));
  appendIfFinite(args, "--realized-net-carry-usd", Number(context.realizedNetCarryUsd));
  if (context.observedAt) args.push(`--observed-at=${context.observedAt}`);
  const notes = nonEmptyList(context.notes || []);
  if (notes.length > 0) args.push(`--notes=${notes.join("|")}`);
  return {
    command: "npm",
    args,
  };
}

export function buildAutoIngestCommand(context = {}) {
  if (context.strategyId === "wrapped-btc-loop-base-moonwell") {
    return buildWrappedBtcLoopCommand(context);
  }
  if (context.jobId && context.txHash) {
    const args = [
      "run",
      "ingest:execution-receipt",
      "--",
      `--job-id=${context.jobId}`,
      `--tx-hash=${context.txHash}`,
    ];
    if (context.routeKey) args.push(`--route-key=${context.routeKey}`);
    if (context.amount) args.push(`--amount=${context.amount}`);
    if (context.outputChain) args.push(`--output-chain=${context.outputChain}`);
    if (context.outputToken) args.push(`--output-token=${context.outputToken}`);
    if (context.actualOutputUnits) args.push(`--actual-output-units=${context.actualOutputUnits}`);
    if (Number.isFinite(context.actualOutputUsd)) args.push(`--actual-output-usd=${context.actualOutputUsd}`);
    return {
      command: "npm",
      args,
    };
  }
  return null;
}

export async function runReceiptAutoIngest({
  context,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_RECEIPT_AUTO_INGEST_TIMEOUT_MS,
  spawnImpl = spawn,
} = {}) {
  const command = buildAutoIngestCommand(context);
  if (!command) {
    return {
      ran: false,
      reason: "no_matching_ingest_command",
    };
  }

  const result = await new Promise((resolve) => {
    const child = spawnImpl(command.command, command.args, {
      cwd,
      stdio: "pipe",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timeout = null;
    let killGraceTimeout = null;
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killGraceTimeout) clearTimeout(killGraceTimeout);
      resolve(payload);
    };
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({
        ran: true,
        code: null,
        stdout,
        stderr,
        command,
        error,
      });
    });
    child.on("close", (code) => {
      finish({
        ran: true,
        code,
        stdout,
        stderr,
        command,
      });
    });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        try {
          child.kill?.("SIGTERM");
        } catch {
          // The close/error handlers below still provide the final outcome.
        }
        killGraceTimeout = setTimeout(() => {
          try {
            child.kill?.("SIGKILL");
          } catch {
            // If the process already exited, there is nothing more to do.
          }
          finish({
            ran: true,
            code: null,
            signal: "SIGKILL",
            stdout,
            stderr,
            command,
            timedOut: true,
            timeoutMs,
          });
        }, RECEIPT_AUTO_INGEST_KILL_GRACE_MS);
      }, timeoutMs);
    }
  });

  if (result.timedOut) {
    throw new ReceiptAutoIngestTimeoutError({ timeoutMs, command });
  }
  if (result.error) {
    throw result.error;
  }
  if (result.code !== 0) {
    throw new Error(`Auto-ingest failed with code ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result;
}
