# BOB Claw Operating Law

`AGENTS.md` is the top-level operating law. Keep this file short and durable. If
any runbook, research note, skill prompt, or historical memory conflicts with
this file, `AGENTS.md` wins.

## Engineering Map

Read in this order:

1. `AGENTS.md`
2. `docs/system-map.md`
3. `docs/harness-engineering.md`
4. `docs/skill-usage-guidelines.md` when using or editing skills/subagents
5. `docs/ai-agent-operations.md` for role ownership and delegation boundaries
6. `docs/dashboard-context.md` before dashboard UI or public-status work
7. `docs/operator-memory.md` only for historical context; never as live truth

Engineering confidence standard: **evidence-complete confidence**.

Put durable law here. Put architecture, runbooks, checklists, and role-specific
procedures in `docs/*.md`.

## Diagnostic Entry Points

Run the exact entry point first for these question types and quote the raw
output. If the command returns no usable data, report **"데이터 부족"** exactly.

| Question type                              | First entry point                                          |
| ------------------------------------------ | ---------------------------------------------------------- |
| NAV change / gas burn / slippage / capital | `npm run report:capital-audit -- --json`                   |
| Full automation readiness blocker          | `node src/cli/check-full-automation-readiness.mjs --json`  |
| Refill refusal / capital plan decision     | `node src/cli/plan-capital-manager-refill-jobs.mjs --json` |
| Payback status / accrued sats / carry      | `npm run report:payback-status -- --json`                  |
| Dashboard truth                            | `dashboard/public/dashboard-status.json`                   |
| Call graph / symbol relation / path        | `npm run graph:focus -- query/explain/path`                |

## Core Context

- Product model: unattended **native BTC payback agent**.
- Accounting order: **BTC-denominated first**. Sats are policy truth; USD is
  projection only.
- Operator model: the operator is the user in single-account mode.
- Official BOB Gateway destination set is fixed to 11 chains:
  Ethereum, BOB, Base, BNB, Avalanche, Unichain, Berachain, Optimism,
  Soneium, Sei, Sonic.
- Arbitrum and Polygon are **not** official Gateway destinations.
- Small-capital mode is active while operating capital is below `$1,000`.
- Current execution state, dated funding notes, and historical snapshots belong
  in `docs/operator-memory.md`, not here.

## Objective Review

- Fresh diagnostics beat memory, docs, and prior transcripts.
- Source code beats research docs and planning docs.
- Status, capital, payback, readiness, and dashboard answers must cite the raw
  diagnostic/file output, not a remembered summary.
- Live NAV/balance conclusions require same-tick on-chain reads or the dedicated
  status/report command that performs them.

## Execution Safety

- No LLM in the live execution decision path. Runtime decisions come from
  deterministic policy and executor code only.
- Do not embed runtime LLM dependencies into signer, policy, capital, or
  payback execution paths.
- Private keys stay inside the signer daemon via env-referenced paths only.
- Runtime authority lives in committed code. Caps, policy thresholds, payback
  ratios, and safety gates are not raised by dashboard, Telegram, env, or ad-hoc
  operator prompts.
- `autoExecute: true` with committed caps means the lane is live; there is no
  separate manual promotion phase.
- Payback must remain deterministic, receipt-backed, and must **never**
  escalate position sizing.
- `logs/signer-audit.jsonl` and other audit logs are append-only records.

## Risk Limits

- Every live strategy must have committed `perTx`, `perDay`, and
  `maxDailyLossUsd` limits.
- Max consecutive failures is `3`; then auto-pause.
- If 24h PnL drops below `maxDailyLossUsd`, halt for the day.
- Capital and risk decisions must use live reads, not stale snapshots.
- Expected yield must subtract full round-trip costs:
  onramp fee + destination gas + offramp fee + slippage buffer.
- Policy/risk failures must surface explicitly; do not add silent fallbacks.

## graphify

- Use graphify first for callers, paths, symbol relationships, architecture
  questions, or any task likely to require reading 3 or more source files.
