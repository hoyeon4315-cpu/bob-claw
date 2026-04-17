# BobClaw Copilot Instructions (요약판)

전체 근거 문서: 리포지토리 루트 `AGENTS.md`. 모든 상세·표·수치는 거기에 있다.
이 파일은 Copilot이 매 작업에서 잊으면 안 되는 "불변 골격"만 담는다.

- 작업 규율: `docs/codex-playbook.md`
- 사실 참조: `docs/research/*.md` (수치·근거 인용만, 규칙 아님)

## 언어·구조 (혼동 금지)

본 저장소는 **Node.js ES Modules (.mjs)**. Python·YAML 설정·pytest·주차별 rollout·USD-only PnL은 전부 폐기된 패턴. 생성 시 즉시 reject.

- 설정: `src/config/*.mjs` (코드 모듈, YAML 아님)
- 전략: `src/strategy/*.mjs`
- 정책 엔진: `src/executor/policy/`
- 서명 데몬: `src/executor/signer/daemon.mjs`
- 페이백 엔진: `src/executor/payback/` (accumulator + scheduler, **이미 scaffolded**)
- 감사 로그: `logs/signer-audit.jsonl` (append-only, 회전·삭제·재작성 금지)

## 불변 원칙 5개 (위반 시 즉시 reject)

1. **결정론**: LLM은 서명·자금 이동·승인·**페이백 비율/시점 결정**에 직접 개입 금지. LLM 출력은 반드시 `src/executor/policy/`를 통과한 뒤 결정론적 executor가 트랜잭션을 구성. `src/executor/signer/`·`src/executor/policy/`·`src/executor/payback/`에 LLM SDK import 금지.
2. **BTC 단위 회계**: 모든 PnL·리스크·한도는 satoshi 단위. USD·stablecoin은 "표시용 환산값"이며 정책 결정 입력으로 쓰지 않는다.
3. **라운드트립 비용 차감**: 전략 기대 수익은 `expected_yield_sats − (onramp_fee + destination_gas + offramp_fee + slippage_buffer)`. 편도 비용만 쓰는 코드는 reject.
4. **하드코딩 금지**: chain_id, 토큰 주소, 엔드포인트, 수수료 bps, 임계치는 전부 `src/config/*.mjs`. 소스 내 리터럴 금지.
5. **Cap은 코드, env가 아니다**: per-strategy / per-tx / per-day / maxDailyLossUsd 및 페이백 cap 변경은 **커밋 다이프로만**. 런타임·대시보드·텔레그램에서 상향 금지.

## 금지 표현 (주석·docstring·로그에서도 금지)

"적절히", "일반적으로", "보통", "대략", "상황에 따라" → 숫자·조건식·임계치로 표현.

## BOB Gateway 공식 지원 체인 (정확히 11개)

Ethereum(1), BOB L2(60808), Base(8453), BNB(56), Avalanche(43114), Unichain(130), Berachain(80094), Optimism(10), Soneium(1868), Sei(1329), Sonic(146).

**Arbitrum·Polygon은 Gateway 공식 지원 아님**. Gateway destination으로 지정하면 즉시 reject. 필요 시 post-Gateway 수동 브릿지 경로로만.

## Phase gate 없음

`autoExecute: true` + 유효한 cap이 커밋되면 즉시 실행. "1~N주차 rollout"·"live 승격" 같은 표현 금지.

## 커밋 전 체크리스트

1. 관련 `npm run report:*` 명령이 정상 JSON 반환
2. 새 파일은 `.mjs`, 기존 import 패턴 준수
3. `logs/signer-audit.jsonl` 스키마 무변경
4. package.json에 선언된 테스트 명령이 green
5. 수치 다루면 BTC(sats) 필드 먼저, USD는 projection
6. PR 본문에 "어떤 불변 원칙을 건드렸는가" 답 명시
7. 의심되면 멈추고 질문 — 임의 판단·다른 프로젝트 관행 대입 금지

## graphify

Knowledge graph at `src/graphify-out/` (app code) and `graphify-out/` (repo-wide). Git hooks auto-refresh on commit/checkout.

Use graphify (3-10x token reduction) when:
- Asked "what connects to X" / "callers of this function" / "neighbors of this module" → run `python3 -m graphify query "질문" --graph src/graphify-out/graph.json`, or `explain "X"`, or `path "A" "B"`.
- Broad architecture sweep → read `src/graphify-out/GRAPH_REPORT.md` first.
- Root scripts / vendored code → read `graphify-out/GRAPH_REPORT.md`.
- About to open 3+ files to answer → query graph first to narrow down.

Do NOT use graphify when:
- Need exact numbers, quotes, or version strings (summary loses precision).
- Question is about `docs/research/*` or any .md (graph indexes .mjs/.js AST only, not docs).
- Bug root-cause or logic analysis.
- File is about to be edited — always read the file itself.

Type `/graphify` only when a graph is missing or needs manual rebuild; hooks handle normal updates.
