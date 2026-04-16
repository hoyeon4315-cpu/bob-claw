import { spawn } from "node:child_process";

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
    `--scenario=${scenario}`,
    `--execution-mode=${executionMode}`,
    `--result=${result}`,
  ];

  if (
    entryTxHashes.length === 0 ||
    unwindTxHashes.length === 0 ||
    observedHealthFactorPath.length === 0 ||
    observedLiquidationBufferPath.length === 0 ||
    !Number.isFinite(Number(context.actualLoopFeesUsd)) ||
    !Number.isFinite(Number(context.actualUnwindCostUsd)) ||
    !Number.isFinite(Number(context.realizedNetCarryUsd))
  ) {
    return null;
  }

  args.push(`--entry-tx-hashes=${entryTxHashes.join(",")}`);
  args.push(`--unwind-tx-hashes=${unwindTxHashes.join(",")}`);
  args.push(`--health-factor-path=${observedHealthFactorPath.join(",")}`);
  args.push(`--liquidation-buffer-path=${observedLiquidationBufferPath.join(",")}`);
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
} = {}) {
  const command = buildAutoIngestCommand(context);
  if (!command) {
    return {
      ran: false,
      reason: "no_matching_ingest_command",
    };
  }

  const result = await new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd,
      stdio: "pipe",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        ran: true,
        code,
        stdout,
        stderr,
        command,
      });
    });
  });

  if (result.code !== 0) {
    throw new Error(`Auto-ingest failed with code ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result;
}
