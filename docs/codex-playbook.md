# BobClaw · Codex 작업 플레이북

> **단독 근거**: 리포 루트 `AGENTS.md`.
> **상태 근거**: `README.md` + `npm run report:*` 실행 결과.
> **리서치 근거**: `docs/research/*.md` (사실 참조 전용, 규칙 아님).
> **폐기된 문서**: 이전 세션의 `AGENTS1.md(v4)`·초기 `bobclaw-codex-playbook.md` — 다른 프로젝트(Python/greenfield) 전제. 본 문서가 대체.

---

## 0. 이 프로젝트의 실제 모습 (혼동 금지 매트릭스)

| 항목 | 실제 값 | Codex가 자주 착각하는 값 (금지) |
|---|---|---|
| 언어 | Node.js ES Modules | Python |
| 파일 확장자 | `.mjs` | `.py` |
| 체인 라이브러리 | ethers v6 | web3.py |
| 설정 위치 | `src/config/*.mjs` (코드 모듈) | `config/*.yaml` |
| 전략 위치 | `src/strategy/*.mjs` | `bobclaw/strategies/*.py` |
| 정책 엔진 | `src/executor/policy/` | `bobclaw/core/policy_engine.py` |
| 서명 데몬 | `src/executor/signer/daemon.mjs` | `infra/signer.py` |
| 자본 관리 | `src/executor/capital/` | — |
| **페이백 엔진** | **`src/executor/payback/` (scheduler + accumulator) — scaffolding 이미 존재 (2026-04-17)** | — |
| 감사 로그 | `logs/signer-audit.jsonl` (append-only) | — |
| 대시보드 상태 | `dashboard/public/dashboard-status.json` | — |
| 테스트 프레임워크 | **package.json 확인 필수 (추측 금지)** | pytest |
| 회계 단위 | **BTC (사토시), USD는 표시용** | USD 단위 PnL |
| Phase gate | **없음.** `autoExecute: true`면 즉시 실행 | 주차별 rollout |
| Gateway 공식 체인 | **11개 (ETH/BOB/Base/BNB/AVAX/Unichain/Bera/OP/Soneium/Sei/Sonic)** | Arbitrum·Polygon 포함 (오류) |

**차단 규칙**: Python 파일·YAML 설정·pytest·주차별 rollout·USD-only PnL·Arbitrum/Polygon을 Gateway destination으로 지정 중 하나라도 프롬프트에 들어가면 그 프롬프트는 즉시 reject하고 이 플레이북 §0을 재지시.

---

## 1. 올릴 것 (3층 구조)

| 문서 | 위치 | 역할 |
|---|---|---|
| `AGENTS.md` | repo 루트 | **운영 규칙 (단일 진실).** Codex가 자동 로드. 모든 프롬프트가 여기를 단독 근거로 사용. |
| `docs/codex-playbook.md` | 본 문서 | **작업 규율.** 원자 프롬프트 골격·블로커별 템플릿·차단 패턴. |
| `docs/research/*.md` | 신규 디렉토리 | **사실 참조.** BOB 생태계·전략 수학·프로토콜 리스크·페이백 근거. **규칙 아님 — 인용만.** |

Claude(채팅)에 물어볼 때도 위 세 카테고리 중 관련된 것만 첨부. `.github/copilot-instructions.md`·`config/chains.yaml` 같은 건 지금 만들 이유 없음.

---

## 2. 매 프롬프트 골격 (이 블록을 그대로 복붙, `<>` 안만 채움)

