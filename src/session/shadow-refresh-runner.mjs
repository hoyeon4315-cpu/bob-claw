import { spawn } from "node:child_process";

export const DEFAULT_ALLOWED_QUEUE_SCRIPTS = new Set([
  "advance:canary",
  "analyze:ethereum-routes",
  "audit:eth-family-overfit",
  "check:estimator-wallet",
  "estimate:gateway-gas",
  "plan:prelive-fork-execution",
  "plan:treasury-actions",
  "plan:treasury-funding-sources",
  "price:snapshot",
  "scan:quote-surface",
  "quote:dex",
  "report:prelive-readiness",
  "report:route-performance",
  "run:prelive-simulations",
  "score:gateway",
  "status:dashboard",
  "verify:gateway",
]);

function summarizeOutput(text, limit = 320) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (value.length <= limit) return value;
  const head = value.slice(0, Math.floor(limit / 2));
  const tail = value.slice(-Math.floor(limit / 2));
  return `${head}\n...\n${tail}`;
}

function hasForbiddenShellSyntax(token) {
  return (
    token.includes(";") ||
    token === "|" ||
    token.includes("||") ||
    token.startsWith(">") ||
    token.startsWith("<") ||
    token.includes("`") ||
    token.includes("$(") ||
    token.includes("${")
  );
}

