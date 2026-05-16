# Grok Build Agent OS Phase 1 Implementation Plan

> **Superseded note:** Historical references below to `BOB Gateway Protection` or
> a literal-word `Gateway` refusal are no longer current repo law. Follow the
> live scope/ownership guardrails in `AGENTS.md` and
> `docs/AGENT-SUPREME-LAW.md` instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AGENTS.md를 10,000자 이하로 압축하고, Supreme Law를 `docs/AGENT-SUPREME-LAW.md`로 단일화하며, `.grok/` 기본 구조를 만들어 Grok Build 네이티브 전환의 기반을 마련한다.

**Architecture:** 
- Supreme Law의 상세 내용은 `docs/AGENT-SUPREME-LAW.md` 하나로 통합 (하이브리드 방식).
- AGENTS.md에는 핵심 운영법 + 진단 진입점 + 최소 강제 규칙만 남김.
- `.grok/` 디렉토리를 신규 생성하여 Grok Build 공식 구조를 시작.
- 기존 `.claude/agents/`는 Legacy로 표시만 하고 삭제하지 않음.

**Tech Stack:** Markdown 문서, Grok Build project rules, `.grok/` 디렉토리 구조

---

## Task 1: docs/AGENT-SUPREME-LAW.md 생성

**Files:**
- Create: `docs/AGENT-SUPREME-LAW.md`

- [ ] Step 1: `docs/AGENT-SUPREME-LAW.md` 파일을 생성하고 아래 내용을 정확히 작성
  - BOB Gateway Protection (Hard Rules + Enforcement Procedure + 정확한 거부 메시지)
  - 5-Step Mandatory Verification Procedure (전체)
  - Execution Mode 규칙
  - Reporting Discipline
  - Mandatory Embedding Rule (하이브리드 버전 명시)

- [ ] Step 2: 파일 상단에 `updated_at: 2026-05-17`와 `status: canonical` 헤더 추가

- [ ] Step 3: `git add docs/AGENT-SUPREME-LAW.md && git commit -m "docs: add AGENT-SUPREME-LAW.md as single source of truth (Phase 1)"`

---

## Task 2: AGENTS.md 대폭 압축 (10,000자 이하)

**Files:**
- Modify: `AGENTS.md`

- [ ] Step 1: 현재 AGENTS.md의 주요 섹션을 분석하고, 아래 항목만 남기고 나머지는 제거 또는 `docs/AGENT-SUPREME-LAW.md` 참조로 대체
  - Product Model 및 Operator Memory 핵심
  - Diagnostic Entry Points 테이블 (그대로 유지)
  - Role Agents 소유권 테이블 (요약)
  - Codex 하네스 경계
  - Live safety 핵심 규칙 (간략)
  - Supreme Law 최소 강제 블록 (Gateway literal check + 5-step 참조 강제 + Execution Mode)

- [ ] Step 2: 압축 후 `wc -c AGENTS.md`로 글자 수 확인 (10,000자 이하 목표)

- [ ] Step 3: `git diff AGENTS.md` 확인 후 커밋
  `git commit -m "docs: compress AGENTS.md under 10k chars (Phase 1)"`

---

## Task 3: .grok/ 기본 구조 생성

**Files:**
- Create: `.grok/config.toml`
- Create: `.grok/agents/README.md`
- Create: `.grok/skills/README.md`

- [ ] Step 1: `.grok/` 디렉토리 생성
  ```bash
  mkdir -p .grok/agents .grok/skills
  ```

- [ ] Step 2: `.grok/config.toml`에 최소 설정 작성
  ```toml
  [subagents]
  enabled = true

  [skills]
  paths = [".grok/skills"]
  ```

- [ ] Step 3: 각 README에 "Grok Build Native Structure (Phase 1)" 설명 작성

- [ ] Step 4: 
  ```bash
  git add .grok/
  git commit -m "feat: initialize .grok/ native structure for Grok Build (Phase 1)"
  ```

---

## Task 4: 기존 .claude/agents/에 Legacy 표시 추가

**Files:**
- Modify: `.claude/agents/bob-claw-coordinator.md`
- Modify: `.claude/agents/*.md` (7개 파일 전체)

- [ ] Step 1: 7개 agent 파일의 description과 파일 상단에 Legacy 안내 문구 추가
  예시:
  ```markdown
  > **Legacy Support**: This agent is maintained for Claude Code compatibility only.
  > Grok Build primary users should use the native structure under `.grok/agents/`.
  ```

- [ ] Step 2: `git add .claude/agents/ && git commit -m "docs: mark .claude/agents/ as legacy for Claude Code (Phase 1)"`

---

## Task 5: Phase 1 완료 검증

**Files:**
- No code change

- [ ] Step 1: 다음 명령 실행 및 결과 확인
  ```bash
  wc -c AGENTS.md
  ls -la .grok/
  ls docs/AGENT-SUPREME-LAW.md
  grok inspect
  ```

- [ ] Step 2: `git status`와 `git log --oneline -5` 확인

- [ ] Step 3: Phase 1 완료 후 사용자에게 결과 보고

---

## Self-Review Notes (작성자)

- 이 계획은 Phase 1에만 집중. Phase 2~4는 별도 계획으로 분리.
- 모든 task는 5~15분 내 실행 가능한 수준으로 분해.
- Supreme Law 강제력 유지에 가장 중점을 둠.
- Codex 하네스는 전혀 건드리지 않음.

**Plan saved to:** `docs/superpowers/plans/2026-05-17-grok-build-agent-os-phase1.md`