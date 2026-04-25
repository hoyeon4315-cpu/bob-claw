# 페이백 모델 — 기본값 근거

> **이 문서의 성격**: 리서치 사실 참조. **규칙이 아님.** 운영 규칙은 리포 루트 `AGENTS.md` "Payback Model" 섹션.
> **용도**: `src/config/payback.mjs`의 기본값(baseRatio, regimeMultipliers 등)을 **왜 그 숫자인가** 설명. 값을 바꿀 때 이 문서를 함께 업데이트하고 PR 본문에 근거 변경을 기재한다.
> **마지막 실사 기준일**: 2026-04-17.

---

## 1. 기본값의 이론적 근거

### 1.1 `baseRatio = 0.20` (Half-Kelly 근사)

**수학적 근거**:

**Kelly Criterion** (로그정규 자산, 연속 시간):

```
f* = (μ − r) / σ²
```

여기서 μ = 자산 기대수익률, r = 무위험수익률, σ = 자산 변동성.

BTC 4.5–10년 월간 데이터 분석(Perrenod, `stephenperrenod.substack.com`):
- **Full Kelly f* = 32.8–36%**

**Half-Kelly** (Thorp 1970s, MacLean-Thorp-Ziemba 2010):
- 기대성장률의 ~75% 유지
- 변동성은 ~50% 감소
- **Half-Kelly ≈ 16.5%**, **Quarter-Kelly ≈ 8%**

**BobClaw 매핑**: 페이백 비율은 "수익 중 얼마를 확정 수익(BTC 누적)으로 이전하고 얼마를 compound 재투자에 남길 것인가"의 배분 문제. Half-Kelly 근처의 **15–25% 범위**가 이론적으로 합리적.

**업계 관행 합의 구간**:
| 사례 | 비율 | 맥락 |
|---|---|---|
| **Tether 분기 정책 (공식 2023)** | **15%** | 분기 순이익의 15%를 BTC 매입 |
| **ARK Invest Big Ideas 2024** | **19.4%** | 2023년 최적 BTC 포트폴리오 배분 (2015 0.5% → 2023 19.4%) |
| **Half-Kelly 근사** | **~16.5%** | 이론값 |
| **MicroStrategy (Strategy)** | ~100% | 잉여현금흐름+자본조달의 ~100%를 BTC로. Aggressive 극단 |
| **Metaplanet** | ~95% | 옵션 프리미엄 수익의 95% |

**합의 구간 20–25%**가 Half-Kelly와 실무 관행의 중간 지점. `baseRatio=0.20` 기본값은 보수적 쪽에 가까움.

**프로파일 선택** (AGENTS.md 명시 X, 설계 참고용):

| 프로파일 | baseRatio | 근거 |
|---|---|---|
| Conservative | 0.15 | Quarter-Kelly, Tether 정책 |
| **Moderate (기본)** | **0.20–0.25** | Half-Kelly, ARK, 업계 중간값 |
| Aggressive | 0.40–0.50 | Full-Kelly 근사, MicroStrategy/Metaplanet 근접 |

### 1.2 DCA 연구 근거 (주기 선택)

페이백이 **주간 batch**인 이유:

- **Vanguard 2012**: LSI(일시불)가 DCA를 67% 빈도로 이김, 초과수익 2–3% (1926–2011 미/영/호 데이터). 단, **drawdown이 현저히 큼**.
- **Amdax (Tim Stolte)**: LSI 연수익 3배이지만 drawdown +20% 더 큼. **Calmar 비율(연수익/max drawdown) 기준으로는 주간 DCA가 가장 위험조정 효율적**.
- **$100/월 BTC DCA 2014–2025**: 총투입 $35,700 → $589,000, ROI 1,648% (단순 환산).

**BobClaw 매핑**: 페이백은 일종의 "수익의 역방향 DCA" — 운용 자본에서 BTC로 점진 이전. 주간 주기가 Calmar 효율성 측면에서 일단위보다 낫고, 월단위보다 세부 조정 유연성(regime/volatility 동적 조정) 확보.

### 1.3 `regimeMultipliers = {bear: 1.2, neutral: 1.0, bullPeak: 0.7}`

**직관**: BTC가 비쌀 때 적게 환원(더 운용), 쌀 때 많이 환원(더 누적).

**Mayer Multiple 기준** (BTC price / 200-day moving average):
- MM > 2.4 → "bull_peak" → `×0.7` (페이백 축소, BTC 더 쌓기 어려워진 구간)
- 0.8 ≤ MM ≤ 2.4 → "neutral" → `×1.0`
- MM < 0.8 → "bear" → `×1.2` (페이백 확대, 싸게 BTC 누적 기회)

