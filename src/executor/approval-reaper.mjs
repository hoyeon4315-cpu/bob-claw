import { Interface } from "ethers";

const ERC20_INTERFACE = new Interface(["function approve(address spender,uint256 amount)"]);
const DEFAULT_IDLE_TTL_MS = 3_600_000;

function normalizeAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value)
    ? value.toLowerCase()
    : null;
}

function rawBigInt(value, fallback = 0n) {
  try {
    if (value === null || value === undefined || value === "") return fallback;
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function finiteTimeMs(value) {
  const time = value ? new Date(value).getTime() : null;
  return Number.isFinite(time) ? time : null;
}

function allowanceKey(chain, token, spender) {
  const tokenKey = normalizeAddress(token);
  const spenderKey = normalizeAddress(spender);
  if (!chain || !tokenKey || !spenderKey) return null;
  return `${String(chain).toLowerCase()}:${tokenKey}:${spenderKey}`;
}

function latestIso(left, right) {
  const leftMs = finiteTimeMs(left);
  const rightMs = finiteTimeMs(right);
  if (leftMs === null) return right || null;
  if (rightMs === null) return left || null;
  return rightMs > leftMs ? right : left;
}

function compactAddress(value) {
  const normalized = normalizeAddress(value);
  if (!normalized) return null;
  return `${normalized.slice(0, 6)}...${normalized.slice(-3)}`;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function collectApprovals(value, context = {}, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectApprovals(item, context, out);
    return out;
  }
  if (!isPlainObject(value)) return out;

  const nextContext = {
    strategyId: value.strategyId || context.strategyId || null,
    chain: value.chain || context.chain || null,
    observedAt: value.observedAt || value.timestamp || context.observedAt || null,
  };
  if (isPlainObject(value.approval)) {
    out.push({
      strategyId: nextContext.strategyId,
      chain: nextContext.chain,
      token: value.approval.token,
      spender: value.approval.spender,
      lastApprovedAmountRaw: value.approval.amount != null ? String(value.approval.amount) : null,
      lastActiveAt: nextContext.observedAt,
      source: "plan_artifact",
    });
  }
  for (const entry of Object.values(value)) collectApprovals(entry, nextContext, out);
  return out;
}

export function extractApprovalWatchlist(records = []) {
  const approvals = collectApprovals(records);
  const byKey = new Map();
  for (const item of approvals) {
    const key = allowanceKey(item.chain, item.token, item.spender);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      ...item,
      chain: String(item.chain).toLowerCase(),
      token: normalizeAddress(item.token),
      spender: normalizeAddress(item.spender),
      lastActiveAt: latestIso(existing?.lastActiveAt, item.lastActiveAt),
      lastApprovedAmountRaw: item.lastApprovedAmountRaw || existing?.lastApprovedAmountRaw || null,
      source: existing?.source || item.source || "plan_artifact",
    });
  }
  return [...byKey.values()].sort((left, right) => allowanceKey(left.chain, left.token, left.spender).localeCompare(
    allowanceKey(right.chain, right.token, right.spender),
  ));
}

function classifyWatchItem({
  item,
  allowance,
  nowMs,
  idleTtlMs,
}) {
  const allowanceRaw = rawBigInt(allowance?.allowanceRaw ?? allowance?.allowance);
  const balanceRaw = rawBigInt(allowance?.balanceRaw ?? allowance?.balance);
  const maxApprovalRaw = allowance?.maxApprovalRaw ?? item.maxApprovalRaw;
  const maxRaw = maxApprovalRaw == null ? null : rawBigInt(maxApprovalRaw, null);
  const lastActiveMs = finiteTimeMs(item.lastActiveAt);
  const ageMs = lastActiveMs === null ? null : nowMs - lastActiveMs;
  const exposureRaw = allowanceRaw < balanceRaw ? allowanceRaw : balanceRaw;

  let status = "zero";
  if (allowanceRaw > 0n) {
    if (!item.strategyId) status = "unknown_source";
    else if (item.activeExecution === true || item.pendingSignerLifecycle === true) status = "active_in_flight";
    else if (maxRaw !== null && allowanceRaw > maxRaw) status = "over_cap";
    else if (ageMs !== null && ageMs >= 0 && ageMs < idleTtlMs) status = "active_recent";
    else status = "stale_nonzero";
  }

  const revocable = status === "stale_nonzero" || status === "over_cap";
  return {
    ...item,
    allowanceRaw: allowanceRaw.toString(),
    balanceRaw: balanceRaw.toString(),
    exposureRaw: exposureRaw.toString(),
    ageMs,
    status,
    revocable,
    rpcUrl: allowance?.rpcUrl || null,
  };
}

export function buildApprovalRevokeIntent(item = {}, { now = new Date().toISOString(), gasLimit = "85000" } = {}) {
  const chain = item.chain ? String(item.chain).toLowerCase() : null;
  const token = normalizeAddress(item.token);
  const spender = normalizeAddress(item.spender);
  if (!item.strategyId) throw new Error("approval_revoke_strategy_missing");
  if (!chain || !token || !spender) throw new Error("approval_revoke_target_missing");
  return {
    schemaVersion: 1,
    intentId: `${item.strategyId}:approval-reaper:${chain}:${token}:${spender}`,
    strategyId: item.strategyId,
    chain,
    intentType: "approve_exact",
    amountUsd: 0,
    observedAt: now,
    ttlExpiresAt: new Date(new Date(now).getTime() + 60_000).toISOString(),
    approval: {
      token,
      spender,
      amount: "0",
      mode: "per_tx",
      revokeWhenIdle: true,
    },
    tx: {
      chain,
      to: token,
      data: ERC20_INTERFACE.encodeFunctionData("approve", [spender, 0]),
      valueWei: "0",
      gasLimit,
    },
    metadata: {
      expectedTxTo: token,
      approvalReaper: true,
      approvalReaperSource: item.source || null,
      revokedSpender: spender,
      priorAllowanceRaw: item.allowanceRaw || null,
      exposureRaw: item.exposureRaw || null,
    },
  };
}

