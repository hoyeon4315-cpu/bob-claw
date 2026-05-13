#!/usr/bin/env node

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const options = {
    json: false,
    repo: null,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
    }
  }

  return options;
}

async function defaultRunGh(args) {
  const { stdout } = await execFileAsync("gh", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  return stdout;
}

async function inferRepoFromGh() {
  const { stdout } = await execFileAsync(
    "gh",
    ["repo", "view", "--json", "owner,name", "--jq", '"\\(.owner.login)/\\(.name)"'],
    {
      encoding: "utf8",
    },
  );
  return stdout.trim();
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function ghOrError(runGh, args) {
  try {
    return {
      ok: true,
      stdout: await runGh(args),
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.stderr || error?.message || String(error),
    };
  }
}

function activeRulesetsFrom(rawRulesets) {
  if (!Array.isArray(rawRulesets)) return [];
  return rawRulesets.filter((ruleset) => ruleset?.enforcement === "active");
}

function protectionSummary(rawProtection) {
  if (!rawProtection || typeof rawProtection !== "object") {
    return null;
  }

  return {
    requiredPullRequestReviews: rawProtection.required_pull_request_reviews ?? null,
    requiredStatusChecks: rawProtection.required_status_checks ?? null,
    enforceAdmins: rawProtection.enforce_admins ?? null,
    allowForcePushes: rawProtection.allow_force_pushes ?? null,
    allowDeletions: rawProtection.allow_deletions ?? null,
    requiredLinearHistory: rawProtection.required_linear_history ?? null,
    requiredConversationResolution: rawProtection.required_conversation_resolution ?? null,
    lockBranch: rawProtection.lock_branch ?? null,
  };
}

export async function runBranchProtectionCheck({ repo, runGh = defaultRunGh } = {}) {
  const resolvedRepo = repo || (await inferRepoFromGh());
  const result = {
    repo: resolvedRepo,
    provider: "github",
    adminAccess: null,
    rulesets: {
      checked: false,
      count: 0,
      activeCount: 0,
      activeNames: [],
    },
    branches: {
      main: {
        exists: true,
        protected: false,
        protection: null,
      },
      dev: {
        exists: false,
        protected: null,
        protection: null,
      },
    },
    verdict: "fail",
    reason: null,
  };

  const admin = await ghOrError(runGh, ["api", `repos/${resolvedRepo}`, "--jq", ".permissions.admin"]);
  if (!admin.ok) {
    result.verdict = "skip";
    result.reason = `gh admin check failed: ${admin.message.trim()}`;
    return result;
  }

  result.adminAccess = admin.stdout.trim() === "true";
  if (!result.adminAccess) {
    result.verdict = "skip";
    result.reason = "admin access is required to evaluate or mutate branch protection";
    return result;
  }

  const branches = await ghOrError(runGh, ["api", `repos/${resolvedRepo}/branches`, "--jq", ".[].name"]);
  if (branches.ok) {
    const branchNames = new Set(branches.stdout.trim().split(/\s+/).filter(Boolean));
    result.branches.main.exists = branchNames.has("main");
    result.branches.dev.exists = branchNames.has("dev");
  }

  const rulesets = await ghOrError(runGh, ["api", `repos/${resolvedRepo}/rulesets`]);
  if (rulesets.ok) {
    const parsedRulesets = parseJson(rulesets.stdout, []);
    const activeRulesets = activeRulesetsFrom(parsedRulesets);
    result.rulesets.checked = true;
    result.rulesets.count = Array.isArray(parsedRulesets) ? parsedRulesets.length : 0;
    result.rulesets.activeCount = activeRulesets.length;
    result.rulesets.activeNames = activeRulesets.map((ruleset) => ruleset.name).filter(Boolean);
  }

  if (result.rulesets.activeCount > 0) {
    result.verdict = "pass";
    result.reason = "active GitHub ruleset exists";
    return result;
  }

  const mainProtection = await ghOrError(runGh, ["api", `repos/${resolvedRepo}/branches/main/protection`]);
  if (mainProtection.ok) {
    result.branches.main.protected = true;
    result.branches.main.protection = protectionSummary(parseJson(mainProtection.stdout, null));
  }

  if (result.branches.dev.exists) {
    const devProtection = await ghOrError(runGh, ["api", `repos/${resolvedRepo}/branches/dev/protection`]);
    result.branches.dev.protected = devProtection.ok;
    if (devProtection.ok) {
      result.branches.dev.protection = protectionSummary(parseJson(devProtection.stdout, null));
    }
  }

  result.verdict = result.branches.main.protected ? "pass" : "fail";
  result.reason = result.branches.main.protected
    ? "main has legacy branch protection"
    : "no active ruleset and main legacy branch protection is missing";
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runBranchProtectionCheck({ repo: options.repo });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`repo=${result.repo}`);
    console.log(`provider=${result.provider}`);
    console.log(`adminAccess=${result.adminAccess}`);
    console.log(`rulesets.activeCount=${result.rulesets.activeCount}`);
    console.log(`main.protected=${result.branches.main.protected}`);
    console.log(`dev.exists=${result.branches.dev.exists}`);
    console.log(`verdict=${result.verdict}`);
    console.log(`reason=${result.reason}`);
  }

  process.exitCode = result.verdict === "fail" ? 1 : 0;
}
