// Dev lock — file-based coordination flag that pauses the dev-automation
// pipeline (auto-validation, route discovery, auto-promotion runner) while
// the operator is actively coding. Independent of the live kill-switch.
//
// - $DEV_LOCK_PATH set?    use it
// - else                   default ~/.bob-claw/DEV_LOCK
//
// Existence = paused. Removal = resume.
//
// Live execution is NOT affected by this lock. Only the dev-automation CLIs
// check it. Caps, kill-switch, policy engine, signer all behave normally.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveDevLockPath(env = process.env) {
  if (env.DEV_LOCK_PATH && env.DEV_LOCK_PATH.trim().length > 0) {
    return env.DEV_LOCK_PATH;
  }
  const home = env.HOME || homedir();
  return join(home, ".bob-claw", "DEV_LOCK");
}

export function isDevLocked({ path = resolveDevLockPath(), existsImpl = existsSync } = {}) {
  if (!path) return false;
  return existsImpl(path);
}

export function devLockStatus({ path = resolveDevLockPath() } = {}) {
  const locked = isDevLocked({ path });
  let mtime = null;
  if (locked) {
    try {
      mtime = statSync(path).mtime.toISOString();
    } catch {
      mtime = null;
    }
  }
  return { path, locked, mtime };
}

// Convenience for automation CLIs: returns true if the caller should exit
// no-op because the operator is coding. Logs to stderr by default.
export function exitIfDevLocked({
  cliName = "dev-automation",
  path = resolveDevLockPath(),
  logger = (msg) => process.stderr.write(`${msg}\n`),
} = {}) {
  if (isDevLocked({ path })) {
    logger(`[${cliName}] dev-lock active at ${path} — skipping run.`);
    return true;
  }
  return false;
}
