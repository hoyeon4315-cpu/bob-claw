import { spawnSync } from "node:child_process";

export const GIT_COMMIT_TRAILER = "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>";

export const DEFAULT_GIT_OPS_EXCLUDE_PATHS = Object.freeze([
  "dashboard/public/auto-kill-events.json",
  "dashboard/public/dashboard-status.json",
  "dashboard/public/live-runtime.json",
  "dashboard/public/merkl-active.json",
  "dashboard/public/strategy-tick-status.json",
  "dashboard/public/wallet-holdings.json",
]);

function normalizePath(path = "") {
  return String(path || "").trim();
}

export function parseGitStatusLine(line = "") {
  const text = String(line || "");
  if (!text.trim()) return null;
  const x = text[0] || " ";
  const y = text[1] || " ";
  const payload = text.slice(3);
  const [fromPath, toPath] = payload.includes(" -> ") ? payload.split(" -> ") : [payload, payload];
  return {
    raw: text,
    indexStatus: x,
    workTreeStatus: y,
    path: normalizePath(toPath),
    fromPath: fromPath !== toPath ? normalizePath(fromPath) : null,
    untracked: x === "?" && y === "?",
  };
}

export function parseGitStatus(stdout = "") {
  return String(stdout || "")
    .split("\n")
    .map(parseGitStatusLine)
    .filter(Boolean);
}

export function buildGitCommitMessage(subject = "") {
  const trimmed = String(subject || "").trim();
  if (!trimmed) throw new Error("commit_message_required");
  if (trimmed.includes(GIT_COMMIT_TRAILER)) return trimmed;
  return `${trimmed}\n\n${GIT_COMMIT_TRAILER}`;
}

export function buildGitOpsPlan({
  branch = null,
  statusEntries = [],
  includePaths = [],
  excludePaths = DEFAULT_GIT_OPS_EXCLUDE_PATHS,
} = {}) {
  const includeSet = new Set((includePaths || []).map(normalizePath).filter(Boolean));
  const excludeSet = new Set((excludePaths || []).map(normalizePath).filter(Boolean));
  const entries = (statusEntries || []).filter((entry) => entry?.path);
  const relevantEntries = includeSet.size > 0 ? entries.filter((entry) => includeSet.has(entry.path)) : entries;
  const includedEntries = relevantEntries.filter((entry) => !excludeSet.has(entry.path));
  const excludedEntries = relevantEntries.filter((entry) => excludeSet.has(entry.path));
  const includedPaths = [...new Set(includedEntries.map((entry) => entry.path))];
  const excludedPaths = [...new Set(excludedEntries.map((entry) => entry.path))];
  return {
    branch: normalizePath(branch) || null,
    commitReady: includedPaths.length > 0,
    pushReady: includedPaths.length > 0 && Boolean(normalizePath(branch)),
    includedPaths,
    excludedPaths,
    generatedArtifactPaths: excludedPaths.filter((path) => DEFAULT_GIT_OPS_EXCLUDE_PATHS.includes(path)),
    changedPathCount: entries.length,
    includedPathCount: includedPaths.length,
    excludedPathCount: excludedPaths.length,
  };
}

export async function defaultRunGitCommand({ args = [], cwd = process.cwd() } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0 && !result.error,
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error || null,
  };
}

export async function executeGitOpsPlan(
  plan,
  {
    cwd = process.cwd(),
    message,
    push = false,
    runGitCommand = defaultRunGitCommand,
  } = {},
) {
  if (!plan?.commitReady) {
    return {
      mode: "execute",
      executionStatus: "noop",
      reason: "no_included_paths",
      stagedPaths: [],
      commitMessage: null,
      commit: null,
      push: null,
    };
  }

  const commitMessage = buildGitCommitMessage(message);
  const addResult = await runGitCommand({
    cwd,
    args: ["add", "--", ...plan.includedPaths],
  });
  if (!addResult.ok) {
    return {
      mode: "execute",
      executionStatus: "failed",
      reason: "git_add_failed",
      stagedPaths: plan.includedPaths,
      commitMessage,
      commit: addResult,
      push: null,
    };
  }

  const commitResult = await runGitCommand({
    cwd,
    args: ["commit", "-m", commitMessage],
  });
  if (!commitResult.ok) {
    return {
      mode: "execute",
      executionStatus: "failed",
      reason: "git_commit_failed",
      stagedPaths: plan.includedPaths,
      commitMessage,
      commit: commitResult,
      push: null,
    };
  }

  const headResult = await runGitCommand({
    cwd,
    args: ["rev-parse", "HEAD"],
  });
  const commitSha = headResult.ok ? String(headResult.stdout || "").trim() : null;

  let pushResult = null;
  if (push) {
    pushResult = await runGitCommand({
      cwd,
      args: ["push"],
    });
    if (!pushResult.ok) {
      return {
        mode: "execute",
        executionStatus: "failed",
        reason: "git_push_failed",
        stagedPaths: plan.includedPaths,
        commitMessage,
        commit: {
          ...commitResult,
          sha: commitSha,
        },
        push: pushResult,
      };
    }
  }

  return {
    mode: "execute",
    executionStatus: "succeeded",
    reason: null,
    stagedPaths: plan.includedPaths,
    commitMessage,
    commit: {
      ...commitResult,
      sha: commitSha,
    },
    push: push ? pushResult : null,
  };
}