export function buildApprovalReaperReport({
  owner = null,
  now = new Date().toISOString(),
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  watchlist = [],
  allowanceState = {},
} = {}) {
  const nowMs = new Date(now).getTime();
  const items = (watchlist || [])
    .map((item) => {
      const key = allowanceKey(item.chain, item.token, item.spender);
      return classifyWatchItem({
        item: {
          ...item,
          chain: item.chain ? String(item.chain).toLowerCase() : null,
          token: normalizeAddress(item.token),
          spender: normalizeAddress(item.spender),
        },
        allowance: key ? allowanceState[key] : null,
        nowMs,
        idleTtlMs,
      });
    })
    .sort((left, right) => {
      if (left.revocable !== right.revocable) return left.revocable ? -1 : 1;
      return allowanceKey(left.chain, left.token, left.spender).localeCompare(allowanceKey(right.chain, right.token, right.spender));
    });
  const revocationIntents = items
    .filter((item) => item.revocable)
    .map((item) => buildApprovalRevokeIntent(item, { now }));
  const summary = {
    owner,
    watchlistCount: items.length,
    nonzeroCount: items.filter((item) => rawBigInt(item.allowanceRaw) > 0n).length,
    staleNonzeroCount: items.filter((item) => item.status === "stale_nonzero").length,
    overCapCount: items.filter((item) => item.status === "over_cap").length,
    unknownSourceCount: items.filter((item) => item.status === "unknown_source").length,
    activeCount: items.filter((item) => item.status === "active_in_flight" || item.status === "active_recent").length,
    revocableCount: revocationIntents.length,
  };
  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    summary: Object.freeze(summary),
    items: Object.freeze(items.map(Object.freeze)),
    revocationIntents: Object.freeze(revocationIntents.map(Object.freeze)),
  });
}

export function redactApprovalExposure(item = {}) {
  return {
    chain: item.chain || null,
    token: compactAddress(item.token),
    symbol: item.symbol || null,
    spender: compactAddress(item.spender),
    status: item.status || null,
    allowanceRaw: item.allowanceRaw != null ? String(item.allowanceRaw) : null,
    exposureRaw: item.exposureRaw != null ? String(item.exposureRaw) : null,
    revocable: item.revocable === true,
  };
}

export function buildApprovalExposureSlice(report = {}) {
  const items = (report.items || []).map(redactApprovalExposure);
  const summary = { ...(report.summary || {}) };
  if (summary.owner) summary.owner = compactAddress(summary.owner);
  return Object.freeze({
    schemaVersion: 1,
    observedAt: report.observedAt || null,
    summary: Object.freeze(summary),
    items: Object.freeze(items.map(Object.freeze)),
  });
}

async function buildAllowanceState({ watchlist, readAllowance, readBalance }) {
  const entries = await Promise.all((watchlist || []).map(async (item) => {
    const key = allowanceKey(item.chain, item.token, item.spender);
    if (!key) return null;
    const [allowance, balance] = await Promise.all([
      readAllowance ? readAllowance(item) : null,
      readBalance ? readBalance(item) : null,
    ]);
    return [
      key,
      {
        ...(allowance || {}),
        ...(balance || {}),
      },
    ];
  }));
  return Object.fromEntries(entries.filter(Boolean));
}

export async function runApprovalReaper({
  owner = null,
  now = new Date().toISOString(),
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  watchlist = [],
  allowanceState = null,
  readAllowance = null,
  readBalance = null,
  execute = false,
  awaitConfirmation = true,
  confirmations = 1,
  timeoutMs = 120_000,
  sendSignerCommandImpl = null,
} = {}) {
  const resolvedAllowanceState = allowanceState || await buildAllowanceState({ watchlist, readAllowance, readBalance });
  const report = buildApprovalReaperReport({
    owner,
    now,
    idleTtlMs,
    watchlist,
    allowanceState: resolvedAllowanceState,
  });
  const results = [];
  if (execute) {
    if (typeof sendSignerCommandImpl !== "function") throw new Error("approval_reaper_signer_missing");
    for (const intent of report.revocationIntents) {
      const result = await sendSignerCommandImpl({
        message: {
          command: "sign_and_broadcast",
          intent,
          awaitConfirmation,
          confirmations,
          timeoutMs,
        },
      });
      results.push({
        intentId: intent.intentId,
        chain: intent.chain,
        token: intent.approval.token,
        spender: intent.approval.spender,
        status: result?.status || result?.policyVerdict || "unknown",
        result,
      });
    }
  }
  return Object.freeze({
    ...report,
    execution: Object.freeze({
      mode: execute ? "execute" : "dry_run",
      attemptedCount: results.length,
      results: Object.freeze(results.map(Object.freeze)),
    }),
  });
}
