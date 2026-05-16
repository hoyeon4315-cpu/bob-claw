# BOB Claw Rules (Compressed - Phase 1)

**Note**: This is a compressed version under 10,000 characters. Full Supreme Law details have been moved to `docs/AGENT-SUPREME-LAW.md`.

---

## Engineering Map

- Before feature, policy, dashboard, cleanup, commit, or push work, read `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` after this file.
- The engineering confidence standard is **evidence-complete confidence**.

## Diagnostic Entry Points

진단 / 평가 / 분석 답을 만들기 전에 다음 명령을 먼저 호출한다.

| 질문 종류                                     | 먼저 호출할 entry point                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| NAV 변동 / gas burn / slippage / payback 누적 | `npm run report:capital-audit -- --json`                   |
| 완전 자동 readiness blocker                   | `node src/cli/check-full-automation-readiness.mjs --json`  |
| refill 거부 사유 / capital plan decision      | `node src/cli/plan-capital-manager-refill-jobs.mjs --json` |
| payback 상태 / 누적 sats / carry 사유         | `npm run report:payback-status -- --json`                  |
| dashboard 표면 상태                           | `dashboard/public/dashboard-status.json` 조회              |
| 코드 호출 그래프 / 심볼 관계                  | `python3 -m graphify query/explain/path`                   |

규칙:

- 명령 결과는 **그대로 인용**. 요약 금지.
- 데이터 없으면 "데이터 부족"이라고 그대로 보고.

## Core Operating Rules (요약)

- **Product model**: Native BTC payback agent. BTC-denominated first.
- **Operator = user**. Single-account mode.
- **All 11 official BOB Gateway destinations** in scope.
- **Small-capital mode** active while operating capital < $1,000.
- **No LLM in trade execution decision path**. Policy engine only.
- **No embedded runtime LLM**.
- Private keys never appear in LLM context, logs, or tool calls.
- Emergency stop is a file (`$KILL_SWITCH_PATH`).

## Risk Limits (핵심)

- Caps are code, not env vars.
- A strategy without per-tx / per-day / `maxDailyLossUsd` must not run.
- Max consecutive failures: 3 → auto-pause.
- Drawdown kill-switch: 24h PnL < `maxDailyLossUsd` → halt for the day.
- Auto kill-switch triggers: `src/risk/auto-kill-triggers.mjs`

## Execution Safety (핵심)

- Unattended, multichain, fully-automated execution.
- No manual promotion step.
- Private keys only inside signer daemon via env-referenced paths.
- **Payback never escalates sizing**.
- Live-read mandate: All NAV/balance queries must come from on-chain reads in the same tick.

## Supreme Law Reference

모든 코딩 에이전트, skill, subagent는 `docs/AGENT-SUPREME-LAW.md`에 정의된 다음 규칙을 따른다:

- BOB Gateway Protection (literal word check as first action)
- 5-Step Mandatory Verification Procedure
- Execution Mode (integrate and continue, no unsolicited status reports)
- Evidence-Complete Confidence

AGENTS.md에는 최소 강제 블록만 남기고, 상세 내용은 위 파일 참조.

## Subagent Usage & Coding Agent Operating Mode

- Execution Mode is the universal default.
- 5-Step Mandatory Verification Procedure must be executed on every skill/subagent activation (Gateway check = step 2).
- File scope strictly enforced.
- graphify first for topology/caller/path questions.
- No unsolicited Lx reports from subagents.

상세 내용: `docs/AGENT-SUPREME-LAW.md` 참조.

## Grok 4.3 + Grok Build Execution Rules (2026-05)

- Primary model: `grok-4.3` (reasoning_effort: medium 기본, architecture/risk/high-stakes 작업은 high).
- Non-trivial work (2파일 이상, 아키텍처 영향, payback/capital/signer/risk 관련): **무조건 Plan Mode부터 시작** 후 승인.
- 1파일 이상 변경 또는 고위험 작업 종료 전: 반드시 `reviewer-agent` (독립 리뷰 전담, 절대 코드 수정 금지, Benjamin+Lucas 강제) dispatch → verdict 통합 후 `verifier-agent`.
- tool 실행 결과는 절대 메모리로 요약하지 말고 raw stdout/stderr 그대로 인용.
- `grok inspect`를 새 세션 시작 시 또는 큰 변경 전에 한 번씩 실행하여 로딩된 규칙/스킬 확인.

