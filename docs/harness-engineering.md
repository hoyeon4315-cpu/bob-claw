---
status: canonical
updated_at: 2026-05-08
policy_authority: AGENTS.md
derived_from:
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
3. `docs/naming-conventions.md`
4. The nearest source module and its tests

## Source Vs Generated

| Treat As Source                        | Treat As Generated / Operational                       |
| -------------------------------------- | ------------------------------------------------------ |
| `src/**/*.mjs`                         | `data/**`                                              |
| `test/**/*.test.mjs`                   | `logs/**`                                              |
| `docs/system-map.md`                   | `docs/current-status.md`                               |
| `docs/harness-engineering.md`          | `docs/session-handoff-*.md`                            |
| `dashboard/public/*.jsx`               | `dashboard/public/*.js`                                |
| `dashboard/public/index.html`          | `dashboard/public/*.json`                              |
| `dashboard/public/_headers`            | `.playwright-cli/**`, `.cloudflare/**`, `.wrangler/**` |
| `docs/protocol-readers-unification.md` | `data/codex/**`, `data/health/**`                      |

Generated public dashboard JSON can be useful locally but should not be mixed
into source commits by accident. `src/session/git-ops-automation.mjs` excludes
the known generated dashboard JSON slices by default.

Dead-code detection is entrypoint-graph based: run `npm run check:dead-code`
to execute `knip` against package-script entries, launchd/string-referenced
CLIs, dynamic research candidate modules, and dashboard source entry files.
`scripts/check-dead-code.mjs` compares the current `knip` file findings against
`docs/readiness/dead-code-baseline.json`: audited backlog items stay visible in
command output, but any new unused-file candidate fails the check.

Technical-debt tracking is baseline-based too: run `npm run check:tech-debt`
to scan `src/`, `docs/`, and `test/` for `TODO`, `FIXME`, `XXX`, and `HACK`
markers. The audited backlog lives in
`docs/readiness/tech-debt-baseline.json`; generated/runtime outputs, dashboard
public JSON, logs, data snapshots, build artifacts, coverage, and dependency
or cache directories stay out of scope.

Unused-dependency detection is entrypoint-based too: run
`npm run check:unused-dependencies` to execute `knip` against package-script
entrypoints, workflow/string-referenced CLIs, dashboard source, research
modules, and test entrypoints. Generated/runtime outputs, dashboard public
JSON/JS bundles, logs, data snapshots, build artifacts, coverage, dependency
folders, caches, and local browser scratch files stay out of scope. See
`docs/readiness/unused-dependencies.md` for the documented ignore list.

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
7. No dashboard/report/prelive/stage/destination field is consulted as a
   runtime signer bypass. Advisory score sources may rank, but only policy and
   signer approval can execute.

## Dashboard Checklist

Before dashboard UI changes:

1. Read `docs/dashboard-context.md`.
2. Decide whether the change is UI source, status schema, live overlay, or
   generated snapshot.
3. If adding data fields, update the status builder and dashboard tests.
4. Keep the dashboard read-only: no keys, signing, cap changes, or execution.
5. Treat `generatedAt` as dashboard render time only. Material asset rows need
   `sourceObservedAt`, `priceObservedAt`, freshness, and confidence; stale
   wallet/protocol/price sources must remain visible and downgrade the
   asset-tracking verdict instead of being hidden.
6. Test focused dashboard files first:

```bash
node --test test/dashboard-status.test.mjs test/dashboard-app.test.mjs test/dashboard-live-slices.test.mjs
node --test test/dashboard-cache-headers.test.mjs
npm run dashboard:build
```

Only commit generated dashboard JS/JSON when the task is explicitly to refresh
the public artifact set.

## Strategy And Config Checklist

- Import official Gateway chains from `src/config/gateway-destinations.mjs`.
- Follow `docs/naming-conventions.md` for new file names and exported helper
  names; preserve runtime ids, env vars, CLI flags, and persisted JSON fields
  as compatibility surfaces instead of renaming them for style.
