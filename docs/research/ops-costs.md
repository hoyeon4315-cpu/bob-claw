# 운영 비용 + 과적합 방지 — 사실 참조

> **이 문서의 성격**: 리서치 사실 참조. **규칙이 아님.** 운영 규칙은 리포 루트 `AGENTS.md`.
> **갱신 주기**: 가스비 실측은 월 1회 (l2fees.info, Etherscan gas tracker), 수학 공식은 변하지 않음.
> **마지막 실사 기준일**: 2026-05-02.

---

## 1. 가스비 관리

### 1.1 핵심 EIP

- **EIP-1559**: baseFee(burn) + priorityFee(tip), 블록당 ±12.5%
- **EIP-4844 (Dencun, 2024-03)**: blob 데이터로 **L2 수수료 50–90% 감소**
- **EIP-7702 (Pectra, 2025-05-07)**: EOA → Type 4, 배칭/paymaster/세션키

### 1.2 체인별 실측 tx 비용 (l2fees.info 2026-04)

| 체인 | ETH 송금 | 스왑 |
|---|---|---|
| Ethereum L1 | $1.10 | $5.48 |
| Arbitrum One | $0.09 | $0.27 |
| Optimism | $0.09 | $0.18 |
| Base | $0.002–0.05 | $0.05–0.10 |
| Polygon zkEVM | $0.19 | $2.75 |
| Avalanche | $0.05 이하 | ~$0.10 |
| BNB Chain | $0.20 | ~$0.40 |
| Unichain | $0.01 이하 | ~$0.02 |
| Sonic | $0.001 이하 | ~$0.003 |
| BOB L2 | $0.03 이하 | ~$0.05 |
| Berachain | $0.01–0.05 | ~$0.05 |
| Soneium | $0.01 이하 | ~$0.02 |

**주의**: 이 표의 값은 평균치. 실제 트랜잭션 시 **chain RPC의 `estimateGas` + 버퍼**로 계산 (실측에서 fallback gas가 부족해 리버트된 사례 있음 — AGENTS.md Operator Memory의 "Sonic/Avalanche wBTC.OFT → Base wBTC.OFT" 항목 참조).

### 1.2.1 tiny-canary 비용 기준 (2026-05-02 재검토)

목적: Merkl/radar tiny live canary는 일반 포지션 최소 notional이 아니라 "검증 샘플"이므로, EV 게이트는 고정 `$0.12`/7일 가정이 아니라 캠페인 잔여기간과 체인별 p90 실행비용을 써야 한다.

로컬 receipt 기준:

| 경로 | 표본 | 관측 수수료 |
|---|---:|---|
| Base ERC-4626 deposit/redeem canary | 2 delivered samples | `0.000004622022`-`0.00000464031` ETH, 3-step bundle |
| Ethereum ERC-4626 canary | 3 samples | 약 `$0.14`-`$0.36` equivalent, 3-step bundle |
| Base gas snapshot 260k fallback tx | latest `data/gas-snapshots.jsonl` | 약 `$0.0036` per tx |

정책 반영: `src/config/sizing.mjs`의 `TINY_CANARY_COST_POLICY`.

| 체인군 | tiny canary same-chain round-trip fallback | 판단 |
|---|---:|---|
| Base | `$0.012` | Base receipt p90에 버퍼를 둔 aggressive v1. 19.8% APR, 33일 캠페인, `$1.40` inventory는 EV 양수로 통과 가능. |
| Ethereum | `$0.36` | 같은 tiny notional은 대부분 차단. L1은 명시적 cost estimate 또는 더 큰 committed cap이 필요. |
| BSC | `$0.03` | BNB Chain은 저렴하지만 Base/OP보다 보수적으로 둠. |
| OP-stack/저비용 destination chains | `$0.003` | gas snapshot/체인 fee 구조상 tiny canary 검증에 맞는 기본값. |
| Unknown chain | `$0.12` | 보수 fallback 유지. |

Radar/Merkl reward 처리:

