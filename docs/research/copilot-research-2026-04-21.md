# Copilot CLI Research Synthesis — 2026-04-21

저자: Copilot CLI (Claude Opus 4.7 backend)
범위: GLM, Kimi, 기존 baseline 4개 리서치 비교 + 직접 코드/시스템 분석을 통한 통합 결론
목적: BobClaw 시스템의 다음 단계(자본적응형 자동 배치 + 11체인 분산 + 자동 리스크 관리) 의사결정 근거 자료
대응 산출물: 본 세션 plan.md (`/Users/love/.copilot/session-state/96503db2-adbd-4b79-af34-3ea2aabf18f6/plan.md`)

본 문서는 **사실 라이브러리**다. 구현 단계/일정/책임은 plan.md를 참조한다.

---

## 1. 현재 시스템 객관 상태 (코드/문서 직접 확인)

| 축 | 값 | 출처 |
|---|---|---|
| 단계 | L2 (인프라 완료, alpha 미확인) | docs/current-status.md |
| 활성 전략 라인 수 | 13 (strategy-caps.mjs 기준) | src/config/strategy-caps.mjs |
| autoExecute=true 전략 수 | 9 | 동 |
| autoExecute=true 중 lending loop | 2 (`recursive_*`는 false, `wrapped-btc-loop-base-moonwell`는 true) | 동 |
| 정책 모듈 수 | 5 (cap, hf, kill-switch, stale-quote, approval-hygiene, consecutive-failures) | src/executor/policy/ |
| capital manager 모듈 | 3 (gas-float-keeper, rebalancer, target-balances) | src/executor/capital/ |
| watchdog 모듈 | 3 (heartbeat, runner, watchdog-loop) | src/executor/watchdog/ |
| payback 엔진 | scheduler + accumulator + dashboard 슬라이스 (작동 중, carry 상태) | src/executor/payback/ |
| treasury planner | inventory + planner + funding-source-planner + refill-job + whole-wallet | src/treasury/ |
| 총 CLI 수 | 167 | package.json |
| 총 테스트 수 | 150+ | test/ 디렉터리 카운트 |
| Gateway end-to-end live 증명 | Base→BOB→BTC L1 + Base/Avax/Sonic offramp | docs/current-status.md, 운영자 메모리 |
| 페이백 carry pending | 297 sats / minPayback 50,000 sats (0.12%) | dashboard-status.json |
| 익스플로잇 대응 패치 | LayerZero OFT(Kelp), Drift, Aperture, Moonwell oracle 모두 미반영 | 코드 검색 결과 |

**결론**: "거의 다 구축됨"은 사실. 빈 곳은 (a) 양수 alpha를 내는 전략 어댑터 추가, (b) 잔고적응형 cap 자동화, (c) 자동 리스크 데몬, (d) 모바일 대시보드 다듬기 — 4개로 좁혀진다.

---

## 2. 4-AI 리서치 비교 매트릭스

