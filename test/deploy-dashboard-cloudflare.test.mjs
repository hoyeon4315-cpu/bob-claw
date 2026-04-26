import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPreflightSummary,
  main,
  parseArgs,
  resolveDeployPreflight,
} from "../src/cli/deploy-dashboard-cloudflare.mjs";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createFetchStub(routes) {
  return async (url) => {
    const parsed = new URL(typeof url === "string" ? url : url.toString());
    const key = `${parsed.pathname}${parsed.search}`;
    const response = routes[key];
    assert.ok(response, `Unexpected fetch request: ${key}`);
    return jsonResponse(response.body, response.status);
  };
}

test("deploy preflight auto-discovers the default dashboard project across accounts", async () => {
  const fetchFn = createFetchStub({
    "/client/v4/accounts?page=1&per_page=100": {
      body: {
        success: true,
        result: [
          { id: "acct-other", name: "Other" },
          { id: "acct-main", name: "Main" },
        ],
        result_info: { page: 1, total_pages: 1 },
      },
    },
    "/client/v4/accounts/acct-other/pages/projects": {
      body: {
        success: true,
        result: [{ name: "not-the-dashboard" }],
      },
    },
    "/client/v4/accounts/acct-main/pages/projects": {
      body: {
        success: true,
        result: [{ name: "bob-claw-dashboard" }],
      },
    },
  });

  const args = parseArgs([], { BOB_CLAW_CF_PRODUCTION_BRANCH: "release" });
  const preflight = await resolveDeployPreflight({
    args,
    env: { CLOUDFLARE_API_TOKEN: "token" },
    fetchFn,
  });

  assert.equal(preflight.accountId, "acct-main");
  assert.equal(preflight.accountSource, "api");
  assert.equal(preflight.projectName, "bob-claw-dashboard");
  assert.equal(preflight.projectSource, "default");
  assert.equal(preflight.projectExists, true);
  assert.equal(formatPreflightSummary({ preflight, args }), "Cloudflare preflight: account=acct-main (api) project=bob-claw-dashboard (default) branch=release createProject=off");
});

test("deploy preflight lists candidates when project selection is ambiguous", async () => {
  const fetchFn = createFetchStub({
    "/client/v4/accounts?page=1&per_page=100": {
      body: {
        success: true,
        result: [{ id: "acct-main", name: "Main" }],
        result_info: { page: 1, total_pages: 1 },
      },
    },
    "/client/v4/accounts/acct-main/pages/projects": {
      body: {
        success: true,
        result: [{ name: "alpha-dashboard" }, { name: "beta-dashboard" }],
      },
    },
  });

  await assert.rejects(
    resolveDeployPreflight({
      args: parseArgs([], {}),
      env: { CLOUDFLARE_API_TOKEN: "token" },
      fetchFn,
    }),
    (error) => {
      assert.match(error.message, /Unable to determine which Pages project to deploy/);
      assert.match(error.message, /alpha-dashboard @ Main \(acct-main\)/);
      assert.match(error.message, /beta-dashboard @ Main \(acct-main\)/);
      assert.match(error.message, /BOB_CLAW_CF_PAGES_PROJECT\/--project-name/);
      return true;
    },
  );
});

test("deploy main prints preflight summary and deploys with repo-local Cloudflare state", async () => {
  const fetchFn = createFetchStub({
    "/client/v4/accounts?page=1&per_page=100": {
      body: {
        success: true,
        result: [{ id: "acct-main", name: "Main" }],
        result_info: { page: 1, total_pages: 1 },
      },
    },
    "/client/v4/accounts/acct-main/pages/projects": {
      body: {
        success: true,
        result: [{ name: "bob-claw-dashboard" }],
      },
    },
  });
  const calls = [];
  const logs = [];

  await main({
    argv: [],
    env: { CLOUDFLARE_API_TOKEN: "token" },
    fetchFn,
    runCommand: async (command, args, commandEnv) => {
      calls.push({ command, args, commandEnv });
    },
    logger: {
      log(message) {
        logs.push(message);
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    command: "node",
    args: ["src/cli/status-dashboard.mjs"],
    commandEnv: calls[0].commandEnv,
  });
  assert.deepEqual(calls[1], {
    command: "wrangler",
    args: [
      "pages",
      "deploy",
      "/Users/love/BOB Claw/dashboard/public",
      "--project-name",
      "bob-claw-dashboard",
      "--branch",
      "main",
    ],
    commandEnv: calls[1].commandEnv,
  });
  assert.match(calls[0].commandEnv.HOME, /\.cloudflare\/home$/);
  assert.match(calls[0].commandEnv.XDG_CONFIG_HOME, /\.cloudflare\/xdg$/);
  assert.equal(logs[0], "Cloudflare preflight: account=acct-main (api) project=bob-claw-dashboard (default) branch=main createProject=off");
  assert.equal(logs[1], "Deployed to https://bob-claw-dashboard.pages.dev");
  assert.equal(logs[2], "Verify cache headers: curl -I https://bob-claw-dashboard.pages.dev/dashboard-status.json");
});

test("deploy main creates an explicit project when a single discovered account has no Pages projects", async () => {
  const fetchFn = createFetchStub({
    "/client/v4/accounts?page=1&per_page=100": {
      body: {
        success: true,
        result: [{ id: "acct-main", name: "Main" }],
        result_info: { page: 1, total_pages: 1 },
      },
    },
    "/client/v4/accounts/acct-main/pages/projects": {
      body: {
        success: true,
        result: [],
      },
    },
  });
  const calls = [];

  await main({
    argv: ["--skip-status", "--create-project", "--project-name=custom-dashboard"],
    env: { CLOUDFLARE_API_TOKEN: "token" },
    fetchFn,
    runCommand: async (command, args) => {
      calls.push({ command, args });
    },
    logger: { log() {} },
  });

  assert.deepEqual(calls, [
    {
      command: "wrangler",
      args: ["pages", "project", "create", "custom-dashboard", "--production-branch", "main"],
    },
    {
      command: "wrangler",
      args: [
        "pages",
        "deploy",
        "/Users/love/BOB Claw/dashboard/public",
        "--project-name",
        "custom-dashboard",
        "--branch",
        "main",
      ],
    },
  ]);
});