- Merkl entry asset inventory(예: USDC 예치 자산)는 reward token으로 간주하지 않는다.
- explicit reward token이 없고 share-price/native-yield로 수익이 반영되는 ERC-4626 canary는 deposit/withdraw gas만 tiny EV 비용에 넣는다.
- explicit reward token이 있으면 reward-token haircut, claim cost, swap cost, exit-liquidity proof를 다시 요구한다.

외부 구조 확인:

- Base docs: transaction fee is L2 execution fee + L1 security fee, and Base exposes `GasPriceOracle` for L1 fee estimation. https://docs.base.org/base-chain/network-information/network-fees
- Optimism docs: OP Stack total fee is L2 fee + L1 fee + operator fee. https://docs.optimism.io/chain-operators/guides/management/transaction-fees-101
- Ethereum.org: gas fee is gas used multiplied by fee per gas. https://ethereum.org/developers/docs/gas/

재검토 결론: Base-first tiny canary의 낙관적 실행을 열되, 동일한 공식이 Ethereum/L1 비용을 크게 반영하게 하므로 과적합 완화와 gas-burn 방어를 동시에 만족한다. 이 기준은 수익 확정이 아니라 canary admission 기준이며, 실제 성공은 reward accrual, claim/swap, unwind receipt로만 판단한다.

### 1.3 가스 리저브 계산 공식

**체인별 최소 native balance** (Gas Float Keeper, AGENTS.md Component 5):

```
minNativeBalance_chain = avgSwapGasCost_chain × safetyMultiplier × periodicBurstFactor
safetyMultiplier = 5  (관례)
periodicBurstFactor = 3  (peak time에 3배 burst)
```

**청산 방어 준비금** (레버리지 전략):

```
liquidationDefenseReserve = liquidationTxCost_chain × p99 × 3회 × 1.5
```

**p99**: 해당 체인의 99th percentile gas price (Etherscan gas tracker 또는 chain별 analytics).
**×3회**: 연속 청산 방어 호출 3회 여유.
**×1.5**: 안전 마진.

실제 구현은 `src/executor/capital/gas-float-keeper.mjs`에 있으며, 위 공식이 거기에 반영되어 있는지 월 1회 검증.

### 1.4 비상 임계치 (L1 base fee)

```
if ethereum_base_fee > 200 gwei:
  Ethereum L1 전략 자동 pause
if ethereum_base_fee > 500 gwei:
  모든 L1 경유 Gateway 경로 자동 pause (offramp 포함)
```

숫자는 참고치. 실제 값은 `src/config/strategy-caps.mjs`의 chain-level cap으로 구현.

### 1.5 자동화 도구 참고

- **DeFi Saver**: Aave V4 day-1 지원, 자동 리밸런싱, ConsenSys/Dedaub 감사
- **Summer.fi**: Maker/Aave/Spark/Morpho 멀티 프로토콜
- **Instadapp DSA**: 오픈소스, `github.com/instadapp/dsa-contracts`

BobClaw는 이들의 상용 서비스를 **사용하지 않고** 동일 패턴(`src/executor/capital/rebalancer.mjs`)을 자체 구현. 이유: `autoExecute` 모델 + per-strategy cap 엄격 enforcement + LLM 경계 (AGENTS.md Execution Safety).

### 1.6 MEV + Paymaster

- **Flashbots Protect / `/fast`**: 공개 멤풀 경유 회피, sandwich 공격 차단
- **CoW Protocol**: batch auction으로 MEV 보호 내장, 페이백 scheduler의 swap 단계 후보
- **Paymaster (ERC-4337 / EIP-7702)**: gas 추상화, 미사용 가정 (스택 복잡도 대비 편익 작음)

### 1.7 가스 리필 브릿지

현재 저장소의 `refill:*` 시리즈 명령은 체인별 native gas 잔고 부족 시 source chain → destination chain으로 native token 보충. 기본 패턴:

- Base → target chain native gas (LI.FI 또는 Across 경유)
- BOB L2 wBTC.OFT → target chain wBTC.OFT → swap to native

`execution_attempt_blocked` journal event가 emit되는 케이스(AGENTS.md Operator Memory `bera:native`, `unichain:native`, `bob:wBTC.OFT`)는 현재 conditional bootstrap jobs로 분류되어 있음 — 실제 refill helper가 완성되면 해소.

