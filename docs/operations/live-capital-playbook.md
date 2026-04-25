# Live Capital Playbook (실전 운용 완전본)

작성: 2026-04-25. 본 문서는 `AGENTS.md`의 **하위 문서**다. 충돌 시 항상 `AGENTS.md`가 우선이다. 본 문서는 `AGENTS.md`가 정한 원칙 위에서 **운영 절차**를 명시한다.

---

## 0. 문서의 위치

- **상위**: `AGENTS.md` (규칙·게이트·LLM 권한 매트릭스)
- **본 문서**: 운영 SOP·자본 배치 의사결정·자동 회전 흐름·KPI 임계치
- **하위 운영 자료**:
  - `docs/merkl-protocol-bindings.md` (Merkl 바인딩 등록)
  - `docs/research/payback-rationale.md` (payback ratio 근거)
  - `docs/dashboard-context.md` (대시보드 표시 정책)

본 문서는 사람이 읽고 의사결정하는 보조 자료다. **런타임 결정은 본 문서가 아니라 코드(policy/config)가 한다.**

---

## 1. 시스템 전제

- 단일 운영자(operator) 모드. 외부 입금자 ERC4626 vault 미지원.
- BTC-우선 회계. USD는 표시용.
- 11 Gateway 공식 체인만 1차 자동 회전 대상: Ethereum, BOB L2, Base, BNB, Avalanche, Unichain, Berachain, Optimism, Soneium, Sei, Sonic. Arbitrum/Polygon은 manual bridge only.
- 모든 키는 OS keystore (`BURNER_EVM_KEY_PATH`, `BURNER_BTC_KEY_PATH`). LLM은 키 절대 접근 불가.
- 모든 cap·payback 비율·임계치 변경은 **commit-only**. 런타임 변경 불가.

---

## 2. 자본 배치 모델

### 2.1 자본 계층

| 계층 | 위치 | 역할 |
|---|---|---|
| Reserve | Bitcoin L1 (operator 주소) | payback 누적·운영 외 자본. 자동 회전 대상 아님 |
| Operating | 11 체인 burner 지갑 | 실제 회전 자본. 모든 전략은 여기서만 자본을 끌어옴 |
| Gas Float | 각 체인 native | 가스 전용. 부족 시 Gas.Zip refuel 자동 |
| Pending | dashboard 알림 큐 | unknown token, manual review 필요분 |

**Reserve → Operating 이동은 사람이 한다(committed diff 또는 명시적 입금).** payback이 Reserve에 쌓아도 자동으로 Operating으로 환류하지 않는다. (`AGENTS.md` Risk Limits §35).

### 2.2 체인별 배치 비율 (목표 배분, 절대값 아님)

운영 자본 100%를 다음 비율로 분포 목표:

| 체인 | 목표 비중 | 주된 용도 | 비고 |
|---|---|---|---|
| Base | 35% | Merkl portfolio·moonwell loop·offramp 허브 | 가장 깊은 유동성 |
| Ethereum | 20% | Aave Horizon·Morpho 대형 vault | 가스 비용 큼, 큰 단건만 |
| BOB L2 | 10% | payback 환승, wrapper 차익 | 회전용 |
| BNB | 10% | Pendle solvBTC-BBN | 캠페인 의존 |
| Avalanche | 5% | GMX V2 perp basis | 변동성 |
| Unichain / Berachain / Soneium / Sonic / Optimism / Sei | 합 20% | 신규 Merkl 캠페인 캐치, 분산 | 캠페인 발생 시 동적 증가 |

**자동 rebalance 트리거:** 어느 체인이 목표±5%p 이탈하면 [src/treasury/refill-job.mjs](../../src/treasury/refill-job.mjs) intent 자동 큐잉. 실제 이동은 policy gate 통과 후 signer가 한다.

### 2.3 자본 효율 원칙

