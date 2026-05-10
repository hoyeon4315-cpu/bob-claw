import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  featureEnabled,
  readSchemaVersion,
  runMigrations,
  writeSchemaVersion,
} from "../src/executor/health/schema-migrations.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ schemaMigrations: true }), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ schemaMigrations: false }), false);
});

test("version bump runs migrations in order and updates schema version file", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-migrations-"));
  try {
    const migrationsDir = join(root, "migrations");
    const schemaVersionPath = join(root, "data", "schema-version.json");
    const auditPath = join(root, "logs", "schema-migrations.jsonl");
    await mkdir(migrationsDir, { recursive: true });

    await writeFile(
      join(migrationsDir, "v1.mjs"),
      `export default function v1(state) { return { ...state, version: 1, ranV1: true }; };\n`,
    );
    await writeFile(
      join(migrationsDir, "v2.mjs"),
      `export default function v2(state) { return { ...state, version: 2, ranV2: true }; };\n`,
    );

    const result = await runMigrations({
      currentVersion: 0,
      targetVersion: 2,
      migrationsDir,
      schemaVersionPath,
      auditPath,
      now: 1_000_000,
    });

    assert.equal(result.ran, true);
    assert.equal(result.from, 0);
    assert.equal(result.to, 2);
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0].version, 1);
    assert.equal(result.steps[0].status, "ok");
    assert.equal(result.steps[1].version, 2);
    assert.equal(result.steps[1].status, "ok");

    const versionFile = await readFile(schemaVersionPath, "utf8");
    const versionParsed = JSON.parse(versionFile);
    assert.equal(versionParsed.schemaVersion, 2);
    assert.equal(versionParsed.updatedAt, "1970-01-01T00:16:40.000Z");

    const auditRaw = await readFile(auditPath, "utf8");
    const auditParsed = JSON.parse(auditRaw.trim());
    assert.equal(auditParsed.schemaVersion, 1);
    assert.equal(auditParsed.ran, true);
    assert.equal(auditParsed.to, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("already at target → no-op", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-migrations-noop-"));
  try {
    const auditPath = join(root, "schema-migrations.jsonl");
    const result = await runMigrations({
      currentVersion: 3,
      targetVersion: 3,
      auditPath,
      now: 1_000_000,
    });
    assert.equal(result.ran, false);
    assert.equal(result.reason, "already_at_target");
    assert.equal(result.from, 3);
    assert.equal(result.to, 3);

    let fileExists = false;
    try {
      await readFile(auditPath, "utf8");
      fileExists = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    assert.equal(fileExists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration failure stops at first error and does not advance version", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-migrations-fail-"));
  try {
    const migrationsDir = join(root, "migrations");
    const schemaVersionPath = join(root, "data", "schema-version.json");
    const auditPath = join(root, "logs", "schema-migrations.jsonl");
    await mkdir(migrationsDir, { recursive: true });

    await writeFile(
      join(migrationsDir, "v1.mjs"),
      `export default function v1(state) { return { ...state, version: 1 }; };\n`,
    );
    await writeFile(
      join(migrationsDir, "v2.mjs"),
      `export default function v2(state) { throw new Error("migration_v2_broken"); };\n`,
    );

    const result = await runMigrations({
      currentVersion: 0,
      targetVersion: 2,
      migrationsDir,
      schemaVersionPath,
      auditPath,
      now: 1_000_000,
    });

    assert.equal(result.ran, true);
    assert.equal(result.from, 0);
    assert.equal(result.to, 1);
    assert.equal(result.steps[0].status, "ok");
    assert.equal(result.steps[1].status, "error");
    assert.ok(result.steps[1].error.includes("migration_v2_broken"));

    const versionFile = await readFile(schemaVersionPath, "utf8");
    const versionParsed = JSON.parse(versionFile);
    assert.equal(versionParsed.schemaVersion, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run previews without writing schema version or audit", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-migrations-dry-"));
  try {
    const migrationsDir = join(root, "migrations");
    const schemaVersionPath = join(root, "data", "schema-version.json");
    const auditPath = join(root, "logs", "schema-migrations.jsonl");
    await mkdir(migrationsDir, { recursive: true });

    await writeFile(
      join(migrationsDir, "v1.mjs"),
      `export default function v1(state) { return { ...state, version: 1 }; };\n`,
    );

    const result = await runMigrations({
      currentVersion: 0,
      targetVersion: 1,
      migrationsDir,
      schemaVersionPath,
      auditPath,
      now: 1_000_000,
      dryRun: true,
    });

    assert.equal(result.ran, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].status, "ok_preview");

    let versionExists = false;
    try {
      await readFile(schemaVersionPath, "utf8");
      versionExists = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    assert.equal(versionExists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feature off → no-op with reason feature_disabled", async () => {
  const result = await runMigrations({
    currentVersion: 0,
    targetVersion: 1,
    now: 1_000_000,
    profile: { schemaMigrations: false },
  });
  assert.equal(result.ran, false);
  assert.equal(result.reason, "feature_disabled");
});

test("readSchemaVersion and writeSchemaVersion round-trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-schema-version-"));
  try {
    const path = join(root, "schema-version.json");
    await writeSchemaVersion({ schemaVersion: 5, updatedAt: "2026-05-10T00:00:00.000Z" }, path);
    const read = await readSchemaVersion(path);
    assert.equal(read.schemaVersion, 5);
    assert.equal(read.updatedAt, "2026-05-10T00:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readSchemaVersion returns 0 for missing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-schema-version-missing-"));
  try {
    const path = join(root, "schema-version.json");
    const read = await readSchemaVersion(path);
    assert.equal(read.schemaVersion, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