- Preferred entry point: `npm run graph:focus -- query|explain|path`.
- Use `npm run graph:focus -- status` for docs-only, architecture, or repo-shape
  checks before broad reading.
- Do not use graphify for exact numbers, version strings, `.md` research facts,
  or when the task is to edit a specific file directly.
- Graph reports live in `src/graphify-out/` and `graphify-out/`.

## Subagent Usage

Subagents and skills are optional execution aids, not a second source of truth.
Detailed delegation procedure lives in `docs/skill-usage-guidelines.md`; this
section states the non-negotiable law they inherit.

- `AGENTS.md` applies to every coding agent, skill, and delegated session.
- If the task name or description contains the literal word **`Gateway`**, do
  not use a skill or subagent. The primary session handles it directly.
- Every delegated prompt must start with:
  `Original Task Name: <verbatim user request>`.
- Every delegated session must execute the full 5-step Mandatory Verification
  Procedure from the next section before reading files or calling tools.
- Delegation stays inside the declared ownership in
  `docs/ai-agent-operations.md`. Cross-ownership work returns to the parent.

## Coding Agent Operating Mode

**Execution Mode** is the default for every coding session and delegated agent.

- Read the required docs, run the required diagnostics/graphify step, then do
  the implementation work.
- Integrate subagent output and continue the main unit of work; do not stop to
  emit summaries after intermediate results.
- Finish with a concise natural summary; do not force a
  `현재 단계: Ln` reporting template unless the user explicitly asks for it.

**Mandatory Verification Procedure (5 steps - execute in order on every
skill/subagent activation; no shortcuts; integrate then continue):**

1. Re-read in full: `AGENTS.md`, `docs/system-map.md`,
   `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`
   (BOB Gateway Protection section). Quote the `updated_at`/version headers to
   prove freshness.
2. Run the BOB Gateway Protection literal-word check (`\bGateway\b` or
   equivalent) against `Original Task Name:` and the full user request. If the
   word appears, emit the exact refusal block from
   `docs/skill-usage-guidelines.md` and halt. Absolute priority over later
   steps.
3. Enforce file scope: confirm the task is 100% inside this skill/agent's
   declared ownership (frontmatter + Role Agents table in
   `docs/ai-agent-operations.md`). Any other ownership or Gateway surface means
   refusal and return to the parent/coordinator.
4. Execute the AGENTS Diagnostic Entry Point(s) appropriate to the question type
   plus any graphify `query/explain/path` needed to keep reads minimal. Paste
   the exact raw command output; never summarize it as evidence.
5. Perform final hygiene verification: `git diff --stat`,
   `git diff --name-only`, `rg` caller search for deleted/renamed symbols, and
   the narrow Verification Matrix row(s) from `docs/harness-engineering.md`.
   Only then produce the deliverable. Never emit an unprompted multi-item
   checklist or Lx-style status report.

## Reporting Style

- Be concise, factual, and data-first.
- When the user asks for work, begin with a markdown checklist using
  `- [ ]` / `- [x]`.
- For readiness, capital, payback, and dashboard questions, quote raw evidence
  first.
- If a required command/file does not provide enough evidence, say
  **"데이터 부족"** instead of filling gaps with guesses.
- End with a natural concise summary. Do not force
  `현재 단계: Ln`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트`
  unless the user explicitly asks for that status format.

## Workspace Hygiene

- Source of truth: `src/**`, `test/**`, `scripts/**`, `docs/**`, `dashboard/**`
  source files, config, and agent definitions.
- Generated/operational artifacts: `dashboard/public/*.json`, `data/**`,
  `logs/**`, caches, coverage, temp outputs, and local scratch files.
- Do not stage generated artifacts unless the task explicitly says to publish a
  refreshed artifact.
- Do not delete audit histories as "cleanup".
- Use `docs/harness-engineering.md` for the Final Review Loop, Verification
  Matrix, Source Vs Generated rules, cleanup rules, and dashboard checklist.