- **유휴 금지.** 24h 이상 무이용 자본은 자동 라우팅 후보. classifier가 카테고리 결정 → routing engine이 전략 선택.
- **공격적 cap.** Merkl/Gateway 운영 cap은 상향하되 wrapped-BTC lending-loop는 `operator_hold`가 풀릴 때까지 제외한다. 단일 손실 한도 증가는 [src/config/auto-kill.mjs](../../src/config/auto-kill.mjs) 자동 kill-switch 트리거가 선행되어야 한다.
- **순이익 음수면 거부.** 가스+슬리피지+round-trip 비용을 뺀 뒤에도 양수일 때만 진입. policy `min-net-profit` 게이트가 강제.

---

## 3. 입금 자산 자동 인식 흐름

```
입금 감지(inventory-watcher) 
   → 자산 분류(asset-classifier) 
   → 라우팅 결정(inbound-routing) 
   → refill-job intent 
   → policy gate 
   → signer
```

### 3.1 분류 카테고리

| 카테고리 | 예시 | 자동 라우팅 |
|---|---|---|
| BTC-like | wBTC, cbBTC, lBTC, solvBTC, BTC | Bitcoin이면 Gateway onramp, EVM이면 Base hub funding 또는 Merkl portfolio 후보 |
| ETH-like | ETH, wETH, stETH | ETH-yield 전략 (현재 design_scaffold; 자동 라우팅은 candidate queue까지만, 자동 진입은 lane 활성화 후) |
| stable | USDC, USDT, DAI, RLUSD | Aave/Morpho/Moonwell loop |
| governance | OP, ARB 등 | 자동 라우팅 금지. payback 큐 |
| unknown | 화이트리스트 외 | **자동 진입 금지**. dashboard alert + `data/treasury/pending-whitelist.jsonl` 기록 |

### 3.2 신규 토큰 화이트리스트

자동 등록 **금지**. 사용자가 [src/assets/tokens.mjs](../../src/assets/tokens.mjs) 또는 [src/config/protocol-addresses.mjs](../../src/config/protocol-addresses.mjs)에 commit으로만 추가. 시스템은 알림만 한다. (`AGENTS.md` LLM permissions matrix 준수)

---

## 4. Merkl 자동 회전 의사결정 트리

```
opportunity-watch (5분 주기)
   ├─ Merkl API fetch
   ├─ normalizer → 표준 schema
   └─ canary-queue priorityScore 계산

priorityScore ≥ threshold AND
protocol ∈ binding-registry AND
asset ∈ whitelist AND
inventory ready AND
체인 cap 여유 있음
   → queue item autoEntry.autoExecute=true
   → merkl-canary-autopilot 진입

기존 포지션 평가 (orchestrator 5분 주기)
   ├─ 캠페인 만료? → exit
   ├─ 실현 APR < 진입APR × 0.5? → exit
   ├─ reward token 50% drop? → exit
   ├─ 24h volume drop > 70%? → exit
   └─ portfolio score 저하? → exit

exit 후 회수 자본 → Phase 2 라우팅 엔진 재진입
```

임계치는 모두 commit-only:
- `src/config/merkl-auto-entry.mjs` (priorityScore threshold, min TVL, min APR)
- `src/config/merkl-exit-rules.mjs` (APR drop, volume drop, score 저하 기준)

---

## 5. cap 변경 절차

1. 변경 사유 문서화: PR description에 (a) 현재 cap, (b) 새 cap, (c) 근거(audit log·KPI·캠페인 데이터)
2. [src/config/strategy-caps.mjs](../../src/config/strategy-caps.mjs) 수정
3. `npm run test -- strategy-caps-validation` 통과
4. cap 상향 시 `maxDailyLossUsd` 비례 점검
5. cap 상향과 함께 자동 kill-switch 트리거 임계치 재계산 ([src/risk/auto-kill-triggers.mjs](../../src/risk/auto-kill-triggers.mjs))
6. commit + push. push 후 daemon 재기동 또는 hot-reload 확인

런타임 변경은 **불가**. dashboard·Telegram·LLM 어떤 경로로도 cap 못 올린다.

---

## 6. Kill-switch / Watchdog / Payback SOP

### 6.1 Kill-switch 자동 트리거 (Phase 4a)

