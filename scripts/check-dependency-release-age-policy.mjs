import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_POLICY_PATH = "docs/readiness/dependency-release-age-policy.md";
const DEFAULT_DEPENDABOT_PATH = ".github/dependabot.yml";
const DEFAULT_RENOVATE_CANDIDATES = ["renovate.json", ".github/renovate.json", ".renovaterc", ".renovaterc.json"];

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const [rawKey, ...rawValueParts] = arg.slice(2).split("=");
    const value = rawValueParts.join("=");
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = value || true;
  }
  return options;
}

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseYaml(yamlText, sourcePath) {
  const parser = spawnSync(
    "ruby",
    [
      "-e",
      [
        "require 'yaml'",
        "require 'json'",
        "data = YAML.safe_load(STDIN.read, permitted_classes: [], aliases: false)",
        "puts JSON.generate(data)",
      ].join("; "),
    ],
    { encoding: "utf8", input: yamlText },
  );
  if (parser.status !== 0) {
    const stderr = parser.stderr.trim() || parser.stdout.trim() || "unknown YAML parse failure";
    throw new Error(`Failed to parse YAML for ${sourcePath}: ${stderr}`);
  }
  return JSON.parse(parser.stdout);
}

function parsePolicyDocument(policyPath) {
  const source = readRequiredFile(policyPath);
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error(`Policy document must start with YAML front matter: ${policyPath}`);
  }
  return {
    source,
    metadata: parseYaml(match[1], policyPath),
  };
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function validatePolicyMetadata(policyPath, policyDocument, messages) {
  const policy = policyDocument.metadata?.dependency_release_age_policy;
  if (!policy || typeof policy !== "object") {
    throw new Error(`dependency_release_age_policy metadata is required in ${policyPath}`);
  }

  const minimumDays = {
    npm: assertPositiveInteger(policy.minimum_days?.npm, "minimum_days.npm"),
    githubActions: assertPositiveInteger(policy.minimum_days?.github_actions, "minimum_days.github_actions"),
  };

  if (!/operator\/security review required/i.test(String(policy.emergency_exception || ""))) {
    throw new Error(
      `dependency_release_age_policy.emergency_exception must include "operator/security review required" in ${policyPath}`,
    );
  }
  if (!/prohibited/i.test(String(policy.auto_merge || ""))) {
    throw new Error(`dependency_release_age_policy.auto_merge must prohibit auto-merge in ${policyPath}`);
  }

  messages.push(
    `POLICY_OK ${path.relative(process.cwd(), policyPath)} npm=${minimumDays.npm} github-actions=${minimumDays.githubActions}`,
  );
  return minimumDays;
}

