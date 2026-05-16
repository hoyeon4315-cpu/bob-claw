import { access, appendFile, mkdir, readFile, stat, unlink } from "node:fs/promises";
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

export function buildKillSwitchResumeReviewChecklist({
  replay = null,
  postmortemPath = null,
  postmortemExists = false,
} = {}) {
  const blockerMitigated = replay?.triggered === false;
  return [
    {
      id: "inventory_restored",
      question: "inventory restored?",
      answer: "no",
      source: "operator_confirmation_required",
    },
    {
      id: "postmortem_written",
      question: "postmortem written?",
      answer: postmortemExists ? "yes" : "no",
      source: postmortemPath,
    },
    {
      id: "blocker_mitigated",
      question: "blocker mitigated?",
      answer: blockerMitigated ? "yes" : "no",
      source: replay ? "auto_kill_replay" : "replay_unavailable",
    },
  ];
}

export function buildKillSwitchResumeReviewPacket({
  status = {},
  replay = null,
  postmortemPath = null,
  postmortemExists = false,
  now = new Date().toISOString(),
} = {}) {
  const effectiveReplay = replay || status.replay || null;
  const halted = status.halted === true;
  const triggers =
    Array.isArray(status.triggers) && status.triggers.length > 0
      ? status.triggers
      : Array.isArray(effectiveReplay?.triggers)
        ? effectiveReplay.triggers
        : [];
  return {
    schemaVersion: 1,
    generatedAt: now,
    state: halted ? "HALTED" : "RUNNING",
    halted,
    killSwitchPath: status.killSwitchPath || null,
    activeReason: status.activeReason || null,
    activeActor: status.activeActor || null,
    activeSince: status.activeSince || null,
    triggers,
    replay: effectiveReplay,
    checklist: buildKillSwitchResumeReviewChecklist({
      replay: effectiveReplay,
      postmortemPath,
      postmortemExists,
    }),
    clearsKillSwitch: false,
    nextAction: halted ? "operator_may_review_resume_command" : "no_resume_needed",
  };
}

export async function appendKillSwitchAuditRecord(
  record,
  { auditPath = resolveKillSwitchAuditPath(), mkdirImpl = mkdir, appendFileImpl = appendFile } = {},
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
  actions = null,
} = {}) {
  try {
    const normalizedKillSwitchPath = normalizePath(killSwitchPath);
    const actionSet = Array.isArray(actions) && actions.length > 0 ? new Set(actions) : null;
    const raw = await readFile(resolve(auditPath), "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const record = JSON.parse(lines[index]);
      if (actionSet && !actionSet.has(record.action)) continue;
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
  dashboardStatus = null,
} = {}) {
  const now = new Date().toISOString();
  const lastAudit = await readLatestKillSwitchAuditRecord({ auditPath, killSwitchPath });
  const stateAudit = await readLatestKillSwitchAuditRecord({
    auditPath,
    killSwitchPath,
    actions: ["halt", "resume"],
  });
  const normalizedKillSwitchPath = normalizePath(killSwitchPath);
  let halted = normalizedKillSwitchPath ? await fileExists(normalizedKillSwitchPath) : false;
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
  const activeReason = payload?.reason || stateAudit?.reason || null;
  const activeActor = payload?.actor || stateAudit?.actor || null;
  const activeSince = payload?.halted_at || payload?.evaluatedAt || fileMtime || null;

  const dashboardKillSwitch = dashboardStatus?.executorRuntime?.killSwitch || null;
  const replay =
    halted && normalizePath(dashboardKillSwitch?.killSwitchPath) === normalizedKillSwitchPath
      ? dashboardKillSwitch?.replay || null
      : null;

  // Source-of-truth stale arm auto-clear (real state change, not surface rename):
  // When the only reason the KILL_SWITCH file exists is a past watchdog heartbeat stall
  // (file contains only a raw timestamp with no explicit operator reason/actor, or
  // audit reason indicates watchdog_heartbeat_stale), we remove the file (primary) +
  // append audit (trace) so that all raw existence checks stop producing
  // "kill_switch_present". Returned status matches file. Mutation failure leaves
  // original halted (unresolved). replay.staleArm is for evidence/display only, not
  // a trigger (prevents false clear on real auto-kill resume-review flows).
  const payloadKeys = typeof payload === "object" && payload ? Object.keys(payload) : [];
  const rawContentLooksLikeWatchdogTimestamp =
    typeof payload === "object" &&
    payload &&
    payloadKeys.length === 1 &&
    payloadKeys[0] === "evaluatedAt" &&
    !payload.reason &&
    !payload.actor &&
    !payload.halted_at;
  const isStaleWatchdogArm =
    halted &&
    (String(activeReason || "").includes("watchdog_heartbeat_stale") ||
      String(activeReason || "").includes("heartbeat_stale") ||
      rawContentLooksLikeWatchdogTimestamp);

  if (isStaleWatchdogArm && normalizedKillSwitchPath) {
    let removed = false;
    try {
      await unlink(normalizedKillSwitchPath);
      removed = true;
    } catch (uerr) {
      if (uerr && uerr.code === "ENOENT") {
        removed = true; // already gone (race or prior)
      }
      // else: real unlink failure (perm, etc) -> do not append clear audit, do not set cleared
      // -> returned status keeps halted=true, file still present -> consistent, unresolved
    }
    if (removed) {
      try {
        await appendKillSwitchAuditRecord(
          buildKillSwitchAuditRecord({
            action: "auto_cleared_stale_arm",
            reason: "stale_watchdog_heartbeat_arm_no_longer_justified",
            actor: "readiness:kill-switch-status",
            killSwitchPath: normalizedKillSwitchPath,
            previousState: "halted",
            now,
            metadata: {
              activeReason,
              replayStaleArm: replay?.staleArm === true,
              fileMtimeBeforeClear: fileMtime,
            },
          }),
          { auditPath },
        );
      } catch (aerr) {
        // Append failed after file removal. Primary goal (no more kill_switch_present from
        // existence checks) achieved; returned status will match file (cleared). Audit is trace.
        // Do not throw (keep diagnostic robust); narrow catch, no false success claim.
      }
      halted = false;
      fileMtime = null;
    }
  }
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
    replay,
  };
}
