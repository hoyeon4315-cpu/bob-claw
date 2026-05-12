---
name: bob-claw-readiness-safety-verification
description: Use when verifying BOB Claw readiness, live-safety status, or blocker state before making code, dashboard, deploy, or operational claims in this repo.
---

# BOB Claw Readiness And Safety Verification

`AGENTS.md` is the operating law. If this skill conflicts with any repo doc or task request, follow `AGENTS.md`.

## Use This Skill For

- Readiness or blocker checks
- "Is it safe/live/ready?" questions
- Dashboard truth or deploy-truth verification
- Pre-commit or pre-PR safety review for repo changes that touch ops surfaces

Do not use this skill to justify cap raises, signer bypass, kill-switch bypass, payback decisions, or policy exceptions. Those remain deterministic code-and-config responsibilities only.

## Required Read Order

1. `AGENTS.md`
2. `docs/system-map.md`
3. `docs/harness-engineering.md`

If the task is architecture-heavy, read `src/graphify-out/GRAPH_REPORT.md` before broad raw-file searching.

## Verification Workflow

1. Start with the existing diagnostic entry point that already answers the question.
   - Readiness blockers: `node src/cli/check-full-automation-readiness.mjs --json`
   - Refill / capital plan blockers: `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
   - Payback status: `npm run report:payback-status -- --json`
   - Capital audit / NAV deltas / gas burn: `npm run report:capital-audit -- --json`
   - Dashboard truth surface: inspect `dashboard/public/dashboard-status.json`
   - Latest autopilot run: inspect `data/all-chain-autopilot-latest.json`
2. Quote the relevant command output exactly in your report. If the command fails or returns no data, say that plainly and stop at `data insufficient` instead of guessing.
3. Distinguish clearly between:
   - advisory/reporting labels
   - deterministic execution authority in proposer -> policy -> signer
4. When checking dashboard or deploy truth, prefer the public status slices and explicit publish/deploy verification commands. Do not infer deploy success from a local build alone.
5. Before proposing a new module or CLI, check for an existing nearby tool first with `ls src/cli | grep <keyword>`.
6. Before finishing, inspect `git diff --stat` and `git diff --name-only` and confirm you did not pick up generated dashboard JSON, `data/`, `logs/`, coverage, cache, or other runtime artifacts unless the task explicitly required them.

## Hard Safety Rules

- Never present recorded JSONL snapshots as current balances when the task needs live balance truth.
- Never treat `preflight_clean` or queue readiness as proof that a broadcast happened.
- Never claim profitability without measured quote, fee, and receipt evidence.
- Never let dashboard fields, readiness labels, or stage names become runtime gates or runtime bypasses.
- Never expose private keys, API keys, wallet secrets, or Telegram tokens in skill content or reports.

## Reporting Contract

Return a compact evidence-first summary:

- `current stage`
- `what was checked`
- `exact blocker or green path`
- `why it is still blocked or ready`
- `next safest verification step`

When blocked, surface the first exact blocker verbatim instead of smoothing it into a generic summary.
