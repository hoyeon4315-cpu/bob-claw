# BobClaw Claude Instructions (요약판)

전체 근거 문서: 리포지토리 루트 `AGENTS.md`. 모든 상세·표·수치는 거기에 있다.
이 파일은 Claude가 매 작업에서 잊으면 안 되는 "불변 골격"만 담는다.
상세 근거가 더 필요하면 항상 `AGENTS.md` 우선 참조.

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

이 프로젝트에는 graphify 지식 그래프가 있다: `src/graphify-out/` (앱 코드) + `graphify-out/` (레포 전체).
post-commit / post-checkout git 훅이 이미 설치되어 있어 그래프는 커밋마다 자동 갱신된다. 수동 `graphify update` 호출은 훅 실패 시에만.

### 사용 판단 (토큰 절감 목적, 객관 트리거)

**graphify 먼저 쓸 것** — 벤치상 3~10x 토큰 절감이 실제 발생:
- "X가 무엇에 연결?"·"이 함수의 호출자"·"이 모듈의 이웃 10개" → `python3 -m graphify query "질문" --graph src/graphify-out/graph.json`
- 단일 심볼의 관계 설명 → `python3 -m graphify explain "심볼명" --graph src/graphify-out/graph.json`
- 두 개념 사이 경로 추적 → `python3 -m graphify path "A" "B" --graph src/graphify-out/graph.json`
- 아키텍처 전반 훑기 → `src/graphify-out/GRAPH_REPORT.md` 읽기
- 레포 루트 스크립트·vendored 코드 관련 → `graphify-out/GRAPH_REPORT.md`
- **3개 이상 파일을 Read할 것 같으면 먼저 `graphify query`로 관련 노드만 추려 Read 수를 줄인다**

**graphify 쓰지 말 것** — 요약 과정에서 정확성 손실:
- 정확 수치·인용·버전 문자열 추출
- `docs/research/*` 및 기타 .md 문서 질문 (현재 그래프는 .mjs/.js AST만 포함, 문서 노드 아님)
- 버그 원인·로직 분석·주석 내 의도 파악
- 구체 코드 수정 직전의 파일 (수정 대상은 반드시 Read)

### 운영
- 기본 그래프는 `src/graphify-out/graph.json` (앱 코드, 연결성 99.5%). 루트 그래프는 테스트/vendored 포함으로 92% — 보조용.
- 허브 노드에 `slice()`, `sort()`, `main()` 같은 제네릭 이름이 있음 — 질의 시 파일 경로로 필터링 권장.
- 훅 상태 확인: `python3 -m graphify hook status`.
