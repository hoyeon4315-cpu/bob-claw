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

## graphify

- 토폴로지/호출자/경로 질문 시 `npm run graph:focus -- query|explain|path`를 Read 전에 먼저 실행.
- 3개 이상 파일이 필요할 가능성이 있으면 graphify 우선.

## Reporting Style

- 작업 종료 시 **항상 짧은 종료 요약** (`현재 단계: Ln`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트` — 3개 이하).
- 추측 금지. 데이터에 기반.

## Workspace Hygiene

- `data/`, `dashboard/public/*.json`, `logs/` 등 생성 산출물은 기본적으로 git 추적 대상에서 제외.
- 의미 있는 실행 단위(CLI+테스트, 정책+회귀테스트 등)마다 자동 커밋.

---

**참고**:

- 상세한 "Unattended Execution Architecture", "Operator Memory", "Dev Automation Lane", "Payback Model" 등은 별도 문서로 이동하거나 요약 처리.
- 전체 Supreme Law (Gateway Protection + 5-Step 상세 + Execution Mode 상세)는 `docs/AGENT-SUPREME-LAW.md` 참조.

이 파일은 Phase 1 압축 결과입니다. (451줄 → 목표 200줄 이하)