| 항목 | 기존 baseline (4 docs, 2026-04-17) | Kimi (2026-04-21) | GLM (2026-04-21) | Copilot CLI 자체 분석 |
|---|---|---|---|---|
| **포커스** | 사실/수치 라이브러리 (BOB 생태계, 비용, 페이백 수학, 리스크 매트릭스) | 시스템 진단 + 자동화 갭 식별 | 11체인 yield landscape + 7전략 심층 + 포트폴리오 시나리오 | 비교·종합 + 코드/구조 검증 |
| **단위** | sats + USD 표시 | sats | USD/% APY | sats 우선 (불변 원칙 2 준수 확인) |
| **구체 수치** | Gateway round-trip 0.2-1.6%, Babylon GRR 1-2%, Moonwell CF 0.81 | payback config (cap 50_000/26_000_000, venue cowswap+univ3) | Pendle PT 5.1-7.2%, Aero CL+AERO 5-185%, K3 BOB ROE 36.99% | (수치는 두 소스 cross-check 필요, 본 문서는 합의구간만 인용) |
| **전략 권장 우선순위** | (직접 권장 안 함) | wrapped BTC lending loop 우선 | ① Moonwell+Pendle PT, ② Pendle BSC direct, ③ Aero CL, ④ GMX basis, ⑤ Bera LST | GLM 채택 + 기존 lending loop 라이브 증명 우선 |
| **자동화 갭** | 미다룸 | 5개 (supportedSwapVenue·payback cap 수정완 / revalidation cron, lending live receipts, liveTrading 자동해제 미해결) | Phase 1-4 로드맵 | Kimi 잔여 3개 + GLM Phase 2-3 + 분산/리스크 데몬 + 잔고정합성 + 부트스트랩 |
| **2026-04 익스플로잇** | 일반 매트릭스 | 미다룸 | Kelp $292M, Drift $285M, Aperture $3.7M, Moonwell oracle $1.78M | LayerZero OFT 패턴 emergency-pause trigger 코드화 권장 |
| **자본 가정** | 미명시 | 미명시 | $300/$500/$1000 | 잔고 감지 후 동적 cap 함수 (사용자 결정) |
| **리스크 관리** | 일반 룰 (HF, buffer) | 미다룸 | 전략별 청산 조건 | 7개 데몬 (protocol-health, layerzero-oft-watcher, liquidity-watch, peg-monitor, concentration-guard, funding-rate-gate, circuit-breaker) |
| **대시보드** | dashboard-context.md 룰만 | 미다룸 | 미다룸 | 마인드맵 모바일 재배치 + Gateway 경유 swap만 + 프로토콜 로고 |
| **약점** | 권장 없음 (의도) | 전략 alpha는 다루지 않음 | 자본적응 미설계, 리스크 자동관리 미설계, 코드 구조 미반영 | (본 문서가 위 셋의 갭을 메움) |

---

## 3. 합의 결론 (3-of-4 이상)

1. **순수 BTC 단순 랜딩 = 0%로 수렴**. Gateway round-trip 0.2-1.6% 비용을 못 넘는다. (GLM + 기존 + 측정 데이터 8개 라인)
2. **양수 수익 경로는 cross-asset only**: BTC담보→USDC차입→PT 또는 BTC LST→Pendle PT 또는 CL+인센티브. (GLM + 기존)
3. **자동화는 "config-by-commit, runtime-deterministic"**. LLM 결정 경로 진입 금지. (불변 원칙 + Kimi)
4. **최소 페이백 임계(50,000 sats) 도달까지 carry는 정상**. 즉시 수익 없는 게 결함이 아님. (Kimi + 페이백 수학)
5. **분산은 단일 프로토콜 의존을 막는 핵심 안전망**. (기존 + 2026-04 익스플로잇 4건 데이터)

## 4. 충돌 결론과 본 문서의 결정

| 충돌 | 본 문서 결정 |
|---|---|
| GLM "Phase 2 = 1-2주" vs 시스템 "phase gate 없음" | **phase 표현 폐기**. 각 전략은 cap commit + autoExecute=true + receipt 누적으로 단계 없이 라이브화 |
| GLM "$1,000+ 자본 권장" vs 사용자 "잔고 미정" | **잔고 적응형 cap 함수** 도입. cap 비율 = 코드, 잔고 = 런타임 입력 |
| Kimi "lending loop 우선" vs GLM "BTC 단일 lending = -5.1%" | 둘 다 옳다. Kimi의 'lending loop'는 cross-asset(BTC↔USDC) 루프. **BTC 단일 루프 영구 제외** |
| 기존 "BOB L2 직보유 ≤10%" vs GLM "K3 36.99% ROE 매력적" | 비율 제한 유지 + K3는 BOB L2 비중 안에서만 |

---

## 5. 추가/활성화 대상 전략 카탈로그

선정 기준: (1) 라운드트립 비용 차감 후 양수, (2) Gateway 11체인 안에서 자동화 가능, (3) 측정 가능한 unwind, (4) 리스크 모니터링 가능.