**주의**: 이는 **시장 타이밍이 아닌** "비싼 BTC는 적게 사고 싼 BTC는 많이 산다"는 가치평균(Value Averaging) 변형. 바닥·천장을 맞추려는 게 아니라 장기 평균 매입단가를 낮추는 것.

**⚠️ 경험적 캘리브레이션 필요**: MM 경계(2.4 / 0.8)와 multiplier 값(1.2 / 0.7)은 관례에서 가져온 **초기값**이며 BobClaw 자체 실측으로 검증되지 않음. 최소 4주 shadow 데이터 축적 후 BTC 가격 추이와 페이백 효율을 교차 확인하여 조정. 하드코딩된 최종값으로 취급 금지.

**데이터 소스**: Mayer Multiple은 `src/config/oracles.mjs`에 pinned source로 선언해야 함. 런타임에 임의 oracle 사용 금지 (AGENTS.md Risk Limits의 "whitelisted oracle" 규칙).

### 1.4 `volMultiplier`: `min(1.0, 0.5 / realizedVol60d)`

**직관**: 변동성이 낮으면 기본 비율로, 변동성이 높으면 비율을 낮춰 불안정 구간에서 환원 보수.

**수식 풀이**:
- realizedVol60d = 0.5 (연환산 50%) → multiplier = 1.0
- realizedVol60d = 1.0 (연환산 100%) → multiplier = 0.5
- realizedVol60d = 0.25 (연환산 25%) → multiplier = min(1.0, 2.0) = 1.0 (cap 적용)

**cap=1.0의 의미**: 저변동성이라고 페이백을 증폭하지 않는다. 오직 고변동성일 때 감쇠.

**⚠️ 0.5 기준 근거 빈약**: `0.5 / realizedVol60d` 공식의 분자 0.5는 "BTC 연환산 변동성이 50%일 때 배수=1.0"이 되도록 설정된 관습치. 실측 샘플에서 페이백 delivered BTC가 변동성과 어떻게 상관되는지 측정한 뒤 조정. regimeMultiplier와 마찬가지로 shadow 4주+ 이후 재검토.

**데이터 소스**: 60일 realized volatility를 어느 tick 빈도에서 계산할지(일간 close-to-close vs intraday)는 `src/config/payback.mjs`의 부수 필드로 명시. 현재 기본은 일간 close-to-close 권장.

### 1.5 `maxOfframpCostPctOfPayback = 0.10`

**근거**: docs/research/bob-ecosystem.md §1.3 round-trip 비용 0.2–1.6%.

소액 페이백일수록 고정비가 커져 효율이 떨어진다. "페이백의 10% 이상이 Gateway 비용"이면 defer하여 다음 주 batch로 누적.

**예시**:
- payback 계획 0.001 BTC, offramp 비용 0.00005 BTC (5%) → 집행
- payback 계획 0.0001 BTC, offramp 비용 0.00002 BTC (20%) → defer, 누적

이 규칙이 없으면 소액 잦은 페이백이 장기 수익을 잠식.

### 1.6 `minPaybackSats = 50_000` (≈ 0.0005 BTC)

**근거**: 현재 BTC 가격 ~$100K 가정 시 $50. 실제 Gateway round-trip 비용 하한(~$2)의 25배. 고정비 대비 의미 있는 최소 단위.

**BTC 가격 변동 시 재검증**: BTC가 $50K로 하락하면 50k sats = $25로 떨어져 비용 비율이 높아짐. 월간 재검증 시 이 상수를 조정할지 평가.

### 1.7 Emergency pause triggers

AGENTS.md Risk Limits에 명시된 3가지 — 각각의 근거:

**`offrampSlippageBpsMax = 200` (2%)**:
- 정상 Gateway offramp slippage는 0.05–0.3% 범위 (docs/research/bob-ecosystem.md §1.3)
- 2%는 **그 10배** — 라우팅 이상 또는 유동성 고갈 신호
- 자동 정지하고 operator 수동 확인

**`operatingDrawdownPctMax = 30`**:
- Kelly 이론상 Half-Kelly 운영 시 **maximum drawdown** 기대값 ~30–50% 범위
- 30%는 보수 하한 — 이를 초과하면 "전략 자체의 리스크 모델이 깨졌을 가능성" 신호
- 페이백을 중단하고 운용 자본 보존

**`protocolExploitList` (운영자가 채움)**:
- 감지는 Hypernative/대외 알림 기반
- 특정 프로토콜이 exploit되면 해당 프로토콜 연관 포지션이 있는지와 무관하게 페이백 전체 중지 → operator review → 재개 via committed diff
- 실제 구현은 Alerter(Component 8)가 flag를 세우고 scheduler가 파일 존재로 감지하는 간접 패턴 권장 (AGENTS.md kill-switch 스타일)

---

## 2. KPI 정의 (accumulator.mjs 출력)

AGENTS.md "Payback Model" KPI 표의 **계산식 상세**. 모든 값은 sats 단위.

