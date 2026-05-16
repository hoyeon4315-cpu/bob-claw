# Grok Build Work Rules Optimization
## Grok-Native Agent Operating System 설계

> **Superseded note:** This design document records an older rule set. Historical
> references below to `BOB Gateway Protection` or a literal-word `Gateway`
> refusal are superseded by the current scope/ownership guardrails in
> `AGENTS.md` and `docs/AGENT-SUPREME-LAW.md`.

**작성일**: 2026-05-17  
**작성자**: Grok (brainstorming skill 기반 설계)  
**상태**: User Approved (2026-05-17)  
**버전**: 1.0

---

## 1. Executive Summary

BOB Claw 프로젝트는 현재 **Claude Code 중심**의 복잡한 Agent Operating System을 운영하고 있다. 이 시스템은 안전 규칙(BOB Gateway Protection, 5-Step Verification, Execution Mode)을 철저히 강제하기 위해 설계되었으나, 실제 작업의 대부분이 **Codex 하네스**와 **Grok Build**를 통해 이루어지고 있다는 현실과 맞지 않는다.

주요 문제:
- AGENTS.md (76,552자)와 skill-usage-guidelines.md가 과도하게 비대해짐
- Supreme Law(BOB Gateway Protection 등)가 1 skill + 7 agents에 verbatim 중복되어 유지보수 비용이 매우 높음
- `.claude/` 구조가 Grok Build의 공식 권장 구조(`.grok/`)와 불일치
- Grok Build 사용 시 토큰 낭비와 인지 부하가 큼

**결정**: Grok Build를 **진짜 주 시스템**으로 전환하는 점진적 네이티브화(Approach 1)를 채택. Claude Code 관련 구조는 Legacy로 명확히 분리.

---

## 2. 현재 상태 문제 분석

### 2.1 크기 및 중복 문제
- `AGENTS.md`: 76,552자 (Grok Build 공식 limit 10,000자 초과 7.6배)
- `docs/skill-usage-guidelines.md`: 50,011자
- `.claude/agents/` 7개 파일 총 653줄 (대부분 Supreme Law verbatim 복제)

### 2.2 구조적 불일치
- Grok Build는 `.grok/skills/`, `.grok/agents/`, `.grok/config.toml`을 공식 지원
- 현재 프로젝트는 `.claude/`만 존재하며, Claude Code 호환에 최적화됨
- Codex 하네스는 별도로 잘 운영되고 있으나, Agent OS와의 연계가 약함

### 2.3 안전 규칙 전달 방식의 비효율
- 가장 중요한 규칙(BOB Gateway Protection)이 여러 파일에 복제되어 있어, 수정 시 9곳 이상을 동시에 고쳐야 함
- 규칙이 "보이지 않게" 될 위험 존재

---

## 3. 설계 목표

1. **Grok Build 네이티브 우선**: Grok Build 세션에서 가장 효율적이고 자연스럽게 동작하는 Agent OS를 만든다.
2. **Supreme Law 강제력 유지**: BOB Gateway Protection 등 핵심 안전 규칙의 강제력은 절대 약화시키지 않는다.
3. **중복 최소화**: Supreme Law 관련 중복을 80% 이상 제거한다.
4. **Codex 존중**: Codex 하네스(`src/llm/`, `codex-*` CLI)는 최대한 변경하지 않는다.
5. **점진적 전환**: 기존 작업 흐름을 크게 방해하지 않으면서 안전하게 전환한다.
6. **AGENTS.md 10,000자 준수**: truncation 위험을 제거한다.

---

## 4. 최종 아키텍처 (Grok Build Native Hybrid)

### 4.1 핵심 원칙

- **Supreme Law는 하이브리드 방식**으로 관리
  - 전체 상세 내용 → `docs/AGENT-SUPREME-LAW.md` (단일 진실 공급원)
  - 가장 중요한 강제 규칙(Gateway literal trigger, 5-step 참조 강제, Execution Mode)은 AGENTS.md에 **최소한으로 남겨 강제력 확보**

- **디렉토리 구조**
  - `.grok/` → Grok Build 주 시스템 (신규)
  - `.claude/` → Claude Code Legacy (기존 파일 유지, 신규 개발 중단)

- **Agent/Skill 분리**
  - Grok Build용: `.grok/agents/`, `.grok/skills/`
  - Claude Code용: `.claude/agents/`, `.claude/skills/` (Legacy 표시)

### 4.2 파일 위치 전략

| 항목                          | 최종 위치                          | 비고 |
|-------------------------------|------------------------------------|------|
| Supreme Law 전체 상세         | `docs/AGENT-SUPREME-LAW.md`        | 신규, 단일 진실 공급원 |
| AGENTS.md                     | repo root                          | 10,000자 이하로 압축 |
| Grok Build 네이티브 Agents    | `.grok/agents/`                    | 신규 (verifier-agent부터 시작) |
| Grok Build 네이티브 Skills    | `.grok/skills/`                    | 신규 |
| 기존 Role Agents (7개)        | `.claude/agents/`                  | Legacy 표시만 추가 |
| Master Decision Matrix        | `docs/skill-usage-guidelines.md`   | Grok 중심으로 재작성 |
| `.grok/config.toml`           | `.grok/config.toml`                | 신규 |