| 트리거 | 임계치(초기) | 해제 조건 |
|---|---|---|
| 24h 누적 손실 | 운영 자본의 5% 또는 USD 1000 중 작은 값 | 사람 + commit으로 임계치 재확인 후 파일 삭제 |
| 5분 내 consecutive failure | 동일 strategy 5회 또는 전체 8회 | 실패 원인 분석 후 사람이 파일 삭제 |
| oracle 가격 다중 소스간 괴리 | 5% 이상 | 오라클 정상화 확인 후 사람이 파일 삭제 |
| watchdog heartbeat 끊김 | 60초 (기존) | daemon 재기동 후 사람이 파일 삭제 |

자동 set은 audit log에 기록. **자동 해제는 절대 없다.** 사람이 명시적으로 `rm $KILL_SWITCH_PATH`.

### 6.2 Payback (`AGENTS.md` Payback Model)

- 기본 cron: 주 1회 월요일 00:00 UTC
- ratio·시점·트리거 모두 [src/config/payback.mjs](../../src/config/payback.mjs)에서만 결정
- 변경 시 `docs/research/payback-rationale.md`에 근거 추가하고 PR에 인용
- payback 누적 BTC는 **운영 자본 외부**. 절대 reinvest 금지

### 6.3 일일 점검 루틴 (사람)

- dashboard JSON freshness 확인 (5분 이내 갱신)
- `logs/signer-audit.jsonl` 마지막 1000줄에서 `rejected`/`errored` 비율 ≤ 10%
- 자동 kill-switch 트리거 발생 여부
- payback KPI 슬라이스(`BYR`, `CG`, `TBR`) 목표 밴드 안에 있는지

---

## 7. KPI 목표 밴드 (BTC 단위)

| KPI | 목표 | 경고 | 비상 |
|---|---|---|---|
| BYR (12m) | 5–15% | <3% 또는 >20% | <0% |
| CG (12m) | 10–25% | <5% 또는 >35% | <-5% |
| TBR (12m) | 15–40% | <8% | <0% |
| Round-trip efficiency | >90% | 80–90% | <80% |
| Days to breakeven | <60d | 60–90d | >90d |

비상 진입 시 자동 kill-switch + Telegram alert + 사람 개입 필요.

---

## 8. "이 시스템은 사람에게 무엇을 요구하지 않는가"

자동:
- 가스 부족 감지 + Gas.Zip refuel
- 새 Merkl 캠페인 발견 + (조건 만족 시) 자동 진입
- 입금 자산 분류 + 라우팅 (화이트리스트 한정)
- 포지션 underperform → 자동 exit
- 손실 누적 → kill-switch 자동 set
- 체인별 잔고 ±5%p 이탈 → 자동 rebalance intent

여전히 사람만:
- cap·payback 비율·임계치 변경 (commit-only)
- 신규 토큰 화이트리스트 추가
- kill-switch 해제
- 신규 프로토콜 binding 등록
- payback 누적 BTC의 운영자본 환류 결정

---

## 9. 첫주·첫달 운영 KPI

### 첫주 (D1~D7)
- [ ] kill-switch 자동 트리거 0회 (또는 트리거 시 정상 작동)
- [ ] dashboard freshness 99% 이상 (5분 이내 갱신 비율)
- [ ] audit log rejected 비율 < 15%
- [ ] Merkl 자동 진입 ≥ 3건, 자동 철수 ≥ 1건
- [ ] 입금 자동 인식 false positive 0회

### 첫달 (D1~D30)
- [ ] BYR ≥ 1% (월 환산)
- [ ] payback 1회 이상 settlement proof 완료 (Bitcoin L1 balance delta)
- [ ] cap utilization 평균 ≥ 30% (자본 효율)
- [ ] consecutive failure 자동 pause 0회
- [ ] 신규 프로토콜 binding 추가 0~2건 (자연 확장)

이 KPI 미달성 시 **다음 phase 작업 중지하고 root cause 분석**.

---

## 10. 비상 절차

### 10.1 kill-switch 발동 (자동 또는 수동)

