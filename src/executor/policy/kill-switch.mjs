import { access, appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function resolveKillSwitchPath(env = process.env) {
  const home = env.HOME || homedir();
  return env.KILL_SWITCH_PATH || join(home, ".bob-claw", "KILL_SWITCH");
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

function normalizePath(path) {
  if (!path) return null;
  return resolve(path);
}

function parseKeyValueBody(raw = "") {
  const entries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=")];
    })
    .filter(([key]) => key);
  return Object.fromEntries(entries);
}

export function parseKillSwitchFileContents(raw = "") {
  const trimmed = String(raw || "").trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return parseKeyValueBody(trimmed);
  }
}

export async function readLatestKillSwitchAuditRecord({
  auditPath = resolveKillSwitchAuditPath(),
  killSwitchPath = resolveKillSwitchPath(),
} = {}) {
  try {
    const normalizedKillSwitchPath = normalizePath(killSwitchPath);
    const raw = await readFile(resolve(auditPath), "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const record = JSON.parse(lines[index]);
      if (!normalizedKillSwitchPath) return record;
      if (normalizePath(record.killSwitchPath) === normalizedKillSwitchPath) {
        return record;
      }
    }
    return null;
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readKillSwitchStatus({
  killSwitchPath = resolveKillSwitchPath(),
  auditPath = resolveKillSwitchAuditPath(),
} = {}) {
  const lastAudit = await readLatestKillSwitchAuditRecord({ auditPath, killSwitchPath });
  const normalizedKillSwitchPath = normalizePath(killSwitchPath);
  const halted = normalizedKillSwitchPath ? await fileExists(normalizedKillSwitchPath) : false;
  let fileMtime = null;
  let payload = null;
  if (halted) {
    try {
      const [fileStat, raw] = await Promise.all([
        stat(normalizedKillSwitchPath),
        readFile(normalizedKillSwitchPath, "utf8"),
      ]);
      fileMtime = fileStat.mtime.toISOString();
      payload = parseKillSwitchFileContents(raw);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }
  const activeReason =
    payload?.reason ||
    lastAudit?.reason ||
    null;
  const activeActor =
    payload?.actor ||
    lastAudit?.actor ||
    null;
  const activeSince =
    payload?.halted_at ||
    payload?.evaluatedAt ||
    fileMtime ||
    null;
  return {
    killSwitchPath: normalizedKillSwitchPath || killSwitchPath,
    halted,
    fileMtime,
    payload,
    activeReason,
    activeActor,
    activeSince,
    triggers: Array.isArray(payload?.triggers) ? payload.triggers : [],
    lastAudit,
  };
}