```
[근거]
리포 루트 AGENTS.md의 "<섹션 이름>" 섹션만 단독 근거.
docs/codex-playbook.md §<N> 교차 참조.
사실·수치가 필요하면 docs/research/<파일>.md §<N>에서 인용 (규칙 아닌 참조).
본 프로젝트는 Node.js ES Modules(.mjs). Python/YAML 생성 금지.
이미 존재하는 `<파일경로>`가 있으면 신규 생성 말고 수정만.

[작업]
<정확한 파일경로>에 <구체 변경>.

[불변 규칙 재확인 — AGENTS.md 원문 근거]
- 키는 `BURNER_EVM_KEY_PATH` / `BURNER_BTC_KEY_PATH` env 경로로만 참조.
- cap 변경은 커밋 다이프로만. 런타임·대시보드·텔레그램 경로로 cap 상향 금지.
- LLM은 서명 결정 경로 밖. `src/executor/signer/`·`src/executor/policy/`·
  `src/executor/payback/` 하위에 LLM SDK import 금지.
- Phase gate 없음. 주차별 rollout·"3주차 live 승격" 금지.
- 감사 로그는 append-only. 회전·삭제·재작성 금지.
- PnL은 BTC(sats) 단위 우선. USD는 표시·로그용.
- Gateway destination은 11개 공식 체인만 (Arbitrum·Polygon 제외).

[Definition of Done]
- [ ] <관련 npm run report:*> 명령이 정상 JSON 반환
- [ ] 새 파일은 `.mjs`, 기존 import 패턴 준수
- [ ] `logs/signer-audit.jsonl` 스키마 깨지지 않음
- [ ] package.json에 선언된 테스트 명령(있으면)이 green
- [ ] (수치 다루면) BTC(sats) 필드가 먼저 있고 USD는 projection으로만 존재
- [ ] 변경 요약 2줄을 커밋 메시지 본문에 명시

[사전 검증 질문 — 구현 전에 답하라]
1. 이 변경이 AGENTS.md의 어느 규칙을 건드리는가? 없으면 "없음".
2. 수정 대상 파일이 이미 존재하는가? 존재 시 경로·대략 라인 범위 명시.
3. 이 저장소의 테스트 프레임워크 이름은? (package.json 확인 후 답, 추측 금지)
4. 본 작업이 이전 세션에서 폐기된 Python/greenfield 관행을 건드리는가?
5. (페이백 관련이면) 수치가 BTC(sats) 단위로 계산·저장되는가?

[의심되면 멈춤]
AGENTS.md나 본 플레이북이 이 질문에 정확히 답하지 않거나,
기존 코드와 지시가 모순되면 즉시 중단하고 "질문: <구체 1문장>"으로 답.
임의 판단·다른 프로젝트 관행 대입·주변 맥락 추정 금지.
```

---

## 3. Codex가 이 저장소에서 자주 미끄러지는 패턴

| 증상 | 즉시 차단 문구 (프롬프트에 삽입) |
|---|---|
| `.py` 생성 | "본 저장소는 `.mjs`만. Python 금지." |
| `config/*.yaml` 신규 생성 | "설정은 `src/config/*.mjs` 코드 모듈. YAML 금지." |
| `pytest`·`mypy`·`ruff` 언급 | "package.json scripts를 먼저 확인하고 그 명령만 사용." |
| `import OpenAI/Anthropic` 등 | "AGENTS.md LLM matrix: signer·policy·payback 경로에 LLM SDK 금지." |
| `liveTrading = true` 코드 강제 | "gate는 정책 통과 결과물. 상수로 덮지 말 것." |
| "1~N주차 일정" | "AGENTS.md Execution Safety: no tiered phase gate." |
| `unlimited approval` | "AGENTS.md Execution Safety: per-tx Permit2 또는 time-boxed만." |
| 수치 환각 (TVL·카운트) | "`npm run report:*` JSON 출력을 근거로만 써라. 값 없으면 `n/a`." |
| 감사 로그 rotate·정리 | "`logs/signer-audit.jsonl` append-only. 회전·수정·삭제 금지." |
| martingale·승리 후 사이즈 증액 | "AGENTS.md Execution Safety: auto-escalation 금지." |
| **Arbitrum·Polygon을 Gateway destination으로 등록** | "docs/research/bob-ecosystem.md §1.4: Gateway 공식 11에 없음. post-bridge만." |
| **USD 단위로만 PnL 계산** | "AGENTS.md Reporting: BTC(sats) 우선, USD는 projection." |
| **LLM이 페이백 비율·시점 결정** | "AGENTS.md Execution Safety: 페이백 결정 경로에 LLM 금지. config + rule만." |
| **페이백이 누적 BTC를 다시 운용 자본으로 투입** | "AGENTS.md Execution Safety: 누적 BTC는 운영 perimeter 바깥. 재주입은 committed diff로만." |

