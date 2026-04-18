# 소액 실전 검증 계획 (V1–V4)

> **이 문서의 성격**: 실행 계획.
> **단독 근거**: `/AGENTS.md` (Execution Safety, Risk Limits, Payback Model).
> **선행조건**: `docs/codex-playbook.md` §4.1–§4.5a 모두 완료.
> **목적**: 소액(1,000–10,000 sats급)으로 시스템·전략·페이백 엔진이 실제로 동작함을 증명.
> **드라이런 의도적 생략**: 드라이런은 실제 슬리피지·MEV·LP 재고·Gateway 체결 시간을 반영 못함. 실거래 노이즈 자체가 캘리브레이션 입력.

---

## 0. 진행 규율

- 한 V = 한 PR.
- 각 V 완료 후 감사 로그·대시보드 스냅샷 두 개(전/후)를 커밋 메시지에 첨부.
- V1 완료 전 V2 금지. V2 완료 전 V3 금지. V3 완료 전 V4 금지.
- 실패 관찰 시 V 번호 내에서 수정 PR 생성 후 재실행. 다음 V로 넘어가지 말 것.
- 각 V 실행 전 `$KILL_SWITCH_PATH`가 운영자 손에 닿는 위치에 있는지 확인.

---

## 선행조건 체크 (Codex 아닌 운영자 확인)

```
[ ] Step 1 완료 — canaryInputs 4필드 fresh
[ ] Step 2 완료 — Bera fallback 라우터 또는 명시적 reject
[ ] Step 3 완료 — capital audit unmatched 감소
[ ] Step 4 기준선 매트릭스 스냅샷 존재
[ ] Step 5a 페이백 감사 "정합성 OK" 또는 결함 수정 완료
[ ] Step 5b perPeriodMaxSats / annualMaxPaybackSats / cronExpression 값 결정
[ ] $KILL_SWITCH_PATH 환경변수 설정 + 파일 경로 물리적으로 접근 가능
[ ] BURNER_EVM_KEY_PATH / BURNER_BTC_KEY_PATH OS keystore 실제 키 로드 성공
[ ] PAYBACK_BTC_DEST_ADDR 운영자 cold 지갑 주소 설정
[ ] Telegram bot 토큰·채팅 ID 로드 성공
[ ] 첫 실전용 BTC 5,000–10,000 sats Bitcoin L1 지갑에 준비
```

---

## V1. 인프라 드릴 (자본 불필요)

실제 돈 없이 정책·킬스위치·watchdog·alerter의 **실동작**을 확인. 각 단계 독립 PR 아닌 **단일 감사 세션**으로 일괄 실행 가능.

### V1 Codex 프롬프트

```
[근거] /AGENTS.md "Execution Safety" (Kill-switch, Watchdog, Alerter) + "Risk Limits".
      /docs/live-verification-plan.md §V1.
이 세션은 "실동작 증명" 전용. 코드 수정 없음. 드릴 실행 + 관찰 로그만.

[작업]
signer daemon 을 dev 모드로 기동한 상태에서 다음 5가지 드릴을 순서대로 실행하고
각 드릴의 입력·기대 결과·실제 결과를 한 줄씩 기록한다.

드릴 1. kill-switch 파일 drill
  입력:   touch "$KILL_SWITCH_PATH"
  기대:   daemon 이 다음 broadcast 시도 시 intent 즉시 reject,
         logs/signer-audit.jsonl 에 "kill_switch_engaged" entry append
  실제:   <관찰 기록>
  복구:   rm "$KILL_SWITCH_PATH" 후 daemon 정상 동작 재개 확인

드릴 2. watchdog heartbeat drill
  입력:   daemon 프로세스 SIGSTOP 으로 30초 일시정지
  기대:   watchdog 가 missed heartbeat 감지 → Telegram 알림 → auto-halt 플래그 세팅
  실제:   <관찰 기록>
  복구:   SIGCONT 후 정상 재개

드릴 3. stale quote reject drill
  입력:   canary input 의 gatewayQuote.observedAt 을 인위적으로 2시간 과거로 주입
         (테스트 픽스처 존재하면 그걸 사용, 없으면 이 드릴 스킵하고 "스킵 사유: 픽스처 없음" 기록)
  기대:   policy engine 이 stale_quote 사유로 intent reject
  실제:   <관찰 기록>

드릴 4. per-tx cap 초과 drill
  입력:   임의 전략의 per-tx cap 보다 큰 amount 의 intent 를 policy engine 에 직접 제출
         (policy 단위 테스트 경로 사용. signer 통과시키지 말 것)
  기대:   cap_exceeded 사유로 reject, audit log entry append
  실제:   <관찰 기록>

드릴 5. consecutive failure drill
  입력:   임의 전략으로 실패 가능성 높은 intent 3건 연속 제출
         (예: healthFactorMin 하회 예상 intent)
  기대:   3회째 실패 후 해당 전략 auto-pause, Telegram 알림
  실제:   <관찰 기록>
  복구:   config 에서 전략 resume 플래그로 재개

[DoD]
- 5개 드릴 전부 기대=실제 일치
- 각 드릴 전후 logs/signer-audit.jsonl 의 tail 10줄 첨부
- 불일치 발생 시 그 드릴은 해당 규칙의 실제 구현 결함 — V2 로 넘어가지 말고
  결함 수정 PR 먼저
- 자본 이동 0 sats, 실 broadcast 0건

[절대 하지 말 것]
- 실제 private key 로 real chain broadcast — 이 세션은 policy·watchdog 레이어까지만
- logs/signer-audit.jsonl 에서 drill entry 를 사후 삭제
- kill-switch 파일을 drill 외 목적으로 사용한 뒤 방치

[의심되면 멈춤]
각 드릴의 입력 픽스처·기대 시그널 위치가 코드에서 확실히 보이지 않으면
"질문: <구체 1문장>" 으로 멈춘다.
```