---

## 5. 4단계 마이그레이션 계획 (최종 확정)

### Phase 1: 기반 정리 (즉시 실행 추천)
**목표**: Supreme Law 단일화 + AGENTS.md 정상화 + Grok Build이 인식할 최소 구조 확보

**주요 작업**
- `docs/AGENT-SUPREME-LAW.md` 생성 (하이브리드 버전)
- `AGENTS.md` 10,000자 이하로 대폭 압축
- `.grok/config.toml` 생성
- `.grok/agents/`, `.grok/skills/` 디렉토리 생성 + README
- 기존 7개 `.claude/agents/*.md`에 Legacy 표시 추가

**검증**
- `grok inspect`로 rules 로딩 확인
- AGENTS.md 글자 수 확인

### Phase 2: Grok 네이티브 핵심 도구 도입
**목표**: 실제로 쓸 수 있는 Grok 네이티브 도구를 먼저 안착시킨다.

**주요 작업**
- `.grok/agents/verifier-agent.md` 생성 (Grok 최적화)
- `.grok/skills/bob-claw-readiness-safety-verification/SKILL.md` 생성
- coordinator agent는 **이 단계에서는 만들지 않음** (안전 고려)

**이유**: verifier-agent부터 만들어 검증 문화를 먼저 네이티브로 안착시키는 것이 더 안전하다.

### Phase 3: 판단 체계 재편 (Master Decision Matrix)
**목표**: "무엇을 할 때 어떤 것을 써야 하는지"를 Grok Build 중심으로 명확히 정리

- `docs/skill-usage-guidelines.md`의 Master Decision Matrix 대대적 업데이트
- Grok Build 상황을 최우선으로 배치
- Codex 전용 상황과 Claude Legacy 상황을 명확히 구분

### Phase 4: Legacy 완전 정리 (4~6개월 후)
**실행 조건** (엄격 적용)
- 최소 4개월 이상 Grok Build 네이티브로 주요 작업 수행
- 최소 3개 이상의 큰 작업 단위를 `.grok/` 구조로 성공적으로 완료
- 운영자가 “Claude Code는 이제 거의 안 쓴다”고 명시적으로 선언

**작업 내용**
- `.claude/` 하위 파일들을 `docs/legacy/claude-code-agents/`로 이동 또는 삭제
- 관련 문서에서 Claude Code 참조 대폭 축소

---

## 6. Phase 1 상세 실행 계획 (이번 작업 추천 범위)

1. `docs/AGENT-SUPREME-LAW.md` 작성
2. `AGENTS.md` 압축 작업 (운영자와 함께 리뷰 필수)
3. `.grok/` 기본 구조 생성
4. Legacy 표시 작업
5. `grok inspect` 및 간단한 동작 테스트

**주의**: Phase 1 완료 후 반드시 운영자 리뷰를 거친 후 Phase 2로 진행.

---

## 7. 위험 및 완화 방안

| 위험 | 영향도 | 완화 방안 |
|------|--------|----------|
| Supreme Law 강제력 약화 | 매우 높 | 하이브리드 방식 채택 (핵심 규칙은 AGENTS.md에 최소 유지) |
| AGENTS.md 압축 과정에서 중요 내용 누락 | 높 | Phase 1 후 운영자 공동 리뷰 필수 |
| 새로운 `.grok/` 구조가 익숙하지 않아 혼란 | 중 | README와 Matrix에 명확한 가이드 작성 |
| Codex 작업 흐름 방해 | 중 | Codex 하네스는 최대한 건드리지 않음 |
| Phase 4를 너무 일찍 실행 | 높 | 실행 조건을 매우 엄격하게 설정 |

---

## 8. 성공 기준

- AGENTS.md가 10,000자 이하를 지속적으로 유지
- Supreme Law 수정 시 수정해야 할 파일이 2곳 이하로 감소
- Grok Build 세션에서 "이 task는 어떤 agent/skill을 써야 하지?"라는 질문이 명확히 답변될 수 있음
- 3개월 후에도 "Grok Build로 작업하는 게 더 편하다"는 체감이 있음

---

## 9. 다음 단계

1. 본 설계 문서에 대한 최종 리뷰 및 승인
2. `writing-plans` skill을 사용하여 Phase 1 구현 계획 상세 작성
3. Phase 1 실제 실행 (AGENTS.md 압축 + `docs/AGENT-SUPREME-LAW.md` 생성)

---

**문서 끝**

*이 문서는 brainstorming skill 프로세스를 통해 작성되었으며, 사용자 승인 후 `writing-plans` skill로 넘어가 구현 계획을 수립할 예정입니다.*