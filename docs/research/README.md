# docs/research — 사실 참조 라이브러리

> **이 디렉토리의 성격**: 리서치 사실 모음. **규칙이 아님.**
> **운영 규칙**: 리포 루트 `AGENTS.md`.
> **작업 규율**: `docs/codex-playbook.md`.

---

## 왜 운영 규칙과 분리되어 있는가

BobClaw의 3층 문서 구조:

| 층 | 파일 | 답하는 질문 | 변경 빈도 |
|---|---|---|---|
| 규칙 | `AGENTS.md` | "무엇을 해야/하지 말아야 하는가" | 낮음 (저장소 구조 변화 시) |
| 규율 | `docs/codex-playbook.md` | "Codex에게 어떻게 일을 시키는가" | 중간 (실무 패턴 발견 시) |
| **사실** | **`docs/research/*.md`** | **"수치·근거·외부 사실은 무엇인가"** | **높음 (월 1회 이상)** |

이 분리의 목적: 외부 세계 수치가 바뀌어도 운영 규칙이 흔들리지 않음. `baseRatio=0.20`을 바꾸는 건 `src/config/payback.mjs` + `payback-rationale.md` 수정이고, 그것이 **AGENTS.md 수정을 요구하지 않는다**.

---

## 사용 규칙

### 1. 인용 방식 (프롬프트에서)

```
사실·수치가 필요하면 docs/research/<파일>.md §<N>에서 인용 (규칙 아닌 참조).
```

한 번에 하나의 사실 문서만 참조. 여러 문서가 필요하면 각 섹션을 번호로 지정.

### 2. 이 문서들이 **하지 않는** 것

- 운영 규칙 정의 (`AGENTS.md`가 함)
- Codex 작업 순서 지시 (`codex-playbook.md`가 함)
- 특정 구현을 강제 (예: "Python으로 짜라") — 구현 제약은 `AGENTS.md`·`codex-playbook.md` 영역
- 미래 약속 ("Q2에 이걸 구현하겠다") — 사실 문서는 현재 시점 스냅샷만 기록

### 3. 이 문서들이 **하는** 것

- 외부 수치 근거 보관 (TVL, APY, gas, 체인 목록)
- 수학 공식 참조 (IL, HF, Kelly, DCA)
- 과거 사건 사실 (Solv BRO, USDC depeg, Aave-on-BOB halt)
- 기본값의 "왜 그 숫자인가" 설명 (payback-rationale)

### 4. 업데이트 규칙

모든 사실 문서는 각 Part/섹션에서 **(출처 URL + 확인 날짜)**를 명시한다. 재검증 후 수치가 바뀌면:

1. 해당 research 문서 섹션 + 이력 항목 업데이트
2. 그 수치를 사용하는 `src/config/*.mjs` 동반 업데이트 (필요 시)
3. PR 본문에 "어떤 research 섹션이 바뀌었고 어느 config가 연동 변경됐는가" 기재

운영 규칙(AGENTS.md)이 변경돼야 할 만큼의 변화라면, 그건 **research 이슈가 아니라 설계 이슈** — 별도 세션으로 분리.

---

## 파일 인덱스

### `bob-ecosystem.md`

BOB 3층 구조, Gateway 5단계 동작, round-trip 비용, **공식 11개 destination chain**, BOB 생태계 규모, BTC 파생자산 매트릭스, Solv BRO 사건, BOB L2 프로토콜 배포 상태(Aave-on-BOB halted 포함), BOB 로드맵.

**가장 자주 인용되는 곳**:
- §1.4 (체인 목록) — Codex가 Arbitrum/Polygon을 Gateway destination으로 넣으려 할 때 차단
- §1.3 (round-trip 비용) — 페이백 경제성 검증
- §1.7 (Solv BRO) — SolvBTC 계열 exposure 결정

### `strategies-and-risk.md`

Looping 수학 (L=1/(1-LTV), Net APY, HF), BTC denominated PnL 환산, Health Factor 권장치, 역사적 청산·해킹 사례, 프로토콜 TVL 매트릭스, IL/CL 수학, ALM 매니저 비교, BTCfi 프로토콜 상세 (Babylon/Lombard/Solv/Bedrock), Moonwell cbBTC 파라미터, Bitcoin L2 비교.