### V1 완료 조건

- 5개 드릴 기록 첨부
- 감사 로그에 드릴 entry 5개 이상 존재 (append-only 유지)
- Telegram 수신함에 해당 알림 실제 도착 스크린샷

---

## V2. 전략별 소액 canary 라이브

`autoExecute: true` 로 선언된 각 전략을 **최소 단위**로 실서명·실브로드캐스트. 각 전략 = **별도 PR**.

### V2a. BTC 인벤토리 선행 (자본 투입)

Codex 프롬프트 아닌 운영자 수작업:

```
[ ] Bitcoin L1 지갑 → BOB Gateway onramp 로 5,000 sats wBTC.OFT 를 Base 로 전송
    (기존 executor:gateway-btc-onramp 사용)
[ ] Base signer 0x96262bE63AA687563789225c2fE898c27a3b0AE4 잔고 확인:
    wBTC.OFT >= 5,000 sats
[ ] 전략별 필요 토큰 (cbBTC 또는 USDC) 으로 일부 스왑
    — 어느 전략을 먼저 돌릴지에 따라
[ ] 각 전략의 per-tx cap 이 투입 잔고보다 작은지 재확인
```

### V2b. wrapped-btc-loop (Base Moonwell) canary

```
[근거] /AGENTS.md "Execution Safety", "Risk Limits" + src/executor/strategies/wrapped-btc-loop-live.mjs.
      /docs/research/strategies-and-risk.md §4.2 (Moonwell cbBTC 파라미터).
      /docs/live-verification-plan.md §V2b.
전제: V1 통과. V2a Base signer 재고 확보.
자본: 이 PR 에서 움직이는 총 sats <= 5,000 sats.

[작업]
wrapped-btc-loop-base-moonwell 전략을 1 사이클 실집행한다.
  supply cbBTC -> borrow -> (no repeat, 1 loop only) -> repay -> withdraw
intent 1건 제출 -> policy 통과 -> signer 서명 -> Base broadcast -> receipt 수집.

실행 전 config 확인:
  per-tx cap <= 5,000 sats 로 일시 하향 (committed diff)
  healthFactorMin >= 1.5 (non-correlated 쌍 기준)
  liquidationBufferPct 선언 존재
  maxDailyLossUsd 선언 존재 (값은 기존대로 유지)

실행 중 관찰:
  1. intent hash 기록
  2. policy verdict 기록 (approved / rejected 사유)
  3. broadcast tx hash 수집
  4. 수령 receipt 의 realized gas, HF 경로, liquidation buffer 경로 기록
  5. ingest:wrapped-btc-loop-receipt 실행하여 audit log 반영

실패 시:
  자동 unwind 경로가 발동했는지 확인
  unwind 미발동이면 즉시 kill-switch touch 후 수동 unwind 수기 기록

[DoD]
- 1 사이클 end-to-end 성공 — supply, borrow, repay, withdraw 네 tx hash 모두 수집
- 또는 실패 시 unwind 발동 및 수기 복구 완료
- audit log three 개 이상 entry append
- 감사 로그 append-only 무위배
- per-tx cap 원복 PR 별도 (이 PR 과 분리)

[DoD 체크 후 보고]
- gross realized PnL (sats)
- realized gas cost (sats 환산)
- net realized PnL (sats)
- HF 경로 (entry / mid / exit 시점)
- 소요 시간 (intent 제출 -> 최종 receipt)

[절대 하지 말 것]
- per-tx cap 을 5,000 sats 넘게 설정한 상태에서 이 PR merge
- healthFactorMin 런타임 변경
- LLM 이 HF 판정에 개입
- audit log 수정

[의심되면 멈춤]
```