1. Telegram alert 확인
2. `logs/signer-audit.jsonl` 마지막 100줄 + `data/kill-switch-events.jsonl` 확인
3. 원인 분류: oracle 이상 / 손실 임계 / failure burst / watchdog
4. 원인별 대응:
   - oracle: 다중 소스 정상화 확인 후 해제
   - 손실: 회계 검증, cap 재산정 commit, 임계치 재확인
   - failure burst: 해당 strategy `autoExecute:false`로 전환 commit, kill-switch 해제
   - watchdog: daemon 프로세스 상태 확인, OS 레벨 진단
5. `rm $KILL_SWITCH_PATH` 후 daemon 재시작
6. 첫 1시간은 cap 유틸 모니터링 강화

### 10.2 단일 protocol exploit 보고

1. 즉시 `touch $KILL_SWITCH_PATH`
2. 해당 protocol binding의 `enabled: false` commit
3. 보유 포지션 emergency unwind 평가 (HF check 우선)
4. payback `emergencyPause` 트리거 (`AGENTS.md` §54)
5. 사후 audit log 추출 + 보고서

---

## 11. 문서 갱신 책임

- 본 playbook은 분기 1회 또는 phase 완료 시 갱신
- AGENTS.md 변경 시 본 문서도 즉시 cross-check
- 수치·임계치는 본 문서가 아니라 config 파일이 진실. 본 문서의 수치는 그 시점 스냅샷일 뿐.
- 수치 차이 발견 시 config가 우선. 본 문서를 수정해 맞춘다.

---

## 부록 A — 관련 파일 빠른 참조

| 분류 | 경로 |
|---|---|
| caps | [src/config/strategy-caps.mjs](../../src/config/strategy-caps.mjs) |
| 적응형 자본 | [src/config/capital-adaptive.mjs](../../src/config/capital-adaptive.mjs) |
| 체인 설정 | [src/config/chains.mjs](../../src/config/chains.mjs) |
| payback | [src/config/payback.mjs](../../src/config/payback.mjs) |
| 입금 감지 | [src/treasury/inventory-watcher.mjs](../../src/treasury/inventory-watcher.mjs) |
| 입금 분류 | [src/treasury/asset-classifier.mjs](../../src/treasury/asset-classifier.mjs) |
| 입금 라우팅 | [src/treasury/inbound-routing.mjs](../../src/treasury/inbound-routing.mjs) |
| Merkl 자동 진입 | [src/config/merkl-auto-entry.mjs](../../src/config/merkl-auto-entry.mjs) |
| Merkl 자동 철수 | [src/config/merkl-exit-rules.mjs](../../src/config/merkl-exit-rules.mjs) |
| Merkl 진입 | `src/config/merkl-auto-entry.mjs` (Phase 3 신규) |
| Merkl 철수 | `src/config/merkl-exit-rules.mjs` (Phase 3 신규) |
| auto kill | `src/risk/auto-kill-triggers.mjs` (Phase 4a 신규) |
| inventory | `src/treasury/inventory-watcher.mjs` (Phase 2 신규) |
| classifier | `src/treasury/asset-classifier.mjs` (Phase 2 신규) |
| routing | `src/treasury/inbound-routing.mjs` (Phase 2 신규) |
| signer audit | `logs/signer-audit.jsonl` (append-only) |
| dashboard | [dashboard/public/dashboard-status.json](../../dashboard/public/dashboard-status.json) |

---

## 부록 B — 자동화 경계 요약 (LLM이 무엇을 절대 못 하는가)

(`AGENTS.md` LLM permissions matrix 재인용)

| 가능 | 불가능 |
|---|---|
| strategy 코드 작성 | 키 노출/로깅 |
| policy 함수 작성 | policy 우회 signer 호출 |
| payback 코드 작성 | runtime payback 비율·시점·트리거 결정 |
| commit으로 cap 변경 제안 | runtime cap 상향 (어떤 채널이든) |
| audit log 읽기 | audit log 삭제·회전·재작성 |
| 신규 chain config 작성 | Capital Manager 외부에서 자금 이동 |
| 수동 dev 실행 | 서명 시점 결정 (그건 policy 코드의 일) |

본 문서가 LLM에게 "공격적으로 운영하라"고 적었다 해도 위 매트릭스가 우선한다.