**가장 자주 인용되는 곳**:
- §1.1 (루핑 수학) — `wrapped-btc-loop-base-moonwell` 파라미터 근거
- §4.2 (Moonwell CF=0.81 → LTV_max=0.54) — HF 1.5 제약 수식
- §2.5 (분산 상한 참고값) — `src/config/strategy-caps.mjs` 배분 합당성

### `payback-rationale.md`

`src/config/payback.mjs` 기본값의 이론적 근거 — Half-Kelly 근사, DCA 연구, Mayer Multiple, Tether/ARK/Fidelity 정책 사례. KPI (BYR, CG, TBR, Round-trip 효율, Days to Breakeven) 계산식 상세. Emergency pause triggers 3종 근거. 재검증 트리거 조건.

**가장 자주 인용되는 곳**:
- §1.1 (baseRatio=0.20 왜) — payback 비율 변경 PR 시
- §2 (KPI 계산식) — accumulator.mjs 구현 근거
- §4 (재검증 트리거) — 월간 재검증 프로세스

### `ops-costs.md`

EIP-1559/4844/7702, 체인별 tx 비용 실측(11 체인), 가스 리저브 공식(safetyMultiplier=5, liquidation defense p99×3×1.5), 비상 임계치, MEV 보호 도구, 가스 리필 브릿지. 과적합 방지 체크리스트 (WFA purged/embargoed, Deflated Sharpe, CSCV PBO, WFE), 하드코딩 안티패턴, 적응형 임계치, 재검증 cron 주기.

**가장 자주 인용되는 곳**:
- §1.2 (체인별 실측 가스) — 전략별 min profit floor 설정
- §2.1 (백테스트 체크리스트) — 신규 전략 제안 시 필수 게이트
- §2.2 (하드코딩 안티패턴) — Codex 코드 리뷰 시

---

## 이 디렉토리에 **추가되면 좋은** 문서 (아직 없음)

필요해질 때 만들 것:

- `protocol-deep-dive-<protocol>.md` — 특정 프로토콜(Moonwell, Morpho, Aave v3)의 파라미터·거버넌스·감사 이력 상세. 현재는 `strategies-and-risk.md`에 요약만.
- `post-mortem-<incident-id>.md` — 실제 발생한 exploit·loss 사후 분석. 현재는 Solv BRO만 `bob-ecosystem.md`에 요약.
- `oracle-whitelist.md` — `src/config/oracles.mjs`에 pinned된 data source 목록과 각각의 신뢰성 평가. `payback-rationale.md` §1.3 (Mayer Multiple) 근거.
- `audit-reports.md` — Pashov/Common Prefix/기타 감사 보고서 인용 및 핵심 발견 사항.

**주의**: 위 문서는 **필요해지기 전에 미리 만들지 말 것**. 이전 세션의 v4 greenfield 폭주 패턴 (실제 쓰임 없는 스키마를 미리 다 만드는) 재발 방지.

---

## 문서 작성 원칙

1. **출처 URL + 확인 날짜** 필수
2. **주관적 평가 금지** — "좋다/나쁘다" 대신 숫자·관찰된 사실·인용
3. **추측 금지** — 불확실한 것은 "확인 필요" 또는 "미확인"으로 명시
4. **Operator Memory와 중복 금지** — AGENTS.md Operator Memory는 **이 저장소의 실측 실행 기록**, research 문서는 **외부 세계 사실**. 중복되면 AGENTS.md를 정본으로.
5. **섹션 번호 유지** — 다른 문서가 "§X.Y"로 인용하므로 번호 재배치 시 인용처 동반 수정

---

## 문서 이력

- 2026-04-17: 디렉토리 생성. 4개 문서(`bob-ecosystem`, `strategies-and-risk`, `payback-rationale`, `ops-costs`)로 출발. v3 가이드라인(`bobclaw-guidelines-v3-final.md`)의 Part 1·3·4·5·6·7·9·12 사실 콘텐츠를 이곳으로 이전. v3 Part 2·8·10·11·13의 구현 가정(Python/YAML/주차별 rollout)은 실제 저장소(.mjs/Node.js/no phase gate)와 맞지 않아 폐기.