### V2c. 나머지 autoExecute 전략 canary

현재 `candidate_for_validation` 이상인 전략만 대상. **각 전략마다 V2b 구조 복제**:

```
[ ] 각 전략의 최소 canary PR 작성 시:
    - per-tx cap 5,000–10,000 sats
    - 1 사이클만
    - entry/exit receipt 수집
    - audit log 확인
    - 실패 시 unwind
```

해당 전략 목록은 `npm run report:strategy-catalog -- --json` 의 `autoExecute=true AND status=candidate_for_validation` 필터 결과로 확정.

### V2 완료 조건

- 대상 전략 전부 각 1사이클 end-to-end tx hash 수집
- `logs/signer-audit.jsonl` 에 전략별 broadcast entry 최소 1건
- 실패한 전략이 있으면 해당 전략은 `autoExecute=false` 로 되돌리고 V3 진입

---

## V3. 페이백 1사이클 실집행

페이백 scheduler 를 **단 한 번** cron 트리거해서 네이티브 BTC 가 운영자 지갑에 도착하는 전 경로를 관찰.

### V3 Codex 프롬프트

```
[근거] /AGENTS.md "Payback Model" + "Unattended Execution Architecture" Component 9·10.
      /docs/research/payback-rationale.md §2 (KPI).
      /docs/live-verification-plan.md §V3.
전제: V1, V2 통과. Base signer 에 실현 가능 수익 최소 1 period 분 축적 (V2 의 결과).

[작업]
페이백 scheduler 를 실환경에서 1회 트리거하여 end-to-end 를 증명한다.
이 PR merge 후에는 scheduler cron 을 원상복구한다 — 이 PR 은 일회성 수동 tick.

실행 전 config 보수화 (별도 커밋):
  baseRatio = 0.20 유지
  regimeMultipliers = {bear: 1.0, neutral: 1.0, bullPeak: 1.0}   // 일시 중립화
  volMultiplier.cap = 1.0                                         // 기본값 유지
  perPeriodMaxSats = 10_000                                       // 일시 축소
  annualMaxPaybackSats = 10_000                                   // 본 사이클 한정
  minPaybackSats = 1_000                                          // 소액 허용 위해 임시 하향
  emergencyPause 3 트리거 모두 활성 유지

실행:
1. accumulator.snapshot() 호출하여 현재 BTC 단위 realized profit 확인
   결과가 0 이면 V2 재실행 후 재개 — 가짜 데이터 주입 금지
2. scheduler 를 수동 tick 모드로 1회 호출
3. 의사결정 로그 수집:
     profit_sats_in_period, applied multipliers, plannedPayback_sats,
     estimatedOfframpCost_sats, minPaybackSats 비교, offramp cost 비율 비교
4. plannedPayback 이 carry/defer 면 PR 은 여기서 멈추고 그 사유만 보고
5. 실제 intent emit -> policy -> signer -> destination chain swap (cowswap 우선,
   실패시 uniswap_v3) -> LayerZero Composer -> BOB L2 -> OfframpRegistry.createOrder ->
   Bitcoin L1 송금
6. Three-way receipt 수집:
     (a) destination chain source tx hash
     (b) Gateway OfframpRegistry order id
     (c) Bitcoin L1 destination address balance delta txid
   세 개 중 하나라도 일정 시간 내 안 오면 pending 유지 — delivered 로 찍지 말 것

실행 후:
7. dashboard-status 의 payback slice 갱신 확인 (lastPaybackSettledAt, accumulatorPendingSats)
8. BYR/CG/TBR/roundTripEfficiency/daysToBreakeven 값 실제 숫자로 찍혔는지
9. audit log payback disbursement entry 가 AGENTS.md "Reporting" 필드 전부 포함하는지
10. config 원복 PR 작성 (regimeMultipliers 원래값 복귀는 실측 8주+ 이후 별도 PR)

[DoD]
- 세 receipt 모두 수집
- dashboard payback slice 갱신
- audit log payback entry 1건 append
- 경로 어디에서 몇 분 걸렸는지 타임라인 첨부
- 실패 지점 있으면 그 지점의 에러와 현재 state 기록, 복구 절차 명시

[보고서 필수 필드]
- period id
- harvest window start/end
- gross profit sats
- applied ratio / multipliers
- planned payback sats
- estimated round-trip cost sats
- realized round-trip cost sats
- Gateway order id
- Bitcoin txid
- settled balance delta sats

[절대 하지 말 것]
- profit 이 0 인데 payback 강제 emit (가짜 delivered 생성)
- receipt 한두 개만 수집되고 delivered 로 표기
- regimeMultipliers 를 이 PR 에서 "실측했으니 원래값 복귀" 로 커밋 — 별도 PR
- LLM 이 페이백 비율·시점 판정

[의심되면 멈춤]
```

