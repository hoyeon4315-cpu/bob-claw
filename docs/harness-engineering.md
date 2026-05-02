---
status: canonical
updated_at: 2026-05-02
source_of_truth:
  - AGENTS.md
  - docs/system-map.md
---

# Harness Engineering Guide

Use this guide before adding features, changing dashboard code, or cleaning the
workspace. Its job is to reduce false assumptions, generated-file churn, and
fresh-clone regressions.

## Fast Start

```bash
git status --short --branch
npm run graph:focus -- status
npm run report:strategy-catalog -- --json
```

Then read:

1. `AGENTS.md`
2. `docs/system-map.md`
3. The nearest source module and its tests

## Source Vs Generated

| Treat As Source | Treat As Generated / Operational |
| --- | --- |
| `src/**/*.mjs` | `data/**` |
| `test/**/*.test.mjs` | `logs/**` |
| `docs/system-map.md` | `docs/current-status.md` |
| `docs/harness-engineering.md` | `docs/session-handoff-*.md` |
| `dashboard/public/*.jsx` | `dashboard/public/*.js` |
| `dashboard/public/index.html` | `dashboard/public/*.json` |
| `dashboard/public/_headers` | `.playwright-cli/**`, `.cloudflare/**`, `.wrangler/**` |

Generated public dashboard JSON can be useful locally but should not be mixed
into source commits by accident. `src/session/git-ops-automation.mjs` excludes
the known generated dashboard JSON slices by default.

## Safe Staging Rules

- Stage exact files: `git add -- path1 path2 ...`
- Do not stage `dashboard/public/*.json` during source refactors unless the
  task explicitly publishes a dashboard snapshot.
- Do not stage `data/`, `logs/`, `.env`, `.cloudflare/`, `.wrangler/`,
  `.playwright-cli/`, `node_modules/`, `out/`, or local worktrees.
- Never rewrite or delete append-only audit files.
- If a file is imported by tracked source, verify it is not ignored:

```bash
git check-ignore -v src/lib/json-safe.mjs src/lib/shell-quote.mjs || true
```

No output for a source helper means it is eligible to be tracked.

## Policy Backstop Checklist

For any live-capable feature, verify the intent path:

1. Strategy/helper emits a typed intent. It does not sign.
2. Intent has a committed `strategyId`.
3. `src/config/strategy-caps.mjs` exposes per-tx, per-day, per-chain, loss,
   failed-gas, and tiny-canary caps as applicable.
4. `evaluateIntentPolicies()` covers kill-switch, Gateway availability,
   consecutive failures, caps, HF, stale quote, approval hygiene, tiny canary,
   liquidity, and concentration as relevant.
5. Signer daemon appends audit records for rejected, signed, broadcasted,
   confirmed, reverted, or errored outcomes.
6. Receipt ingest records settlement proof. For payback, delivered means a
   Bitcoin L1 balance delta matching the Gateway order.

## Dashboard Checklist

Before dashboard UI changes:

1. Read `docs/dashboard-context.md`.
2. Decide whether the change is UI source, status schema, live overlay, or
   generated snapshot.
3. If adding data fields, update the status builder and dashboard tests.
4. Keep the dashboard read-only: no keys, signing, cap changes, or execution.
5. Test focused dashboard files first:

```bash
node --test test/dashboard-status.test.mjs test/dashboard-app.test.mjs test/dashboard-live-slices.test.mjs
npm run dashboard:build
```

Only commit generated dashboard JS/JSON when the task is explicitly to refresh
the public artifact set.

## Strategy And Config Checklist

- Import official Gateway chains from `src/config/gateway-destinations.mjs`.
- Keep Arbitrum/Polygon limited to fallback/manual bridge contexts.
- Keep `strategy-caps.mjs` as the public import path; add cap data in the
  focused registry modules under `src/config/strategy-caps/`.
- Preserve BTC/sats-first fields. USD fields are projections or caps.
- For campaign/radar tiny live canaries, use `src/config/sizing.mjs` helpers
  for hold days and cost floors.
- Add tests before or with policy changes. The fastest high-signal set is:

```bash
node --test test/gateway-availability.test.mjs test/executor-policy-index.test.mjs
node --test test/payback-scheduler.test.mjs test/auto-kill-triggers.test.mjs
```

## Cleanup Checklist

Safe to remove in a cleanup commit:

- `.DS_Store`
- `*.bak-2026-04-17`
- empty ignored local caches after confirming they are not data/audit history

Do not remove as "trash":

- `data/*.jsonl`
- `logs/*.jsonl`
- `logs/signer-audit.jsonl`
- `logs/kill-switch-audit.jsonl`
- `logs/dev-lock-audit.jsonl`
- receipt guides or proof artifacts
- graph reports used for navigation

Large local caches such as `.playwright-cli/`, `.cloudflare/`, `.wrangler/`,
and `.opencode/node_modules/` can be deleted locally after inspection, but they
are not part of source refactor commits.

## Verification Matrix

| Change Type | Minimum Verification |
| --- | --- |
| Docs only | `npm run graph:focus -- status` |
| Git hygiene | `node --test test/repo-hygiene.test.mjs test/git-ops-automation.test.mjs` |
| Gateway chain policy | `node --test test/diversification.test.mjs test/diversification-kpi.test.mjs test/all-chain-autopilot.test.mjs test/gateway-update-autopilot.test.mjs` |
| Signer/policy | `node --test test/gateway-availability.test.mjs test/executor-policy-index.test.mjs` |
| Watchdog/auto-kill | `node --test test/executor-watchdog-runner.test.mjs test/auto-kill-triggers.test.mjs test/auto-kill-triggers-extended.test.mjs` |
| Payback | `node --test test/payback-scheduler.test.mjs test/payback-accumulator.test.mjs test/payback-dashboard.test.mjs` |
| Dashboard UI/status | `node --test test/dashboard-status.test.mjs test/dashboard-app.test.mjs test/dashboard-live-slices.test.mjs && npm run dashboard:build` |
| Any source refactor | `npm run check && npm test` |

Do not claim completion until the verification output has been read and the
exit code is known.
