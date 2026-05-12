/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "dev-harness-must-not-import-runtime-decision-path",
      severity: "error",
      comment:
        "Codex/auto-research/LLM harness code is dev/report/scaffold only. It must not import signer, policy, payback, capital, kill-switch, or executor dispatch surfaces.",
      from: {
        path: "^src/(llm/|cli/(codex-|auto-research-|run-auto-research-refresh|run-payback-runway-autoresearch|report-dev-agent-automation-bridge))",
      },
      to: {
        path: "^src/(executor/(signer/(daemon|btc-local-signer|evm-local-signer|socket-server|signer-interface|client)\\.mjs|policy/|payback/|capital/)|risk/auto-kill-triggers\\.mjs|cli/(send-executor-intent|run-kill-switch|run-.*(?:autopilot|payback|capital|refill|gateway-btc|live-canary|merkl)))",
      },
    },
    {
      name: "dashboard-status-must-not-import-signer-command-path",
      severity: "error",
      comment:
        "Dashboard/status/reporting layers may render public-safe state but must not import signer command/private-key paths. Existing src/status/executor-runtime.mjs reads signer health only; keep that exception narrow.",
      from: {
        path: "^(src/(status|dashboard)/|dashboard/public/.*\\.jsx$)",
        pathNot: "^src/status/executor-runtime\\.mjs$",
      },
      to: {
        path: "^src/executor/signer/(daemon|btc-local-signer|evm-local-signer|socket-server|signer-interface|client)\\.mjs",
      },
    },
    {
      name: "dashboard-status-must-not-import-runtime-mutation",
      severity: "error",
      comment:
        "Dashboard/status/reporting layers may render public-safe state but must not import execution helpers, capital mutation, kill-switch mutation, or live executor CLIs.",
      from: {
        path: "^(src/(status|dashboard)/|dashboard/public/.*\\.jsx$)",
      },
      to: {
        path: "^src/(executor/(helpers/|bridges/|strategies/|capital/)|cli/(send-executor-intent|run-kill-switch|run-.*(?:autopilot|payback|capital|refill|gateway-btc|live-canary|merkl))|risk/auto-kill-triggers\\.mjs)",
      },
    },
    {
      name: "policy-must-not-import-signer",
      severity: "error",
      comment:
        "Policy is the deterministic approval layer and must remain pure with no key custody or signer dependency.",
      from: {
        path: "^src/executor/policy/",
      },
      to: {
        path: "^src/executor/signer/",
      },
    },
    {
      name: "config-must-not-import-live-runtime",
      severity: "error",
      comment:
        "Committed config defines caps, chains, and thresholds. It must not read keys, call signer/policy runtime, or import execution mutation modules.",
      from: {
        path: "^src/config/",
      },
      to: {
        path: "^src/(executor/(signer/(daemon|btc-local-signer|evm-local-signer|socket-server|signer-interface|client)\\.mjs|policy/|helpers/|bridges/|strategies|capital/|payback/)|risk/auto-kill-triggers\\.mjs)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    exclude: {
      path: [
        "^data/",
        "^logs/",
        "^coverage/",
        "^build/",
        "^dist/",
        "^out/",
        "^node_modules/",
        "^dashboard/public/.*\\.json$",
        "^dashboard/public/.*\\.js$",
        "^src/graphify-out/",
      ].join("|"),
    },
    includeOnly: "^(src|scripts|test|dashboard/public)",
  },
};