### V3 완료 조건

- Three-way receipt 전부 수집
- `logs/signer-audit.jsonl` 에 `payback:<periodId>` entry 1건
- 운영자 Bitcoin L1 지갑 balance delta 확인 (블록익스플로러 스크린샷)
- round-trip 효율 숫자 (첫 데이터 포인트)

---

## V4. 레버리지 전략 자동 unwind 실동작

해당 없는 사용자는 스킵. `wrapped-btc-loop-*`·`recursive-lending-loop` 등 레버리지 전략이 `autoExecute: true` 인 경우에만.

### V4 Codex 프롬프트

```
[근거] /AGENTS.md "Execution Safety" (leverage) + "Risk Limits" (healthFactorMin).
      /docs/live-verification-plan.md §V4.
전제: V2 해당 전략 canary 통과.
자본: 이 PR 에서 움직이는 총 sats <= 10,000 sats.

[작업]
레버리지 전략을 HF 를 healthFactorMin 부근까지 의도적으로 밀어
자동 unwind 경로가 실제로 발동함을 증명한다.
테스트넷 선호, 메인넷이면 최소 단위.

실행:
1. 대상 전략 선택 (V2 에서 통과한 전략)
2. 소액 포지션 1건 open
3. 의도적으로 담보 일부 removal 또는 borrow 상향으로 HF 를 healthFactorMin + 0.05 로 유도
4. watchdog 가 HF breach 감지 -> 자동 unwind intent emit 관찰
5. unwind tx hash 수집, 최종 HF 확인, 잔여 포지션 확인

관찰 필수:
  pre-breach HF
  breach 감지 시점 (타임스탬프)
  unwind intent emit 시점
  unwind broadcast tx hash
  post-unwind HF (목표: 안전 구간 복귀)
  Telegram 알림 수신 여부

[DoD]
- 자동 unwind 경로 실 broadcast 성공
- 최종 HF 가 healthFactorMin 이상
- audit log unwind entry append
- 포지션 규모는 V2b 대비 동등 이하

[실패 케이스]
- unwind 가 emit 안 됨 -> 즉시 kill-switch, 수동 unwind, 코드 결함 PR 로 분리
- unwind 실패 후 HF 계속 하락 -> liquidation 위험 -> 수동 liquidation defense
- 두 경우 모두 이 PR 은 "실패 보고" 로 닫고 V3 로 돌아가지 말 것

[의심되면 멈춤]
```

### V4 완료 조건

- unwind tx hash 수집
- HF 복귀 확인
- 실패 시 코드 결함으로 격상하여 별도 수정 PR

---

## V 완료 후 — 라이브 스케일업 규율

V1–V4 전부 성공 후에도 **sizing 은 계단식만**.

```
Day 0:    per-tx cap 5,000–10,000 sats   (V2 canary 사이즈)
+ 72h 무사고 -> per-tx cap 50,000 sats
+ 7d 무사고 -> per-tx cap 200,000 sats
+ 14d 무사고 -> per-tx cap 1,000,000 sats
+ 28d 무사고 + regimeMultipliers 실측 캘리브레이션 -> 운영자 판단
```

각 계단은 **커밋 다이프로만** 상향. 런타임·대시보드·텔레그램에서 올리는 건 AGENTS.md "Risk Limits" 위반.

## 롤백 규율

- 어떤 V 든 DoD 미달 → 해당 V 이전 마지막 green state 로 회귀 (git revert)
- 라이브 자본이 얽힌 실패 → 킬스위치 즉시 touch → 수동 정리 → post-mortem (`docs/research/post-mortem-*.md` 신규 파일)
- 페이백 관련 실패 → scheduler cronExpression 을 임시로 비활성 문자열로 교체, 별도 PR 로 원복

## 문서 이력

- 2026-04-17: 초안. Step 1–5 완료 후의 실전 검증 계획. 드라이런 4주 우회.
