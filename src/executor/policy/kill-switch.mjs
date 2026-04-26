import { access, appendFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";

export function resolveKillSwitchPath(env = process.env) {
  return env.KILL_SWITCH_PATH || null;
}

export function resolveKillSwitchAuditPath(env = process.env) {
  return env.KILL_SWITCH_AUDIT_PATH || "logs/kill-switch-audit.jsonl";
}

export async function fileExists(path) {
  if (!path) return false;
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function buildKillSwitchAuditRecord({
  action,
  reason,
  actor,
  killSwitchPath = resolveKillSwitchPath(),
  previousState = null,
  now = new Date().toISOString(),
  metadata = null,
} = {}) {
  const record = {
    ts: now,
    action,
    reason,
    actor,
    killSwitchPath,
    previousState,
  };
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    record.metadata = metadata;
  }
  return record;
}

export async function appendKillSwitchAuditRecord(
  record,
  {
    auditPath = resolveKillSwitchAuditPath(),
    mkdirImpl = mkdir,
    appendFileImpl = appendFile,
  } = {},
) {
  const resolvedAuditPath = resolve(auditPath);
  await mkdirImpl(dirname(resolvedAuditPath), { recursive: true });
  await appendFileImpl(resolvedAuditPath, `${JSON.stringify(record)}\n`, "utf8");
  return resolvedAuditPath;
}

export async function checkKillSwitch({
  killSwitchPath = resolveKillSwitchPath(),
  existsImpl = fileExists,
  now = new Date().toISOString(),
} = {}) {
  const exists = killSwitchPath ? await existsImpl(killSwitchPath) : false;
  return {
    policy: "kill_switch",
    observedAt: now,
    decision: exists ? "BLOCK" : "ALLOW",
    blockers: exists ? ["kill_switch_present"] : [],
    killSwitchPath,
  };
}
