import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeHeartbeat({
  path = "./state/executor-heartbeat.json",
  metadata = {},
  now = new Date().toISOString(),
} = {}) {
  const payload = {
    schemaVersion: 1,
    updatedAt: now,
    pid: process.pid,
    ...metadata,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export async function readHeartbeat(path = "./state/executor-heartbeat.json") {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function evaluateWatchdogHeartbeat({
  heartbeat,
  now = new Date().toISOString(),
  ttlMs = 60_000,
} = {}) {
  if (!heartbeat?.updatedAt) {
    return {
      status: "missing",
      stale: true,
      ageMs: null,
    };
  }
  const ageMs = new Date(now).getTime() - new Date(heartbeat.updatedAt).getTime();
  return {
    status: ageMs > ttlMs ? "stale" : "healthy",
    stale: ageMs > ttlMs,
    ageMs,
    ttlMs,
  };
}