---

## 4. 현재 블로커별 원자 프롬프트 (README §2.3·§11 기준)

**원칙**: 한 프롬프트 = 한 파일 = 한 블로커. 수치는 Codex가 `npm run report:*`로 재확인.

### 4.1 canary 입력 4필드 stale 복구

```
[근거] AGENTS.md "Risk Limits" (Stale quotes rejected) + "Reporting" + README §2.3.
codex-playbook §2 골격, §3 차단 문구 준수.
Node.js .mjs 프로젝트. 신규 파일 생성 금지, 기존 refresh/ingest 경로 수정만.

[작업]
`dashboard/public/dashboard-status.json`에서 
`gatewayQuote` · `exactGas` · `srcGas` · `marketSnapshot` 네 필드가 
현재 `stale`로 찍히는 이유를 refresh 파이프라인에서 추적.
- 수정 대상 후보: `src/executor/ingestor/` 하위 refresh job,
  또는 `npm run` scripts 중 refresh 성격의 명령
- stale 판정 임계값을 먼저 식별 (어느 파일·어느 상수)
- 해당 refresh job이 실제로 네 필드를 갱신하는지 로그로 확인

[DoD]
- 재실행 시 네 필드가 `fresh`로 전환됐음을 JSON 스냅샷 두 개(전/후)로 증명
- stale 판정 임계값은 변경하지 않음 (데이터를 채우는 것이 목표, 게이트를 풀지 않음)
- `logs/signer-audit.jsonl` 무변경

[사전 검증 질문]
1. stale 임계값은 어느 파일·어느 상수에 선언?
2. 네 필드 각각을 채우는 refresh job/함수 이름은?
3. refresh 실패가 silent인가, 에러 로그가 남는가?

[의심되면 멈춤 — 위 골격 문구 그대로]
```

### 4.2 `odos_chain_not_supported` (canary: Bera)

```
[근거] AGENTS.md "Risk Limits" + "Reporting" + README §2.3.
docs/research/bob-ecosystem.md §1.4 (Gateway 11 체인 정확 목록) 참조.
codex-playbook §2·§3 준수. 기존 라우터 모듈 수정, 신규 라우터 SDK 도입 금지.

[작업]
canary 체인(현재 Bera)의 DEX quote가 `odos_chain_not_supported`로 blocked됨.
- 리포에 이미 존재하는 라우터/DEX 모듈을 먼저 조사 
  (`src/dex/`, `src/executor/helpers/`, `src/strategy/` 하위에서 import 검색)
- Odos 외 fallback (LI.FI·1inch·체인 네이티브 DEX 직결 중 이미 쓰는 것) 식별
- canary 라우팅 결정 경로에서 체인별 라우터 선택 로직 수정
- Odos 미지원 체인은 자동으로 fallback 시도하도록
- fallback도 없으면 `odos_chain_not_supported` 대신 
  `no_supported_router_for_chain:<chainId>` 명시적 실패 사유로 (silent skip 금지)

[DoD]
- Bera canary에 대해 quote가 fallback 라우터로 정상 반환되거나,
  fallback 부재 시 명시적 사유로 실패
- stale quote 거절 규칙 무위배
- `npm run report:strategy-catalog -- --json`에서 해당 lane 상태 변화 확인

[사전 검증 질문]
1. 이 저장소에 LI.FI/1inch/기타 fallback 라우터가 이미 구현돼 있는가? 파일 경로?
2. 라우터 선택은 어느 함수에서 결정되는가?
3. `odos_chain_not_supported` 문자열이 현재 어디서 생성되는가?

[의심되면 멈춤]
```