function resolveExistingFile(repoRoot, candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const resolved = path.isAbsolute(candidate) ? candidate : path.join(repoRoot, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function cooldownDays(cooldown, ecosystemLabel) {
  if (!cooldown || typeof cooldown !== "object") {
    throw new Error(`${ecosystemLabel} update block must define cooldown`);
  }
  const specificKeys = ["semver-major-days", "semver-minor-days", "semver-patch-days"];
  const defaultDays = cooldown["default-days"];
  if (defaultDays != null) {
    return assertPositiveInteger(defaultDays, `${ecosystemLabel} cooldown.default-days`);
  }
  const specificValues = specificKeys.map((key) => cooldown[key]).filter((value) => value != null);
  if (specificValues.length !== specificKeys.length) {
    throw new Error(`${ecosystemLabel} cooldown must set default-days or all semver-specific day values`);
  }
  return Math.min(
    ...specificValues.map((value, index) =>
      assertPositiveInteger(value, `${ecosystemLabel} cooldown.${specificKeys[index]}`),
    ),
  );
}

function validateDependabotConfig(dependabotPath, minimumDays, messages) {
  const config = parseYaml(readRequiredFile(dependabotPath), dependabotPath);
  if (config.version !== 2) {
    throw new Error(`${dependabotPath} must set version: 2`);
  }
  const updates = Array.isArray(config.updates) ? config.updates : [];
  const ecosystems = [
    ["npm", minimumDays.npm],
    ["github-actions", minimumDays.githubActions],
  ];
  for (const [ecosystem, requiredDays] of ecosystems) {
    const matchingBlocks = updates.filter((update) => update["package-ecosystem"] === ecosystem);
    if (!matchingBlocks.length) {
      throw new Error(`${dependabotPath} must include a ${ecosystem} update block`);
    }
    for (const updateBlock of matchingBlocks) {
      const actualDays = cooldownDays(updateBlock.cooldown, ecosystem);
      if (actualDays < requiredDays) {
        throw new Error(
          `${dependabotPath} ${ecosystem} cooldown is ${actualDays} days but policy requires at least ${requiredDays}`,
        );
      }
    }
    messages.push(
      `DEPENDABOT_OK ${path.relative(process.cwd(), dependabotPath)} ${ecosystem} cooldown>=${requiredDays}`,
    );
  }
}

function parseRenovateDays(value, label) {
  if (value == null) {
    return null;
  }
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be an integer or duration string`);
  }
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(d|day|days)$/);
  if (!match) {
    throw new Error(`${label} must use whole-day durations such as "7 days"`);
  }
  return Number.parseInt(match[1], 10);
}

function findRenovateDelayDays(config, manager) {
  const candidates = [];
  const rootMinimumReleaseAge = parseRenovateDays(config.minimumReleaseAge, "minimumReleaseAge");
  const rootStabilityDays = parseRenovateDays(config.stabilityDays, "stabilityDays");
  if (rootMinimumReleaseAge != null) {
    candidates.push(rootMinimumReleaseAge);
  }
  if (rootStabilityDays != null) {
    candidates.push(rootStabilityDays);
  }
  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  for (const rule of packageRules) {
    const matchManagers = Array.isArray(rule.matchManagers) ? rule.matchManagers : null;
    if (matchManagers && !matchManagers.includes(manager)) {
      continue;
    }
    const ruleMinimumReleaseAge = parseRenovateDays(
      rule.minimumReleaseAge,
      `packageRules.minimumReleaseAge for ${manager}`,
    );
    const ruleStabilityDays = parseRenovateDays(rule.stabilityDays, `packageRules.stabilityDays for ${manager}`);
    if (ruleMinimumReleaseAge != null) {
      candidates.push(ruleMinimumReleaseAge);
    }
    if (ruleStabilityDays != null) {
      candidates.push(ruleStabilityDays);
    }
  }
  if (!candidates.length) {
    return null;
  }
  return Math.min(...candidates);
}

function validateRenovateConfig(renovatePath, minimumDays, messages) {
  let config;
  try {
    config = JSON.parse(readRequiredFile(renovatePath));
  } catch (error) {
    throw new Error(`Failed to parse Renovate JSON for ${renovatePath}: ${error.message}`);
  }
  const managers = [
    ["npm", minimumDays.npm],
    ["github-actions", minimumDays.githubActions],
  ];
  for (const [manager, requiredDays] of managers) {
    const actualDays = findRenovateDelayDays(config, manager);
    if (actualDays == null) {
      throw new Error(`${renovatePath} must set minimumReleaseAge or stabilityDays for ${manager}`);
    }
    if (actualDays < requiredDays) {
      throw new Error(
        `${renovatePath} ${manager} delay is ${actualDays} days but policy requires at least ${requiredDays}`,
      );
    }
    messages.push(`RENOVATE_OK ${path.relative(process.cwd(), renovatePath)} ${manager} delay>=${requiredDays}`);
  }
}

export function validateDependencyReleaseAgePolicy(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || resolveRepoRoot());
  const policyPath = path.resolve(repoRoot, options.policyPath || DEFAULT_POLICY_PATH);
  const dependabotPath = resolveExistingFile(repoRoot, [options.dependabotPath || DEFAULT_DEPENDABOT_PATH]);
  const renovatePath = resolveExistingFile(
    repoRoot,
    options.renovatePath ? [options.renovatePath] : DEFAULT_RENOVATE_CANDIDATES,
  );
  const messages = [];
  const policyDocument = parsePolicyDocument(policyPath);
  const minimumDays = validatePolicyMetadata(policyPath, policyDocument, messages);

  if (dependabotPath) {
    validateDependabotConfig(dependabotPath, minimumDays, messages);
  }
  if (renovatePath) {
    validateRenovateConfig(renovatePath, minimumDays, messages);
  }
  if (!dependabotPath && !renovatePath) {
    messages.push("AUTOMATION_STATUS policy-only; no local Dependabot or Renovate config found in this branch");
  }

  return {
    messages,
    policyPath,
    dependabotPath,
    renovatePath,
    minimumDays,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = validateDependencyReleaseAgePolicy(args);
  for (const message of result.messages) {
    console.log(message);
  }
  console.log("CHECK_OK dependency release age policy validated");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`CHECK_FAILED ${message}`);
    process.exitCode = 1;
  }
}
