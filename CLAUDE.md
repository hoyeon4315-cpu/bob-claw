# BobClaw Claude Bootstrap

이 저장소에서 Claude가 작업할 때의 **단일 기준 문서**는 리포지토리 루트 [AGENTS.md](/Users/love/BOB%20Claw/AGENTS.md)다.
이 파일은 Claude가 시작점에서 놓치기 쉬운 것만 짧게 고정한다.

## Source Of Truth

- 규칙, 단계, 운영 원칙, 최신 blocker, 보고 형식: `AGENTS.md`
- 사실 근거와 수치 출처: `docs/research/*.md`
- 구현 전반 흐름: `docs/codex-playbook.md`
- graphify 사용 기준: `AGENTS.md`의 `graphify` 섹션

충돌 시 항상 `AGENTS.md`가 우선이다.

## Start Here

작업 시작 시 아래 순서로 본다.

1. `AGENTS.md`
2. 관련 코드
3. 필요한 경우에만 `docs/research/*.md`

`CLAUDE.md`만 읽고 판단하지 말고, 항상 `AGENTS.md`를 기준으로 작업한다.

## Non-Negotiables

1. 모든 실행 판단은 결정론적 정책 코드가 한다. Claude는 서명, 자금 이동, 승인, 페이백 비율/시점 결정을 직접 하지 않는다.
2. 회계와 KPI는 BTC 우선이다. USD는 표시용 projection이다.
3. 라운드트립 비용을 뺀 뒤에도 순이익이 양수일 때만 유효 후보로 본다.
4. 체인/토큰/엔드포인트/임계치는 코드 안에 하드코딩하지 말고 `src/config/*.mjs` 또는 해당 정책 모듈에 둔다.
5. cap 변경은 런타임이 아니라 커밋으로만 한다.
6. `logs/signer-audit.jsonl`은 append-only다. 삭제, 회전, 재작성 금지다.
7. Gateway 공식 목적지는 11개만 본다. Arbitrum/Polygon은 Gateway destination으로 취급하지 않는다.

## Repo Shape

- 런타임: Node.js ES Modules (`.mjs`)
- 설정: `src/config/*.mjs`
- 전략: `src/strategy/*.mjs`
- 정책 엔진: `src/executor/policy/`
- 서명 데몬: `src/executor/signer/`
- treasury / funding / refill planning: `src/treasury/`
- payback 관련 구현/상태 평가는 **항상 최신 `AGENTS.md`와 실제 코드 기준**으로 확인한다

Python/YAML/pytest 중심 새 구조를 기본값처럼 들이밀지 말고, 먼저 현재 `.mjs` 구조를 따른다.

## graphify

graphify는 “코드 연결 관계를 좁힐 때” 먼저 쓴다.

- 추천 시작:
  - `npm run graph:focus -- explain <symbol>`
  - `npm run graph:focus -- path <A> <B>`
  - `npm run graph:focus -- query "<question>"`
- broad query가 노이즈가 크면 바로 `path`/`explain`으로 좁힌다.
- 정확 수치, 문서 인용, 실제 수정 대상 파일 내용은 원문을 직접 읽는다.

## Working Style

- 사용자가 멈추라고 하지 않으면 작은 기능 단위까지 계속 민다.
- readiness queue만 반복하지 말고, 실제 blocker가 바뀌었는지 항상 다시 확인한다.
- 의미 있는 코드 변경 묶음이면 테스트 후 바로 작은 커밋으로 남긴다.
- 생성 산출물과 코드 변경을 한 커밋에 섞지 않는다.
- 관련 없는 미추적 파일은 건드리지 않는다.

## Reporting Style

작업 종료 보고는 항상 `AGENTS.md` 형식을 따른다.

- 첫 줄: `현재 단계: L0 / ...`
- 이어서 짧게:
  - `이번에 한 일`
  - `왜 아직 그 단계인지`
  - `다음 체크리스트`

추정 대신 방금 실행한 명령/파일 결과 기준으로만 쓴다.

## Claude-Specific Goal

Claude도 Codex와 **같은 기준으로** 일해야 한다.

- 최신 규칙은 중복 복사하지 말고 `AGENTS.md`를 참조한다.
- 오래된 요약 규칙을 Claude 전용 로컬 진실처럼 유지하지 않는다.
- blocker, 단계, strategy 상태는 고정 기억으로 말하지 말고 필요 시 최신 산출물로 다시 확인한다.