### 2.1 BYR (BTC Yield Ratio)

```
BYR_rolling12m = paidBackSats_rolling12m / operatingCapitalSats_atPeriodStart_12m_ago
```

**해석**: "지난 12개월 동안 내 Bitcoin L1 지갑에 얼마나 BTC가 쌓였는가, 운용 시작 시 자본 대비".

**목표 밴드 5–15%**의 근거:
- Babylon GRR 1–2% × 운용 자본 레버리지 3–5x × 페이백 비율 0.20–0.25 = ~0.6–2.5%
- BTCfi 고APY 토큰 인센티브 realize 가정 시 5–10% 상한
- 15%는 aggressive 낙관치 (MicroStrategy-like scenario에서만 도달)

### 2.2 CG (Compound Growth)

```
CG_rolling12m = operatingCapitalSats_now / operatingCapitalSats_12m_ago - 1
```

**해석**: "지난 12개월 동안 운용 float 자체가 BTC 단위로 얼마나 커졌는가" (페이백으로 빠져나간 BTC 제외).

**목표 밴드 10–25%**의 근거:
- 운용 수익 중 75–80% (1 - baseRatio) compound = 연 ~10–20% 기대
- 고위험 전략까지 포함 시 25% 상한

### 2.3 TBR (Total BTC Return)

```
TBR_rolling12m = (paidBackSats_rolling12m + operatingCapitalSats_now) / operatingCapitalSats_12m_ago - 1
```

**해석**: "지난 12개월 동안 내 전체 BTC 자산(L1 누적 + 운용 float)이 시작 대비 얼마나 커졌는가".

**목표 밴드 15–40%**: BYR + CG를 합친 것이지만 단순 합이 아닌 compound 효과 포함.

### 2.4 Round-trip 효율

```
roundTripEfficiency_period = (grossRealizedProfitSats - gatewayRoundTripCostSats) / grossRealizedProfitSats
```

**목표 >90%**: Gateway 비용이 수익의 10% 이내로 제한됨을 의미. `maxOfframpCostPctOfPayback` 규칙과 일관.

### 2.5 Days to Breakeven

```
daysToBreakeven = (initialRoundTripEntrySats - cumulativePaidBackSats) / averageDailyPaybackSats_recent
```

**해석**: "처음 onramp 때 쓴 비용을 페이백이 회수하는 데 걸리는 잔여 일수".

**목표 <60일**: 2개월 안에 진입 비용을 회수하지 못하면 전략 편익이 약함을 뜻함. 전략 자체 수익 문제, 페이백 엔진 파라미터 문제, 아니면 둘 다를 검토 트리거.

---

## 3. 기업·펀드 정책 사례 (참고)

BobClaw의 직접 템플릿은 아니지만, 비율 선택 배경으로:

- **Strategy (MicroStrategy)**: 638,985 BTC 보유 (공급의 3.05%), 잉여현금흐름+자본조달의 ~100%를 BTC로 전환 — 극단값
- **Metaplanet**: 30,823 BTC, 옵션 프리미엄 수익의 95% — 극단값
- **Tether**: 분기 순이익의 **15%**를 BTC로 (공식 정책 2023) — 보수값
- **ARK Invest Big Ideas 2024**: 2023년 BTC 최적 배분 **19.4%** (2015 0.5%에서 상승)
- **Fidelity Digital Assets**: BTC 5년 Sharpe 0.96 vs S&P500 0.65, **Sortino 1.86**

**결론**: 업계 합의 구간 **15–25%**가 기본값으로 합리적. 이 문서의 `baseRatio=0.20`은 중앙값에 가까운 보수 선택.

---

## 4. 재검증 트리거

다음 중 하나가 발생하면 이 문서와 `src/config/payback.mjs`를 함께 업데이트:

- BTC 가격 ±50% 변동 (고정 sats 임계값이 USD 기준에서 의미 변질)
- Babylon GRR 또는 주요 BTC LST yield가 현재 값의 ±50% 이동
- Gateway round-trip 실측 비용이 기재된 0.2–1.6% 범위를 벗어남 (월 1회 Dune 체크)
- BTC 60일 realized volatility가 1.5를 초과 (고변동성 regime)
- Mayer Multiple 기준의 bull/bear 경계가 오랜 기간(>6개월) 한쪽에만 머물 때

업데이트 방법: 이 문서 해당 섹션 수정 + PR 본문에 "어떤 불변 원칙을 건드렸는가" 답 명시 + `src/config/payback.mjs` 값 변경 커밋.

---

## 문서 이력

- 2026-04-17: v3 Part 6 재구성. sats 단위로 수식 변환. Mayer Multiple / realized vol 데이터 소스를 `src/config/oracles.mjs` 경유로 명시. Emergency pause 3트리거 근거 보강.
