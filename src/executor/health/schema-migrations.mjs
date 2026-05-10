import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { safeJsonStringify } from "../../lib/json-safe.mjs";

export function featureEnabled(profile = {}) {
  return profile.schemaMigrations !== false;
}

export async function readSchemaVersion(schemaVersionPath = "data/schema-version.json") {
  try {
    const raw = await readFile(schemaVersionPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      schemaVersion: Number(parsed.schemaVersion) || 0,
      updatedAt: parsed.updatedAt || null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { schemaVersion: 0, updatedAt: null };
    }
    throw error;
  }
}

export async function writeSchemaVersion(
  { schemaVersion, updatedAt = new Date().toISOString() },
  schemaVersionPath = "data/schema-version.json",
) {
  await mkdir(dirname(schemaVersionPath), { recursive: true });
  await writeFile(
    schemaVersionPath,
    `${JSON.stringify({ schemaVersion, updatedAt }, null, 2)}\n`,
    "utf8",
  );
}

export async function runMigrations({
  currentVersion = 0,
  targetVersion = 0,
  migrationsDir = "src/migrations",
  schemaVersionPath = "data/schema-version.json",
  auditPath = "logs/schema-migrations.jsonl",
  now = Date.now(),
  dryRun = false,
  profile,
} = {}) {
  if (profile && !featureEnabled(profile)) {
    return { ran: false, reason: "feature_disabled", from: currentVersion, to: targetVersion, steps: [] };
  }

  if (currentVersion >= targetVersion) {
    return { ran: false, reason: "already_at_target", from: currentVersion, to: targetVersion, steps: [] };
  }

  const steps = [];
  let dbState = { version: currentVersion };

  for (let v = currentVersion + 1; v <= targetVersion; v++) {
    const migrationFile = resolve(migrationsDir, `v${v}.mjs`);
    try {
      const mod = await import(migrationFile);
      if (typeof mod.default !== "function") {
        throw new Error(`Migration v${v} does not export a default function`);
      }
      if (!dryRun) {
        dbState = mod.default(dbState);
      }
      steps.push({ version: v, status: dryRun ? "ok_preview" : "ok" });
    } catch (error) {
      steps.push({ version: v, status: "error", error: error.message });
      break;
    }
  }

  const lastOk = steps.filter((s) => s.status === "ok" || s.status === "ok_preview").at(-1);
  const newVersion = lastOk ? lastOk.version : currentVersion;

  if (!dryRun && newVersion > currentVersion) {
    await writeSchemaVersion(
      { schemaVersion: newVersion, updatedAt: new Date(now).toISOString() },
      schemaVersionPath,
    );
  }

  const result = {
    ran: steps.length > 0 && !dryRun,
    dryRun,
    from: currentVersion,
    to: newVersion,
    targetVersion,
    steps,
    timestamp: new Date(now).toISOString(),
  };

  if (!dryRun && steps.length > 0) {
    await mkdir(dirname(auditPath), { recursive: true });
    await appendFile(auditPath, `${safeJsonStringify({ schemaVersion: 1, ...result })}\n`, "utf8");
  }

  return result;
}
