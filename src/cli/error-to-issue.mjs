#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { buildErrorIssuePayload } from "../observability/error-to-issue.mjs";

function parseArgs(argv) {
  const args = {
    input: null,
    repo: process.env.GITHUB_REPOSITORY || null,
    dryRun: true,
    create: false,
    labels: null,
    githubApiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    if (key === "--input") {
      args.input = nextValue;
      if (inlineValue === undefined) index += 1;
    } else if (key === "--repo") {
      args.repo = nextValue;
      if (inlineValue === undefined) index += 1;
    } else if (key === "--dry-run") {
      args.dryRun = inlineValue === undefined ? nextValue !== "false" : inlineValue !== "false";
      if (inlineValue === undefined && (nextValue === "true" || nextValue === "false")) index += 1;
    } else if (key === "--create") {
      args.create = true;
    } else if (key === "--labels") {
      args.labels = nextValue
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);
      if (inlineValue === undefined) index += 1;
    } else if (key === "--github-api-url") {
      args.githubApiUrl = nextValue;
      if (inlineValue === undefined) index += 1;
    }
  }
  return args;
}

async function readStdin() {
  let buffer = "";
  for await (const chunk of process.stdin) buffer += chunk;
  return buffer;
}

async function readReport(input) {
  const raw = input && input !== "-" ? await readFile(input, "utf8") : await readStdin();
  if (!raw.trim()) throw new Error("No error report JSON provided");
  return JSON.parse(raw);
}

function splitRepo(repo) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name) throw new Error("Set --repo=owner/name or GITHUB_REPOSITORY before creating an issue");
  return { owner, name };
}

async function githubRequest({ method = "GET", path, token, body, githubApiUrl }) {
  const response = await fetch(`${githubApiUrl.replace(/\/$/u, "")}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${data?.message || response.statusText}`);
  }
  return data;
}

async function searchOpenDuplicate({ repo, fingerprint, token, githubApiUrl }) {
  const { owner, name } = splitRepo(repo);
  const query = encodeURIComponent(`repo:${owner}/${name} is:issue is:open ${fingerprint} in:body`);
  const result = await githubRequest({ path: `/search/issues?q=${query}`, token, githubApiUrl });
  const existing = result.items?.[0] || null;
  return existing
    ? { found: true, number: existing.number, url: existing.html_url, title: existing.title }
    : { found: false };
}

async function existingLabels({ repo, labels, token, githubApiUrl }) {
  const { owner, name } = splitRepo(repo);
  const result = await githubRequest({ path: `/repos/${owner}/${name}/labels?per_page=100`, token, githubApiUrl });
  const available = new Set((result || []).map((label) => label.name));
  return {
    labels: labels.filter((label) => available.has(label)),
    missingLabels: labels.filter((label) => !available.has(label)),
  };
}

async function createIssue({ repo, payload, token, githubApiUrl }) {
  const { owner, name } = splitRepo(repo);
  const labelState = await existingLabels({ repo, labels: payload.labels, token, githubApiUrl });
  const issue = await githubRequest({
    method: "POST",
    path: `/repos/${owner}/${name}/issues`,
    token,
    githubApiUrl,
    body: {
      title: payload.title,
      body: payload.body,
      labels: labelState.labels,
    },
  });
  return {
    number: issue.number,
    url: issue.html_url,
    appliedLabels: labelState.labels,
    missingLabels: labelState.missingLabels,
  };
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const report = await readReport(args.input);
  const payload = buildErrorIssuePayload(report, { repo: args.repo, labels: args.labels });
  const duplicateSearch = {
    strategy: "search open issues by repository, fingerprint, and issue body marker before creating a new issue",
    query: payload.duplicateQuery,
  };

  if (args.dryRun || !args.create) {
    return {
      action: "dry_run_preview",
      wouldCreateIssue: false,
      issueCreated: false,
      duplicateSearch,
      payload,
    };
  }

  const token = env.GITHUB_TOKEN || env.ERROR_TO_ISSUE_GITHUB_TOKEN;
  if (!token) throw new Error("Real issue creation requires GITHUB_TOKEN or ERROR_TO_ISSUE_GITHUB_TOKEN");

  const duplicate = await searchOpenDuplicate({
    repo: args.repo,
    fingerprint: payload.fingerprint,
    token,
    githubApiUrl: args.githubApiUrl,
  });
  if (duplicate.found) {
    return {
      action: "duplicate_found",
      wouldCreateIssue: false,
      issueCreated: false,
      duplicateSearch,
      duplicate,
      payload,
    };
  }

  const createdIssue = await createIssue({ repo: args.repo, payload, token, githubApiUrl: args.githubApiUrl });
  return {
    action: "issue_created",
    wouldCreateIssue: true,
    issueCreated: true,
    duplicateSearch,
    createdIssue,
    payload: {
      title: payload.title,
      labels: payload.labels,
      fingerprint: payload.fingerprint,
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