### 4.3 capital audit `incomplete_traceability` 축소

```
[근거] AGENTS.md "Unattended Execution Architecture" (Receipt Ingestor, Audit log) 
+ README §10. codex-playbook §2·§3 준수.

[작업]
`data/capital-audit.json`의 unmatched broadcast 104건 중 
helper_trace가 매칭 가능했는데 누락된 케이스 판별 로직을 
기존 `src/executor/ingestor/` 또는 `src/executor/capital/` 하위에서 찾아 보강.
매칭 키 후보: tx hash · strategy id · intent hash · timestamp window.

[DoD]
- 재실행 시 `unmatched broadcast count` 감소 (전/후 숫자 명시)
- 감사 로그 append-only 유지 (logs/signer-audit.jsonl 무수정)
- 매칭 규칙 변경을 코드 diff 한눈에 확인 가능
- 오매칭(false positive)이 생길 여지는 별도 주석으로 경고

[사전 검증 질문]
1. 현재 helper_trace 매칭 함수는 어디? (파일·함수명)
2. unmatched 104건 중 가장 흔한 3개 유형?
3. 매칭 키 중 가장 신뢰도 낮은 것은? 왜?

[의심되면 멈춤]
```

### 4.4 주간 회귀 매트릭스 (수치 환각 방지)

```
[근거] AGENTS.md "Operator Memory" + codex-playbook §0 표.
추측·환각 절대 금지. 값 없으면 "n/a".

[작업]
다음 4개 소스의 현재 값을 지표 매트릭스로 작성:
- npm run report:strategy-catalog -- --json
- npm run report:strategy-execution-surfaces -- --json
- npm run report:capital-audit -- --json
- dashboard/public/dashboard-status.json 현재 값

각 행 형식:
| 지표 | JSON 경로 ($.x.y) | 지난 스냅샷 값 | 현재 값 | 변화 |

[DoD]
- 표 하나만 출력 (서술·감상 금지)
- 각 행의 JSON 경로가 실제로 존재함을 명령 재실행으로 증명 가능
- 값이 없으면 값 칸에 정확히 `n/a`
- 추적 대상 지표 최소: overall severity, liveTrading, shadowTrading, 
  liveEligibleCount, shadow observations, DEX failures, 
  unmatched broadcast count, issue count, current combined USD,
  (payback 엔진 배치 후) lastPaybackSettledAt, accumulatorPendingSats
```

### 4.5 페이백 엔진 scaffolding (§4.1–4.3 해소 후 순서대로)

> **⚠️ 2026-04-17 실측 업데이트**: 다음 3개 파일은 **이미 존재한다**.
> - `src/config/payback.mjs` (39줄, `perPeriodMaxSats`/`annualMaxPaybackSats`/`cronExpression`만 TODO throw)
> - `src/executor/payback/accumulator.mjs` (482줄)
> - `src/executor/payback/scheduler.mjs` (1041줄)
>
> 아래 §4.5.1–4.5.3 프롬프트는 **"신규 생성"이 아니라 "기존 구현 검토·보강"으로 재해석**해서 사용. 파일을 덮어쓰거나 새로 만들지 말 것. 실제 필요한 남은 작업:
> - `src/config/payback.mjs`의 3개 TODO 필드 값 결정 (운영자)
> - accumulator/scheduler가 AGENTS.md "Payback Model" 의사공식·KPI·three-way receipt를 실제로 구현하는지 감사
> - `docs/research/payback-rationale.md` §1.3(Mayer Multiple 컷오프)·§1.4(volMultiplier 0.5 thresh)의 경험적 캘리브레이션

4.5.3 config → 4.5.1 accumulator → 4.5.2 scheduler 순으로.

#### 4.5.3 Payback config (먼저 — scheduler가 이걸 읽음)

