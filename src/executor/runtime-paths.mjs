import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const DEFAULT_HEARTBEAT_RELATIVE_PATH = "./state/executor-heartbeat.json";
export const DEFAULT_SIGNER_SOCKET_RELATIVE_PATH = "./state/executor-signer.sock";
export const UNIX_SOCKET_PATH_SOFT_LIMIT_BYTES = 96;

function workspaceSlug(cwd = process.cwd()) {
  const resolved = resolve(cwd);
  const base =
    basename(resolved)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 24) || "workspace";
  const hash = createHash("sha1").update(resolved).digest("hex").slice(0, 10);
  return `${base}-${hash}`;
}

function useShortSocketPath(candidatePath) {
  return Buffer.byteLength(candidatePath, "utf8") > UNIX_SOCKET_PATH_SOFT_LIMIT_BYTES;
}

export function resolveExecutorRuntimePaths({ cwd = process.cwd(), homeDir = process.env.HOME || homedir() } = {}) {
  const resolvedCwd = resolve(cwd);
  const defaultSocketPath = resolve(resolvedCwd, DEFAULT_SIGNER_SOCKET_RELATIVE_PATH);
  const defaultHeartbeatPath = resolve(resolvedCwd, DEFAULT_HEARTBEAT_RELATIVE_PATH);
  if (!useShortSocketPath(defaultSocketPath)) {
    return {
      socketPath: defaultSocketPath,
      heartbeatPath: defaultHeartbeatPath,
      runtimeDir: resolve(resolvedCwd, "./state"),
      shortPathFallback: false,
    };
  }
  const runtimeDir = join(homeDir, ".bob-claw", "runtime", workspaceSlug(resolvedCwd));
  return {
    socketPath: join(runtimeDir, "executor-signer.sock"),
    heartbeatPath: join(runtimeDir, "executor-heartbeat.json"),
    runtimeDir,
    shortPathFallback: true,
  };
}

export function resolveDefaultSignerSocketPath(options = {}) {
  return resolveExecutorRuntimePaths(options).socketPath;
}

export function resolveDefaultHeartbeatPath(options = {}) {
  return resolveExecutorRuntimePaths(options).heartbeatPath;
}
