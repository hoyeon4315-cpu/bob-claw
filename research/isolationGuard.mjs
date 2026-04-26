import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const FORBIDDEN_RULES = Object.freeze([
  { reason: "forbidden_path", pattern: /src\/executor\/signer\//u },
  { reason: "forbidden_path", pattern: /src\/treasury\/keys\//u },
  { reason: "forbidden_path", pattern: /signer\/client\.mjs/u },
  { reason: "forbidden_live_helper", pattern: /run-live-canary-sweep\.mjs/u },
  { reason: "forbidden_live_helper", pattern: /send-executor-intent\.mjs/u },
  { reason: "forbidden_broadcast_method", pattern: /\beth_sendRawTransaction\b/u },
  { reason: "forbidden_broadcast_method", pattern: /\bsendRawTransaction\b/u },
  { reason: "forbidden_secret_env", pattern: /\bBURNER_(?:EVM|BTC|PRIVATE)_KEY_PATH\b/u },
]);

function walk(dir, bucket = []) {
  if (!existsSync(dir)) return bucket;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, bucket);
      continue;
    }
    if (/\.(?:mjs|md|json)$/u.test(entry.name)) {
      bucket.push(path);
    }
  }
  return bucket;
}

export function scanResearchIsolation({ rootDir = process.cwd() } = {}) {
  const resolvedRootDir = resolve(rootDir);
  const files = walk(join(resolvedRootDir, "research"), []);
  const researchLaunchdCli = join(resolvedRootDir, "src", "cli", "manage-research-launchd.mjs");
  if (existsSync(researchLaunchdCli)) files.push(researchLaunchdCli);

  const violations = [];
  for (const filePath of files) {
    const contents = readFileSync(filePath, "utf8");
    for (const rule of FORBIDDEN_RULES) {
      if (rule.pattern.test(contents)) {
        violations.push(
          Object.freeze({
            path: relative(resolvedRootDir, filePath),
            reason: rule.reason,
            pattern: rule.pattern.source,
          }),
        );
      }
    }
  }

  return Object.freeze({
    ok: violations.length === 0,
    fileCount: files.length,
    violations: Object.freeze(violations),
  });
}