- Normalize chain ids through `canonicalGatewayChain()` before scoring,
  allocating, or aggregating receipt evidence. `bnb`/`BNB Chain` must land on
  `bsc`; `avax` on `avalanche`; `berachain` on `bera`.
- Keep Arbitrum/Polygon limited to fallback/manual bridge contexts.
- Treat the official Gateway chain list as an allowlist, not proof that every
  chain is route-enabled right now. Live Gateway intents should carry or consume
  a current route snapshot from `GET /v1/get-routes`; if the requested route is
  absent, policy reports `gateway_route_currently_unavailable`.
- Keep `strategy-caps.mjs` as the public import path; add cap data in the
  focused registry modules under `src/config/strategy-caps/`.
- Preserve BTC/sats-first fields. USD fields are projections or caps.
- For campaign/radar tiny live canaries, use `src/config/sizing.mjs` helpers
  for hold days and cost floors.
- When removing dashboard/report fields, run `rg` across `src`, `test`,
  `docs`, `package.json`, and dashboard sources; leave public JSON snapshots
  unstaged unless intentionally publishing a snapshot refresh.
- Treat `destination-promotion-gate.json` as a score source only. It must not
  become an execution gate, a cap source, or a signer input.
- Chain score ledgers are receipt evidence, not execution authority. They may
  use only signer-backed live records with terminal receipt status and explicit
  reconciliation proof. Confirmed/delivered rows require
  `reconciliationStatus: "reconciled"`; failed/reverted rows require
  `reconciliationStatus: "final_failed"`. Dry-run, preview,
  normalization-error, and cost-probe-only rows stay out of realized alpha
  scoring.
- Receipt-backed chain scores stay wide-posterior unless route availability,
  exit-liquidity proof, reward-token conversion proof when applicable, and
  enough alpha samples are present. Evidence-cost canaries can improve cost
  metadata but must not mature alpha sample counts or inflate realized PnL.
- Strategy-primary hypotheses and payback reserve proofs are separate. An
  expired strategy-primary hypothesis removes allocation score/share boosts
  until a committed renewal diff, but it does not change the proven payback
  reserve chain or block a cap-valid deterministic policy path.
- Explore allocation is a capped sample sleeve, not a cap raise. Unknown or
  wide-posterior chains use `allocationBucket: "explore"` and are clamped by
  committed strategy caps plus small-cap micro-test, radar, campaign, and
  unproven-protocol limits before any target balance or strategy-tick
  allocation is emitted.
- `run-strategy-tick.mjs` is report-only by default. It may build local intent
  previews for evidence, but it must persist `executionMode` and
  `broadcastSummary` in the JSONL tick record and only dispatch to the signer
  when `--execute` is provided.
- Non-primary entry EV gates compare expected realized net EV against
  chain-specific p90 cost, uncertainty, and a rung-aware edge floor. Do not
  reintroduce a fixed `$10` or `$0.50` runtime blocker for tiny canaries.
- Add tests before or with policy changes. The fastest high-signal set is:

```bash
node --test test/gateway-availability.test.mjs test/executor-policy-index.test.mjs
node --test test/payback-scheduler.test.mjs test/auto-kill-triggers.test.mjs
```

## DeFi Visibility And Codex Harness

Merged PR #4 on 2026-05-03 added four harness families. Treat them as source
surface with strict runtime boundaries:

- Protocol visibility lives in `src/protocol-readers/`,
  `src/treasury/protocol-position-*`, `src/config/token-registry.mjs`, and
  `src/status/protocol-position-marks-slice.mjs`. Readers must return explicit
  ok/error envelopes, never silent skips. Portfolio coverage Track 1 is a hard
  gate for missing/unlabeled positions; Track 2 is a value-drift warning.
- Codex LLM tooling lives in `src/llm/`, `src/cli/codex-*`, and
  `src/cli/auto-research-*`. It is dev/report/scaffold only. Keys are
  path-indirected through `OPENAI_API_KEY_PATH`; contexts are masked; calls
  append to `logs/codex-audit.jsonl`; budget lock state is separate from both
  kill-switch and dev-lock.
