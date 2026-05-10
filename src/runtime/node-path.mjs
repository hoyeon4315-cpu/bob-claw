import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

export const DEFAULT_NODE_CANDIDATES = Object.freeze([
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
]);

function executableExists(path, fileExists = existsSync) {
  if (!path) return false;
  try {
    return fileExists(path) === true;
  } catch {
    return false;
  }
}

function pathCandidatesFromEnv(pathEnv = process.env.PATH || "") {
  return String(pathEnv || "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, "node"));
}

export function resolveNodeExecutable({
  requestedPath = null,
  envNodePath = process.env.BOB_CLAW_NODE_PATH || null,
  pathEnv = process.env.PATH || "",
  fileExists = existsSync,
} = {}) {
  if (requestedPath) return isAbsolute(requestedPath) ? resolve(requestedPath) : requestedPath;

  const candidates = [
    envNodePath,
    ...DEFAULT_NODE_CANDIDATES,
    ...pathCandidatesFromEnv(pathEnv),
    process.execPath,
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (executableExists(candidate, fileExists)) return candidate;
  }
  return process.execPath || "node";
}