```
[근거] AGENTS.md "Risk Limits" payback-specific caps 목록 + 
docs/research/payback-rationale.md §1 (기본값 근거).

[작업]
`src/config/payback.mjs` 신규 생성. 다음 필드만 export:

{
  baseRatio: 0.20,                           // Half-Kelly 근사 (docs/research/payback-rationale.md §1.1)
  minPaybackSats: 50_000,                    // ≈ 0.0005 BTC
  maxOfframpCostPctOfPayback: 0.10,
  perPeriodMaxSats: /* TODO: 호연님 결정 필요, 값 없으면 throw */,
  annualMaxPaybackSats: /* TODO: 동상 */,
  regimeMultipliers: { bear: 1.2, neutral: 1.0, bullPeak: 0.7 },
  volMultiplier: { cap: 1.0, thresholdAnnualized: 0.5 }, 
  emergencyPause: {
    offrampSlippageBpsMax: 200,              // 2%
    operatingDrawdownPctMax: 30,
    protocolExploitList: []                  // 운영자가 채움
  },
  cronExpression: /* TODO: 결정 필요 */,
  destinationPath: {
    profitReserveChain: "base",              // Base 우선 (README live proof)
    swapVenueOrdered: ["cowswap", "uniswap_v3"],
    composerRoute: "layerzero",
    gatewayOfframpStage: "BOB_L2",
    bitcoinDestAddressEnv: "PAYBACK_BTC_DEST_ADDR"   // env 이름만, 값 아님
  }
}

절대 하지 않는 것:
- 키·주소를 파일에 직접 기입
- Gateway 공식 11 체인 바깥을 destination으로 지정
- 하드코딩된 USD 임계값

[DoD]
- 모든 숫자 필드는 sats 또는 비율. USD 필드 없음
- TODO 필드는 `undefined` 반환이 아닌 명시적 throw 발생시키는 getter
- AGENTS.md Risk Limits의 payback-specific caps 목록과 1대1 대응
- 기존 src/config/*.mjs의 export 스타일과 일관성

[사전 검증 질문]
1. 기존 src/config/*.mjs의 export 패턴은 default export인가, named export인가?
2. env 변수 로딩 helper가 존재하는가? (있으면 그 helper로 `PAYBACK_BTC_DEST_ADDR` 읽기)
3. cron 표현식이 필요한가, 아니면 node 내부 interval 제어인가?

[의심되면 멈춤]
```

#### 4.5.1 BTC Accumulator (pure function)

```
[근거] AGENTS.md "Unattended Execution Architecture" Component 10 + "Payback Model" 
+ docs/research/payback-rationale.md §2 (KPI 정의).
pure function, I/O 없음, 감사 로그 수정 없음.

[작업]
`src/executor/payback/accumulator.mjs` 신규 생성.

요구 인터페이스 (의사 타입):
  snapshot(auditLogLines, receiptStore, config) -> {
    periodId,
    grossProfitSats_period,
    paidBackSats_lifetime,
    pendingDeferredSats,
    operatingFloatSats_byChain,
    kpi: {
      byr_rolling12m,              // docs/research/payback-rationale.md §2.1
      cg_rolling12m,               // §2.2
      tbr_rolling12m,              // §2.3
      roundTripEfficiency_period,  // §2.4
      daysToBreakeven,             // §2.5
    }
  }

입력은 append-only 감사 로그 + receipt store 스냅샷만.
출력은 dashboard JSON slice용으로 serialize 가능해야 함.

[DoD]
- 파일은 .mjs, default export는 pure function
- 입력 동일 시 출력 동일
- 감사 로그 mutation 없음
- USD 필드가 등장하면 "sats_*" 필드 먼저 존재하고 USD는 명시적 projection
- tests 디렉토리에 최소 한 개 "빈 로그 → 0 값" 회귀 테스트

[사전 검증 질문]
1. 감사 로그 스키마에서 "realized BTC profit" 필드 이름은?
2. receipt store의 실제 경로·포맷은?
3. BTC 가격 환산은 어느 oracle 설정 모듈을 참조해야 하는가?
4. 본 저장소의 테스트 프레임워크 이름은?

[의심되면 멈춤]
```