---

## 2. 과적합 방지 체크리스트

### 2.1 백테스트 전 필수 체크

| 항목 | 검증 방법 |
|---|---|
| 단일 기간 최적화가 아닌가? | 최소 1회 regime change 포함 12–24개월 |
| Walk-Forward purged/embargoed CV인가? | López de Prado 2018 ch.7 적용 — `backtest/metrics.mjs`에 `purge_days`, `embargo_days` 파라미터 |
| OOS(Out-of-Sample) 검증 있는가? | 학습 기간과 테스트 기간이 시간상 분리 + purge gap 적용 |
| Deflated Sharpe Ratio 계산했는가? | López de Prado 공식: 시도한 전략 수로 보정 |
| CSCV (Combinatorially Symmetric Cross-Validation) PBO < 50%인가? | Bailey-Borwein-López de Prado 2014 |
| Walk-Forward Efficiency (WFE) ≥ 50%인가? | in-sample Sharpe 대비 out-of-sample Sharpe 비율 |
| BTC ±50% 가격 시나리오 KPI 시뮬 했는가? | paper PnL + BTC 환산 스트레스 |
| shadow mode 최소 4주 데이터 있는가? | 단, AGENTS.md "no tiered phase gate" — shadow는 측정용, 자동 승격 없음 |

### 2.2 하드코딩 금지 패턴 (AI 안티패턴)

AI가 작성한 코드가 아래 중 하나라도 해당하면 즉시 리팩토링:

- 프로토콜/체인 이름이 코드에 **문자열로 하드코딩** → `src/config/*.mjs` enum
- TVL/APY 임계치가 **숫자로 하드코딩** → config 외부화
- 단일 RPC provider 사용 → FallbackProvider 2+개 필수
- try/catch 없이 웹훅/외부 API 호출 → 지수 백오프 재시도 필수
- Private key가 env var/파일에 **평문 저장** → `BURNER_*_KEY_PATH` env 경로만 (AGENTS.md Execution Safety)
- 트랜잭션 전 **시뮬레이션 없이** 직접 전송 → `estimateGas` + 버퍼 패턴 (이미 repo에서 쓰는 패턴)
- **maxFeePerGas 캡 없이** 트랜잭션 제출 → 가스 스파이크 시 예상 외 비용
- LLM이 **금액/실행 여부/페이백 비율**을 직접 결정 → 정책 엔진 + 룰 통과 필수 (AGENTS.md LLM matrix)
- 백테스트 **OOS 검증 없이** 프로덕션 → 이 문서 §2.1 체크리스트 적용
- `flashLoan` 후 **repay 실패 경로 미처리** → revert 대비 필수
- ★ **PnL이 USD 단위로만 계산** → BTC denominated 회계 필수 (AGENTS.md Reporting)
- ★ **Gateway round-trip 비용 미반영** → 페이백 net이 마이너스 가능 (AGENTS.md Payback Model)

### 2.3 단일 데이터포인트 함정 (실제 겪은 예)

**잘못된 패턴**: "지난 6개월 Morpho cbBTC/USDC 루프 Sharpe 1.8이니 좋다" → 1개 기간, 1개 시장, 1개 프로토콜, 1개 자산 쌍. 어떤 하나가 변해도 Sharpe 붕괴 가능.

**올바른 패턴**: 
- 3+개 체인 (Base + Ethereum + Avalanche)에서 동일 전략 측정
- 2+개 시장 regime (상승장 6개월 + 하락장 6개월)
- 각 조합의 Sharpe 분포를 내고, worst-decile의 Sharpe > 0인지 확인
- Deflated Sharpe 적용 후 p-value 확인

이 프로세스의 최소 구현이 `strategy-pivot-plan.json` · `strategy-research-board.json`이며, 새 전략 제안 전에 이 산출물을 업데이트.

### 2.4 적응형 임계치

**원칙**: 고정 임계치 대신 "최근 N일 distribution의 p-X" 기반으로.