| # | 전략 | 체인 | 기대 net APY | 의존 어댑터 | 리스크 자동관리 |
|---|---|---|---|---|---|
| S1 | BTC 담보 → USDC 차입 → Pendle PT-LBTC | Base | 3-5% | Moonwell(기존) + USDC↔Pendle 신규 | HF<1.6 → 부분 unwind, oracle deviation>3% → 전체 unwind |
| S2 | Pendle PT 직진입 (SolvBTC.BBN) | BSC | 5-7% 고정 | Gateway Custom Action + Pendle BSC | 만기 14일 전 자동 롤 |
| S3 | Aerodrome CL cbBTC/LBTC (correlated) | Base | 1.5% + 인센티브 | Aero position manager 신규 | range 이탈 1h → 재집중 |
| S4 | Aerodrome CL cbBTC/USDC + AERO | Base | 10-30% | S3와 공유 + IL watcher | IL>5% OR AERO 30d -50% → unwind |
| S5 | Berachain BTC LST + BGT | Bera | 5-12% | Bend/BEX 신규 | LST depeg>0.5% → unwind |
| S6 | GMX V2 perp basis (1x short + WBTC 담보) | Avax | 5-15% (펀딩 양수일 때만) | GMX 신규 + funding-rate-gate | 펀딩 30d EWMA<2% → 청산 |
| S7 | Beefy folding vault | Base/BNB | 2-8% | Beefy 신규 | 단일 vault TVL 30d -40% → 회수 |
| S8 | Babylon LST baseline | (off-chain) | 1-2% | 외부 계정 (사용자 옵트인) | (자동화 외) |
| S9 | K3 Capital WBTC/LBTC loop (Euler V2) | BOB L2 | 잠재 ROE 36.99% | K3 신규 | BOB L2 직보유 ≤10% 룰 |

---

## 6. 분산 룰 (코드, `src/config/diversification.mjs` 신설)

- per-strategy max share: 25% of operating BTC
- per-chain max share: 35% of operating BTC
- per-protocol max share (Moonwell, Pendle, Aerodrome 등 합산 단위): 30%
- HHI(허핀달) 임계: 0.30 초과 시 신규 진입 차단
- BOB L2 직보유: ≤10% (BitVM 메인넷 안정 전, 기존 룰 유지)

---

## 7. 자동 리스크 데몬 (코드, `src/executor/risk/` 신설)

| 모듈 | 역할 | 데이터 소스 | 트리거 액션 |
|---|---|---|---|
| protocol-health | 프로토콜별 TVL/oracle/admin key 모니터 | DefiLlama, Chainlink, on-chain | TVL 24h -30% OR oracle deviation>3% → 해당 프로토콜 전 unwind |
| layerzero-oft-watcher | LZ OFT 어댑터 비정상 mint/burn 감지 | LZ explorer, on-chain | Kelp-패턴 → BOB Gateway 정지, payback 일시중지 |
| liquidity-watch | DEX/렌딩 풀 utilization, withdrawal queue | Subgraph polling | utilization>95% 1h → 신규 진입 정지 + 회수 큐 |
| peg-monitor | LST/wrapped BTC depeg | DEX mid price | depeg>0.5% 30분 → 해당 자산 unwind |
| concentration-guard | §6 분산 룰 강제 | 자체 ledger | 룰 위반 intent → policy reject |
| funding-rate-gate | S6 진입/청산 결정 | GMX/Synthetix on-chain | 30d EWMA로 자동 진입/청산 |
| circuit-breaker | 위 모든 모듈 fan-in. emergency-pause file 트리거 | — | KILL_SWITCH_PATH 생성 + Telegram |

---

## 8. 자본적응형 cap (코드, `src/config/capital-adaptive.mjs` 신설)

```
export function deriveCaps(operatingBtcSats, btcUsd) {
  return {
    perTxBtcSats:        floor(operatingBtcSats * 0.05),
    perDayBtcSats:       floor(operatingBtcSats * 0.20),
    maxDailyLossBtcSats: floor(operatingBtcSats * 0.03),
    perStrategySats: { S1: floor(operatingBtcSats*0.25), ... },  // §6 분산룰 적용
    minOperatingFloorSats: 50_000,
  };
}
```

- 비율 = commit (불변 원칙 5 준수)
- 잔고 = balance reconciliation 모듈이 매 tick polling하여 입력
- USD cap (기존 strategy-caps.mjs)은 호환 유지 — capital-adaptive cap이 더 빡빡할 때만 발효

---

## 9. 끊김 방지 (코드, `src/executor/balance/` + `src/executor/bootstrap/` 신설)

