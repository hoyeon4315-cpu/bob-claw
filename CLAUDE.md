# BobClaw Claude Bootstrap

**이 파일은 단순 redirect다. 모든 규칙·운영 원칙·non-negotiable·실행 정책은 항상 [AGENTS.md](/Users/love/BOB%20Claw/AGENTS.md)에서 읽는다.**

CLAUDE.md에 적힌 옛날 규칙이 AGENTS.md와 충돌하면 **언제나 AGENTS.md 우선**.

## 매 작업 시작 시

1. 먼저 `AGENTS.md` 전부 다시 읽는다 (캐시된 옛 규칙 신뢰 금지).
2. 필요하면 `docs/README.md`, 관련 코드.
3. 사실 근거: `docs/research/*.md`.
4. AI 에이전트 운영: `docs/ai-agent-operations.md`.
5. graphify: `AGENTS.md`의 graphify 섹션 기준.

## 보고 형식 / Working Style / 자동 커밋 정책

- 모두 `AGENTS.md`를 따른다. CLAUDE.md에는 더 이상 사본 없음.

## Repo Shape (간단 hint)

- 런타임: Node.js ES Modules (`.mjs`)
- 주요 디렉토리: `src/config/`, `src/strategy/`, `src/executor/policy/`, `src/executor/signer/`, `src/treasury/`, `src/executor/payback/`
- Python/YAML/pytest 들이밀지 않기.