#### 4.5.2 Payback Scheduler

```
[근거] AGENTS.md "Unattended Execution Architecture" Component 9 + 
"Payback Model" (pseudocode) + "Risk Limits" (payback-specific caps).
docs/research/payback-rationale.md §1.

[작업]
`src/executor/payback/scheduler.mjs` 신규 생성.

책임:
- cron tick에 `accumulator.snapshot()` 호출
- `src/config/payback.mjs`에서 정책 로드
- AGENTS.md "Payback Model" 의사 공식 그대로 적용 → plannedPaybackSats
- emergency pause trigger 확인
- 통과 시 composite intent 발행:
    destination reserve → wrapped BTC swap → LayerZero Composer → BOB L2 
    → Gateway OfframpRegistry.createOrder() → Bitcoin L1 address
- intent는 기존 Policy Engine에 제출 (직접 서명 금지)
- 키 참조·raw tx 구성 금지

절대 하지 않는 것:
- LLM 호출
- 런타임 baseRatio 수정
- 누적 BTC를 다시 운용 float으로 투입

[DoD]
- cron 주기는 config에서 읽음
- plannedPaybackSats < minPaybackSats면 intent 미발행, carry
- estimatedOfframpCost > plannedPaybackSats × maxOfframpCostPctOfPayback이면 defer
- 모든 의사결정이 로그 가능 (시점·입력값·적용 multiplier·결과)
- 감사 로그 append-only 유지
- 신규 intent 포맷이 기존 policy engine 검증 통과 (unit test)

[사전 검증 질문]
1. 기존 policy engine의 intent 제출 인터페이스는 어떤 함수/경로인가?
2. Gateway OfframpRegistry.createOrder()를 이미 감싸는 helper가 존재하는가?
3. LayerZero Composer 호출 패턴은 어느 strategy에서 이미 쓰이고 있는가?
4. cron 구동 방식은 OS cron인가, node 프로세스 내부 scheduler인가?

[의심되면 멈춤]
```

---

## 5. "의심되면 멈춰라" 고정 문구 (모든 프롬프트 말미)

```
만약 본 플레이북 또는 AGENTS.md가 본 질문에 정확히 답하지 않거나,
기존 코드와 지시가 모순되면, 즉시 구현을 중단하고
"질문: <구체 질문 1문장>" 형식으로 답하라. 
절대 임의 판단·주변 맥락 추정·다른 프로젝트 관행 대입 금지.
```

---

## 6. 절대 하지 말 것

- ❌ Python/YAML로 재구현
- ❌ weekly phased rollout (주차 일정)
- ❌ 감사 로그 정리·회전·재작성
- ❌ 대시보드/텔레그램에서 cap·gate·payback 파라미터 변경
- ❌ `autoExecute` 값을 코드 블록 안에서 상수로 강제
- ❌ 모호어 ("보통", "대략", "적절히", "상황에 따라")
- ❌ `npm run report:*` 실행 없이 수치 단정
- ❌ USD 단위로만 PnL 계산 (BTC/sats 먼저)
- ❌ Arbitrum·Polygon을 Gateway destination 체인으로 등록
- ❌ LLM이 페이백 비율·시점을 runtime에 결정하도록 게이트 여는 코드
- ❌ 누적 BTC를 다시 운용 float으로 재주입 (committed diff 없이)

---

## 7. 이 플레이북 개정 기준

- AGENTS.md가 실질적으로 바뀌면 §0·§2 불변 규칙 블록 재확인
- §4 블로커는 README §11이 변할 때 갱신
- §4.5 페이백 작업은 §4.1–4.3 완료 후 순서대로 4.5.3 → 4.5.1 → 4.5.2 권장
- "v2·v3" 같은 버전 체계 안 씀. 문서는 현재 저장소와 함께 움직일 뿐.

**끝.**