| 임계치 | 고정값 방식 (비권장) | 적응형 (권장) |
|---|---|---|
| 슬리피지 허용 | "50 bps 이내" | "지난 30일 실현 슬리피지 p90 × 1.5 이내" |
| 가스 급등 감지 | "200 gwei 이상 pause" | "지난 24시간 base fee p95 × 2 초과 시 pause" |
| 청산 위험 | "HF < 1.5이면 unwind" | "HF < (correlated pair는 1.2, non-correlated는 1.5)" |

적응형 임계치의 위험: distribution이 천천히 drift하면 감지가 늦어짐 → 반드시 고정 **하한 cap**도 함께 선언.

### 2.5 재검증 주기 (cron으로 강제)

| 데이터 | 주기 | 소스 |
|---|---|---|
| Gateway round-trip 실측 비용 | 주 1회 | `dune.com/bob_collective/gateway` |
| 주요 프로토콜 TVL | 월 1회 | DeFiLlama |
| BTC LST APY 실현치 | 월 1회 | DeFiLlama, 프로토콜 공식 대시보드 |
| 체인 가스비 | 월 1회 | l2fees.info, Etherscan |
| BOB 로드맵 상태 | 월 1회 | gobob.xyz blog, Messari |
| 해킹·exploit 이력 | 주 1회 | rekt.news |

각 갱신은 **출처 URL + 확인 날짜**를 해당 research 문서에 기재.

### 2.6 Paper Trading / Shadow 모드

AGENTS.md "no tiered phase gate" 원칙 하에서도, 새 전략은 **측정 단계**를 거친다:

1. **Analysis only**: 데이터 수집만, 서명 없음. `strategy-snapshot.json`에 `analysis_only` 표기.
2. **Shadow observation**: 실제 policy를 통과시키되 signer는 `dry_run` 모드로 tx 서명 대신 intent를 로그. `shadow observations` 카운터로 측정.
3. **Live eligibility**: 측정 결과가 acceptance 기준을 통과하면 자동으로 live-eligible (별도 수동 승격 단계 없음). acceptance 기준은 `config/backtest.yaml` 대신 `src/config/*.mjs`에 선언.

현재 repo에는 3단계가 이미 구현되어 있음 — `liveEligibleCount=0`의 의미는 "측정은 하지만 아직 기준 통과 전략 없음"이지, "phase gate 걸렸음"이 아님.

---

## 3. 감사증적 / 로깅

### 3.1 핵심 로그 파일

- `logs/signer-audit.jsonl` — 모든 sign/broadcast/error (append-only, AGENTS.md)
- `data/execution-journal.jsonl` — 전략별 intent 생애주기
- `data/gateway-btc-consolidation-executions.jsonl` — 통합 이벤트
- `data/gateway-btc-offramp-executions.jsonl` — 페이백 경로의 핵심 로그 (페이백 엔진 배치 후 이 로그의 delivered 비율이 `roundTripEfficiency` KPI의 입력)

### 3.2 Three-way receipt (페이백 전용)

AGENTS.md "Payback Model" settlement proof:
1. Destination chain source tx hash (wrapped BTC 소진)
2. BOB L2 Gateway `OfframpRegistry.createOrder()` order id
3. Bitcoin L1 destination address balance delta txid

셋 모두가 로그에 존재해야 "delivered" 카운트. 하나라도 빠지면 accumulator가 해당 period를 `pending`으로 유지.

### 3.3 외부 감사도구

**참고 (직접 사용하지 않음)**:
- **IPFS CID를 온체인 이벤트로 emit** — high-stakes 포지션의 거래 근거 영구 기록 (추후 확장)
- **Sentry / OpenTelemetry / Loki** — 애플리케이션 로그 집계 (운영자 개인 환경)

BobClaw 자체는 파일 기반 append-only 로그로 충분. 외부 observability 스택은 운영자 선택.

---

## 문서 이력

- 2026-04-17: v3 Part 7 (가스) + Part 12 (과적합) 재구성. 체인별 가스 표에 BOB Gateway 공식 11 체인 모두 포함. 적응형 임계치 패턴 추가. Three-way receipt 규칙 명시.