### 9.1 잔고 정합성
- 11체인 EVM RPC + BTC L1 polling
- `logs/balance-snapshots.jsonl` append-only
- 직전 스냅샷 대비 unexpected delta(서명 데몬이 만들지 않은 변화) → emergency-pause + Telegram
- 사용자 BTC 입금 자동 감지 → 다음 tick에 capital-adaptive cap 자동 반영
- RPC 일시 실패 → 직전 스냅샷 fallback, 5 tick 연속 실패 시 신규 진입만 정지

### 9.2 자동 가스/경로 부트스트랩
- 가스 부족 → unwrap → 다른 체인 cross-chain (Gateway/LZ/Odos 최저비용) → Treasury 인출
- 경로 없음 → multi-hop planner (예: BTC→Base cbBTC→USDC→LZ→BSC USDC→Pendle)
- 비용이 intent EV의 50% 초과 → intent abort + 로그
- **어떤 intent도 가스 부족으로 영구 멈추지 않음**

---

## 10. 카나리 (코드, 기존 advance-canary.mjs 확장)

| 단계 | 자본 | 요구 증거 |
|---|---|---|
| dry-run | 0 | 14d shadow audit 양수 EWMA |
| canary-1 | 5,000 sats (~$5) | end-to-end 1회 진입+청산 receipt |
| canary-7 | 50,000 sats (~$50) | 7일 보유, 일일 receipt, unwind 1회 정상 |
| live | per-strategy cap | dispatcher 편입 |

각 카나리 단계 = 별도 PR (cap 변경 = commit 원칙). 실패 시 자동 unwind + 비활성화 플래그.

---

## 11. 대시보드 마인드맵 (사용자 강조)

문제: 모바일에서 체인 탭 시 프로토콜 안 보임 + 화면 잘림 + 노드 겹침.

해결:
1. 마인드맵 데이터 슬라이스에 **체인 내부 swap 제외**, Gateway/LZ 경유 자산 이동만 포함
2. 모바일 우선 (375×812), force-directed 또는 radial 자동 배치, 노드 간 최소 간격 보장
3. 체인 탭 → 해당 체인 zoom + 자식 프로토콜만 펼침 (다른 체인 fade)
4. 프로토콜 도착점에 **공식 SVG 로고** (체인 11 + 프로토콜 11 = 22개)
5. 페이백 화살표 (BOB → BTC L1) 별도 표시
6. Playwright 시각 회귀: 11체인 탭별 스크린샷 + overlap>5px/overflow/로고 누락 fail

---

## 12. 본 문서가 다루지 않는 것 (스코프 명시)

- 다중 사용자 vault (ERC-4626): 단일 운영자 모드 유지
- CEX leg (Hyperliquid, Binance): Gateway 미지원
- Arbitrum/Polygon 직접: Gateway 공식 11체인만
- BitVM/YBTC 라이브: 모니터링만
- 페이백 ratio/timing 변경: 본 문서 스코프 외 (별도 PR)

---

## 13. 본 문서 → plan.md 매핑

| 본 문서 §  | plan.md todo |
|---|---|
| §6 분산 룰 | T2 |
| §7 자동 리스크 데몬 | T3 |
| §8 자본적응형 cap | T1, T4 |
| §9 잔고 정합성 + 부트스트랩 | T19, T20 |
| §10 카나리 | T21 |
| §11 대시보드 | T23-T27 |
| §5 전략 어댑터 | T8-T13 |

---

## 14. 출처

- GLM 리서치 본문: `docs/research/glm-research.md`
- Kimi 리서치 본문: `docs/research/kimi-research-2026-04-21.md`
- 기존 baseline: `docs/research/{bob-ecosystem,strategies-and-risk,ops-costs,payback-rationale}.md`
- 시스템 코드: `src/{config,executor,treasury}/`
- 운영 상태: `docs/current-status.md`, `dashboard/public/dashboard-status.json`
- 불변 원칙: `AGENTS.md`, `.github/copilot-instructions.md`

## 15. 문서 이력

- 2026-04-21: 초판. 4-AI 비교 + 13축 시스템 검증 + 9 전략 카탈로그 + 7 리스크 데몬 + 자본적응형 cap + 끊김 방지 + 대시보드 개선 종합.
