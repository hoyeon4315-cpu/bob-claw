# BOB Claw Rules (Compressed - Phase 1)

**Note**: This is a compressed version under 10,000 characters. Full Supreme Law details have been moved to `docs/AGENT-SUPREME-LAW.md`.

---

## Engineering Map

- Before any work, read `docs/system-map.md`, `docs/harness-engineering.md` after this file.
- Multi-domain / ambitious work → **16-Team (B Model)부터 활성화**. Isolated single-file work만 Normal Execution Mode.
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

## Grok Build Execution (Slim)

- Primary: `grok-4.3`.
- For capital/NAV/payback/refill questions or safety claims: **always run the Diagnostic Entry Points first** and quote the raw `--json` output exactly (see table above). No exceptions.
- For genuinely ambiguous or high-risk multi-file changes, use the `enter_plan_mode` tool yourself before coding.
- After meaningful edits on non-trivial work, consider dispatching verifier-agent or the readiness skill for independent hygiene.
- Tool results: quote raw stdout/stderr on diagnostics and verification. No silent summarization on critical paths.
- The old heavy 16-Team B-Model, mandatory reviewer-agent (Benjamin+Lucas), and "must use Plan Mode for non-trivial" ritual have been removed (2026-05 cleanup). Direct execution is now preferred. The 3 kept native agents (coordinator, verifier, readiness skill) still enforce Supreme Law + Gateway literal protection when delegating.

## graphify

- 토폴로지/호출자/경로 질문 시 `npm run graph:focus -- query|explain|path`를 Read 전에 먼저 실행.
- 3개 이상 파일이 필요할 가능성이 있으면 graphify 우선.

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

이 파일은 slim Grok-native 버전입니다 (2026-05 대대적 정리 후). 16-Team B-Model, reviewer-agent 강제, 과도한 subagent ritual은 제거되었습니다. 핵심 안전 규칙 (Diagnostic Entry Points, Supreme Law, no LLM in execution path) 은 그대로 유지됩니다.