## graphify

- 토폴로지/호출자/경로 질문 시 `npm run graph:focus -- query|explain|path`를 Read 전에 먼저 실행.
- 3개 이상 파일이 필요할 가능성이 있으면 graphify 우선.

## Reporting Style

- 추측 금지. 데이터에 기반.
- 작업 종료 시 자연스럽고 간결한 요약만 제공한다. `현재 단계: Ln`, `이번에 한 일`, `왜 아직 그 단계인지` 같은 강제 abbreviated template은 사용하지 않는다.
- 사용자가 작업을 요청하면, 해야 할 작업을 **markdown 체크리스트**(`- [ ]` / `- [x]`)로 먼저 명확히 나열한다. 완료된 항목은 `[x]`, 미완료 항목은 `[ ]`로 표시하며 진행에 따라 업데이트한다.

## Workspace Hygiene

- `data/`, `dashboard/public/*.json`, `logs/` 등 생성 산출물은 기본적으로 git 추적 대상에서 제외.
- 의미 있는 실행 단위(CLI+테스트, 정책+회귀테스트 등)마다 자동 커밋.

## 16-Team Live Collaboration Mode (B Model)

BOB Claw supports a first-class high-velocity parallel operating mode: the **16-Person Live Team (B Model)**.

- **Activation** (from main session): "16-team으로 시작해", "16인 라이브 팀으로 이 작업 해줘", "/16-team <task>", or equivalent English.
- **Use when**: multi-domain work (Opportunity + Evidence + Capital + Risk + Payback etc.), YCE yield lanes, E2E verification campaigns, large cross-ownership refactors, or when user requests parallel live team.
- **Do not use for**: literal "Gateway" tasks (full strict Supreme Law), high capital-risk production changes, or single-ownership quick fixes (use main coordinator or focused role agent instead).
- **How it works**: Engineering Manager + 6 Domain Leads (Capital & Treasury, Risk/Safety & Resilience, Execution & Policy, Payback & Gateway Settlement, Opportunity & Research, Evidence/Data & Quality) + 9 Specialists. Agents directly address each other by full title, Domain Leads pull specialists, `fork_context: true` + `background: true` for parallel, explicit handoff/joint-session patterns, all artifacts in `active-work/` and `decisions/`.
- **Relaxed Gateway (team-internal only)**: Literal-word Gateway refusal is suspended inside this mode for dev velocity on Gateway-related surfaces (still run all diagnostics, quote raw, never weaken caps/invariants). Full strict law applies outside the team and for production.
- **Parallel as default**: Multiple subagents spawned simultaneously whenever possible.
- **Canonical files**: `.grok/teams/live-16/` (README.md, protocol.md, all 15 roles/*.md including the 6 new Domain Lead definitions completed by Role Scaffolder, templates/, harness/, active-work/, decisions/) + `docs/16-team-operations.md` (full activation & policy guide) + `docs/16-team-quickstart.md` (copy-paste examples) + `docs/team/live-16/` (mirror for docs/harness visibility).
- **Integration**: Main coordinator delegates large multi-domain tasks via 16-team-manager; 16-team returns consolidated evidence-backed output for parent integration + verifier + harness.

Full details, team map, exact role file paths, and copy-paste flows: `docs/16-team-operations.md` and `docs/16-team-quickstart.md`.

**참고**:

- 상세한 "Unattended Execution Architecture", "Operator Memory", "Dev Automation Lane", "Payback Model" 등은 별도 문서로 이동하거나 요약 처리.
- 전체 Supreme Law (Gateway Protection + 5-Step 상세 + Execution Mode 상세)는 `docs/AGENT-SUPREME-LAW.md` 참조.
- 16-Team B Model 상세 운영 (activation commands, Domain Lead Direct Call, relaxed policy, artifact locations, role scaffolder output): `docs/16-team-operations.md` 참조.

이 파일은 Phase 1 압축 결과입니다. (451줄 → 목표 200줄 이하)