export function splitCommandSequence(command) {
  const input = String(command || "").trim();
  if (!input) return [];
  const segments = [];
  let current = "";
  let quote = null;
  let escape = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escape = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "&" && next === "&") {
      segments.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unterminated quote in refresh command");
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

export function tokenizeCommandSegment(segment) {
  const input = String(segment || "").trim();
  if (!input) return [];
  const tokens = [];
  let current = "";
  let quote = null;
  let escape = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unterminated quote in refresh command segment");
  if (current) tokens.push(current);
  return tokens;
}

export function parseWhitelistedRefreshCommand(command, { allowedScripts = DEFAULT_ALLOWED_QUEUE_SCRIPTS } = {}) {
  const segments = splitCommandSequence(command);
  if (!segments.length) throw new Error("Refresh command is empty");
  return segments.map((segment) => {
    const tokens = tokenizeCommandSegment(segment);
    if (tokens.length < 3 || tokens[0] !== "npm" || tokens[1] !== "run") {
      throw new Error(`Only 'npm run <script>' commands are allowed: ${segment}`);
    }
    const script = tokens[2];
    if (!allowedScripts.has(script)) {
      throw new Error(`Queue command script is not whitelisted: ${script}`);
    }
    for (const token of tokens) {
      if (hasForbiddenShellSyntax(token)) {
        throw new Error(`Forbidden shell syntax in queue command token: ${token}`);
      }
    }
    return {
      segment,
      script,
      command: tokens[0],
      args: tokens.slice(1),
      tokens,
    };
  });
}

export function defaultRunCommand({ command, args, cwd, env, timeoutMs = null }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? setTimeout(() => {
          stderr = `${stderr}${stderr ? "\n" : ""}Command timed out after ${Number(timeoutMs)}ms`;
          child.kill("SIGTERM");
          finish({
            ok: false,
            exitCode: null,
            signal: "SIGTERM",
            durationMs: Date.now() - startedAt,
            stdout,
            stderr,
          });
        }, Number(timeoutMs))
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
      });
    });
    child.on("close", (exitCode, signal) => {
      finish({
        ok: exitCode === 0,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function parseBooleanSummaryFlag(text, key) {
  const match = String(text || "").match(new RegExp(`${key}=(true|false)`));
  if (!match) return null;
  return match[1] === "true";
}

function classifyWalletReadinessOutcome(executed) {
  const stdout = (executed.steps || [])
    .map((step) => step.stdoutSummary)
    .filter(Boolean)
    .join("\n");
  const stderr = (executed.steps || [])
    .map((step) => step.stderrSummary)
    .filter(Boolean)
    .join("\n");

  if (executed.executionStatus === "failed") {
    if (/AccountStateRpcError|All RPC endpoints failed/i.test(stderr)) {
      return {
        outcomeCategory: "rpc_unavailable",
        readinessStatus: "unknown",
        readinessGaps: [],
        transientFailure: true,
      };
    }
    return {
      outcomeCategory: "wallet_check_failed",
      readinessStatus: "unknown",
      readinessGaps: [],
      transientFailure: false,
    };
  }

  if (executed.executionStatus !== "succeeded") {
    return {
      outcomeCategory: null,
      readinessStatus: null,
      readinessGaps: [],
      transientFailure: false,
    };
  }

  const readinessGaps = [];
  if (parseBooleanSummaryFlag(stdout, "nativeReady") === false) readinessGaps.push("native");
  if (parseBooleanSummaryFlag(stdout, "tokenReady") === false) readinessGaps.push("token");
  if (parseBooleanSummaryFlag(stdout, "allowanceReady") === false) readinessGaps.push("allowance");

  return {
    outcomeCategory: readinessGaps.length > 0 ? "wallet_not_ready" : "wallet_ready",
    readinessStatus: readinessGaps.length > 0 ? "blocked" : "ready",
    readinessGaps,
    transientFailure: false,
  };
}

function classifyRefreshItemOutcome(code, executed) {
  if (code === "check_wallet_readiness") return classifyWalletReadinessOutcome(executed);
  return {
    outcomeCategory: null,
    readinessStatus: null,
    readinessGaps: [],
    transientFailure: false,
  };
}

export function inferRefreshItemOutcome(item) {
  return classifyRefreshItemOutcome(item?.code || null, {
    executionStatus: item?.executionStatus || null,
    steps: item?.steps || [],
  });
}

export async function runParsedRefreshSteps(steps, { cwd = process.cwd(), env = process.env, runCommand = defaultRunCommand } = {}) {
  const executedSteps = [];
  for (const step of steps) {
    const result = await runCommand({
      command: step.command,
      args: step.args,
      cwd,
      env,
      step,
    });
    executedSteps.push({
      script: step.script,
      ok: Boolean(result.ok),
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      durationMs: result.durationMs ?? null,
      stdoutSummary: summarizeOutput(result.stdout),
      stderrSummary: summarizeOutput(result.stderr),
    });
    if (!result.ok) {
      return {
        executionStatus: "failed",
        steps: executedSteps,
      };
    }
  }
  return {
    executionStatus: "succeeded",
    steps: executedSteps,
  };
}

export async function executeRefreshQueueItem(
  item,
  {
    cwd = process.cwd(),
    env = process.env,
    execute = false,
    runCommand = defaultRunCommand,
    allowedScripts = DEFAULT_ALLOWED_QUEUE_SCRIPTS,
    now = new Date().toISOString(),
  } = {},
) {
  const base = {
    schemaVersion: 1,
    observedAt: now,
    rank: item?.rank ?? null,
    priority: item?.priority ?? null,
    scope: item?.scope || null,
    kind: item?.kind || null,
    code: item?.code || null,
    reason: item?.reason || null,
    routeKey: item?.routeKey || null,
    routeLabel: item?.routeLabel || null,
    amount: item?.amount || null,
    command: item?.command || null,
  };
  if (!item?.command) {
    return {
      ...base,
      executionStatus: "invalid",
      invalidReason: "missing_command",
      stepCount: 0,
      steps: [],
    };
  }

  let steps;
  try {
    steps = parseWhitelistedRefreshCommand(item.command, { allowedScripts });
  } catch (error) {
    return {
      ...base,
      executionStatus: "invalid",
      invalidReason: error.message,
      stepCount: 0,
      steps: [],
    };
  }

  if (!execute) {
    return {
      ...base,
      executionStatus: "preview",
      invalidReason: null,
      stepCount: steps.length,
      steps: steps.map((step) => ({
        script: step.script,
        ok: null,
        exitCode: null,
        durationMs: null,
        stdoutSummary: null,
        stderrSummary: null,
      })),
    };
  }

  const executed = await runParsedRefreshSteps(steps, {
    cwd,
    env,
    runCommand: async (details) => runCommand({ ...details, item }),
  });
  const outcome = classifyRefreshItemOutcome(base.code, executed);

  return {
    ...base,
    executionStatus: executed.executionStatus,
    invalidReason: null,
    stepCount: steps.length,
    steps: executed.steps,
    outcomeCategory: outcome.outcomeCategory,
    readinessStatus: outcome.readinessStatus,
    readinessGaps: outcome.readinessGaps,
    transientFailure: outcome.transientFailure,
  };
}

export function buildShadowRefreshExecutionSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const successCount = sorted.filter((item) => item.executionStatus === "succeeded").length;
  const failureCount = sorted.filter((item) => item.executionStatus === "failed").length;
  const previewCount = sorted.filter((item) => item.executionStatus === "preview").length;
  const invalidCount = sorted.filter((item) => item.executionStatus === "invalid").length;
  const latest = sorted[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: sorted.length,
    successCount,
    failureCount,
    previewCount,
    invalidCount,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: latest?.executionStatus || null,
    recentExecutions: sorted.slice(0, 5).map((item) => ({
      observedAt: item.observedAt,
      rank: item.rank ?? null,
      scope: item.scope || null,
      code: item.code || null,
      routeLabel: item.routeLabel || item.routeKey || null,
      amount: item.amount || null,
      executionStatus: item.executionStatus || null,
      invalidReason: item.invalidReason || null,
      outcomeCategory: item.outcomeCategory || null,
      readinessStatus: item.readinessStatus || null,
      readinessGaps: item.readinessGaps || [],
      transientFailure: Boolean(item.transientFailure),
      stepCount: item.stepCount ?? 0,
      scripts: (item.steps || []).map((step) => step.script),
      lastStepExitCode: item.steps?.length ? item.steps[item.steps.length - 1].exitCode : null,
    })),
  };
}