- Position health lives in `src/executor/health/`. The action engine may emit
  `exit`, `unwind`, `pause`, or `review` descriptors only. Rebalance intent
  creation remains in Capital Manager, not the health monitor.
- Auto-promotion now includes OOS holdout and regime-breakdown blockers in
  addition to the older walk-forward/shadow/cost gates. Missing regime or
  negative holdout evidence blocks promotion.

Operational outputs from this lane are generated or append-only:

- `data/codex/**`
- `data/health/**`
- `logs/codex-audit.jsonl`
- `logs/codex-budget-lock-audit.jsonl`
- `logs/auto-research-audit.jsonl`
- `logs/position-monitor-audit.jsonl`

Do not stage those outputs unless the task explicitly asks for a local evidence
artifact, and never rewrite append-only logs.

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

## Final Review Loop

Use evidence-complete confidence before merging:

1. Caller graph: `rg` deleted file/symbol names across `src`, `test`, `docs`,
   `package.json`, and dashboard sources, excluding generated/ignored outputs.
2. Targeted tests: run the narrow suites for touched policy, dashboard, capital,
   radar/Merkl, destination, and reporting modules.
3. Full checks: run `npm run check`, `npm test`, dashboard build when UI or
   public JS changed, and `git diff --check`.
4. Safety review: confirm no cap raise, no `autoExecute` flip, no signer
   bypass, no key/log/audit mutation, and no unintended generated dashboard
   JSON staging.
5. Repeat if any stale caller, loophole, or failed check appears.

## Verification Matrix

| Change Type                     | Minimum Verification                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs only                       | `npm run graph:focus -- status`                                                                                                                                                                                                                                                                                       |
| Git hygiene                     | `node --test test/repo-hygiene.test.mjs test/git-ops-automation.test.mjs`                                                                                                                                                                                                                                             |
| Gateway chain policy            | `node --test test/diversification.test.mjs test/diversification-kpi.test.mjs test/all-chain-autopilot.test.mjs test/gateway-update-autopilot.test.mjs`                                                                                                                                                                |
| Dev route remediation           | `node --test test/route-remediation-autopilot.test.mjs`                                                                                                                                                                                                                                                               |
| Codex LLM/dev harness           | `node --test test/codex-llm.test.mjs test/phase35-cli.test.mjs test/auto-research-pipeline.test.mjs`                                                                                                                                                                                                                  |
| Protocol readers/position marks | `node --test test/protocol-reader-spec.test.mjs test/protocol-reader-registry.test.mjs test/protocol-readers.test.mjs test/protocol-position-marker.test.mjs test/protocol-position-marks-slice.test.mjs test/report-portfolio-coverage.test.mjs`                                                                     |
| Position health monitor         | `node --test test/position-action-engine.test.mjs test/phase4-cli.test.mjs`                                                                                                                                                                                                                                           |
| Signer/policy                   | `node --test test/gateway-availability.test.mjs test/executor-policy-index.test.mjs`                                                                                                                                                                                                                                  |
| Watchdog/auto-kill              | `node --test test/executor-watchdog-runner.test.mjs test/auto-kill-triggers.test.mjs test/auto-kill-triggers-extended.test.mjs`                                                                                                                                                                                       |
| Payback                         | `node --test test/payback-scheduler.test.mjs test/payback-accumulator.test.mjs test/payback-dashboard.test.mjs`                                                                                                                                                                                                       |
| Dashboard UI/status             | `node --test test/dashboard-status.test.mjs test/dashboard-app.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-cache-headers.test.mjs && npm run dashboard:build`                                                                                                                                         |
| Any source refactor             | `npm run check && npm test`                                                                                                                                                                                                                                                                                           |
| Any new skill or agent added    | `node --test test/skills-config.test.mjs` (enforces verbatim BOB Gateway Protection block + 5-step Mandatory Verification Procedure + "Coding Agent Operating Mode" ref in all SKILL.md + agent .md; fails with clear error on missing); `npm run check:skills-config`; update skill-usage-guidelines.md matrix first |

Do not claim completion until the verification output has been read and the
exit code is known.
