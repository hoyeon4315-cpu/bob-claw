# BobClaw 전략 공통점·빠진점·개선점 분석

> 작성일: 2026-04-24
> 근거: dashboard-status.json, strategy-tick-status.json, 9개 adapter evaluator, AGENTS.md

---

## 1. 전략 현황 요약

| # | 전략 ID | 상태 | autoExecute | receipt | caps | snapshot |
|---|---|---|---|---|---|---|
| 1 | gateway_native_asset_conversion_sleeve | **live_ready** | **true** | 46 | true | 0 |
| 2 | wrapped-btc-loop-base-moonwell | fast_track_eligible (hold) | false | 508 | true | 0 |
| 3 | beefy-folding-vault | blocked | false | 0 | false | 0 |
| 4 | pendle-pt-lbtc-base | blocked | false | 0 | false | 0 |
| 5 | aerodrome-cl-base | blocked | false | 0 | false | 0 |
| 6 | pendle-pt-solvbtc-bbn-bsc | blocked | false | 0 | false | 0 |
| 7 | berachain-bend-bex-bgt | collateral_only | false | 0 | false | 0 |
| 8 | gmx-v2-perp-basis-avax | blocked | false | 0 | false | 0 |
| 9 | stablecoin-spread-loop | blocked | false | 0 | false | 0 |
| 10 | proxy-spread-expansion | blocked | false | 0 | false | 0 |
| 11 | tokenized-reserve-sleeve | blocked | false | 0 | false | 0 |

---

## 2. 공통점 (Common Patterns)

### 2.1 모두 `snapshotCount = 0`

9개 adapter 등록 전략 중 **0개**가 최신 market snapshot 보유.
- snapshot 수집 파이프라인 (Beefy REST, Pendle SDK, Aerodrome subgraph, GMX oracle 등)이 구현되지 않음.
- `run-strategy-tick.mjs`가 `data/snapshots/`에서 prefix 매칭하는데, 해당 디렉토리가 비어 있거나 갱신 안 됨.

### 2.2 모두 `no_signer_backed_receipts` 블로커

gateway_native 제외 모든 전략이 이 블로커.
- 의미: 한 번도 on-chain 실행을 안 함.
- 원인: `autoExecute: false` + `operator_hold` + caps 미설정.

### 2.3 `autoExecute`가 기본적으로 false

`src/config/strategy-caps.mjs`에 등록돼 있어도 `run-strategy-tick.mjs`의 `buildAdaptiveCapitalPlan`에서:
```js
autoExecute: false, // hard off until operator commits otherwise
```
명시적 committed diff 없이는 어떤 전략도 live 실행 안 됨.

### 2.4 Caps는 등록됐으나 evaluator가 caps를 인식 못 함

`strategy-caps.mjs`에 caps가 있는데도 `capsConfigured: false`로 나옴.
- 원인: `getStrategyCaps(sid)` 호출 결과와 adapter evaluator 내부 로직 불일치.
- 예: `beefy-folding-vault`의 caps는 `strategy-caps.mjs`에 있으나 evaluator가 이를 확인하지 않음.

---

## 3. 빠진점 (Gaps)

### 3.1 Snapshot/데이터 수집 파이프라인

| 전략 | 필요 데이터 | 현재 상태 |
|---|---|---|
| beefy-folding-vault | Beefy vault TVL, APY, performance fee | 미구현 |
| pendle-pt-lbtc-base | PT implied APR, maturity, liquidity | 미구현 |
| aerodrome-cl-base | Pool TVL, fee APR, incentive APR, IL | 미구현 |
| pendle-pt-solvbtc-bbn-bsc | 동일 + Gateway custom action | 미구현 |
| berachain-bend-bex-bgt | Lending TVL, supply APR, BGT reward | 미구현 |
| gmx-v2-perp-basis-avax | Funding rate, OI, borrow APR, perp price | 미구현 |
| stablecoin-spread-loop | Supply/borrow APR, peg drift | 미구현 |
| proxy-spread-expansion | Morpho pool data, proxy TVL | 미구현 |
| tokenized-reserve-sleeve | Reserve implied APR, maturity, liquidity | 미구현 |

**핵심 빠진점**: `src/cli/fetch-*-snapshot.mjs` 형태의 데이터 수집 CLI가 없음.

### 3.2 Receipt → Catalog 주입 파이프라인

gateway_native는 Merkl canary autopilot이 자동으로 실행하고 receipt를 남김.
그러나 다른 9개 전략은:
- 실행할 binding/executor 코드가 없거나,
- 있어도 policy gate 이전에 blocked (caps, snapshot, measured edge).

### 3.3 Promotion Evidence 평가의 Profit 의존

기존 `minCumulativeProfitSats: 200`은 dust canary에게 과도.
- 이미 0으로 낮춤 (2026-04-24).
- 하지만 `minRoundTripEfficiency: 0.9`은 여전히 gas 비용이 높은 전략에게 부담.

### 3.4 Dashboard 전략 상태 표시 부정확

data.jsx의 `STRATEGY_CATALOG`에 gateway_native가 없었음.
- 추가했으나 (2026-04-24), 다른 전략들의 상태도 일관되게 업데이트 필요.
- 특히 `autoExecute`와 `liveReady`의 구분이 dashboard에서 명확하지 않음.

---

## 4. 개선 계획 (Improvement Roadmap)

### 단계 A: 즉시 (이번 주)

#### A1. Snapshot 수집 CLI 스캐폴드 (1개라도)

가장 빠른 경로는 **stablecoin-spread-loop** 또는 **proxy-spread-expansion**:
- Morpho/Aave on-chain 데이터는 이미 treasury refill job에서 사용 중.
- `supplyRatePerSecond`, `borrowRatePerSecond`는 `aave-protocol-canary.mjs`에서 읽음.
- **proxy-spread-expansion**에 대한 `fetch-morpho-snapshot.mjs` CLI를 만들고 cron에 추가.

#### A2. `buildAdaptiveCapitalPlan`에서 caps 기반 autoExecute

`run-strategy-tick.mjs`의 `buildAdaptiveCapitalPlan` 수정:
```js
// 현재: autoExecute: false (hard off)
// 개선: caps에 autoExecute가 명시돼 있으면 따름
const caps = getStrategyCaps(id);
autoExecute: caps?.autoExecute ?? false,
```

#### A3. Receipt-only evaluator 범용화

gateway_native 방식 (receipt 개수만 체크)을 모든 전략에 적용하는 `receipt-only-adapter.mjs` 패턴:
- snapshot이 없을 때: `mode = "blocked", blockers = ["snapshot_missing"]`
- receipt가 있을 때: `mode = "live_candidate"`
- 이를 통해 snapshot 부재가 live 실행을 막지 않도록.

### 단계 B: 단기 (2~4주)

#### B1. Pendle/Beefy/Aerodrome snapshot fetcher 구현

- Pendle: PT implied yield, maturity, liquidity
- Beefy: vault APY, TVL, performance fee
- Aerodrome: pool APR, incentive APR, tick offset
- GMX: funding rate, OI imbalance

각 fetcher는 `data/snapshots/<prefix>-<timestamp>.json` 형태로 저장.

#### B2. Dust Canary 실행 파이프라인 범용화

gateway_native의 `run-merkl-canary-autopilot.mjs`를 범용화:
- 입력: strategyId, chain, vault address, asset address
- 출력: approve → deposit → redeem receipt
- `AUTOMATED_CANARY_BINDINGS`에 전략별 binding 추가.

#### B3. Caps 설정 커밋

각 전략별 caps를 `strategy-caps.mjs`에 명시:
- perTxUsd: $1 (dust)
- perDayUsd: $5
- maxDailyLossUsd: $5
- autoExecute: true (fast track eligible 전략만)

### 단계 C: 중기 (1~2개월)

#### C1. Walk-Forward CV + Regime Change Guard

현재 canonical auto-promotion dev guard에서 자리 잡음.
- `walkForwardReport`와 `regimeWindow` 인자를 실제 데이터로 채워야 함.
- `evaluateWalkForwardCv()`와 `summarizeRegimeWindow()` 구현 필요.

#### C2. Merkl 회전 자동화

- `campaign end` 임박 시 자동 `unwind → rotate → re-entry`
- `merkl-campaign-rotation-gate.mjs` 구현.

#### C3. Health Factor 실시간 모니터링

- lending-loop 전략에 대해 on-chain HF를 주기적으로 조회.
- `hf-check.mjs`를 cron으로 실행 → `liquidationBufferPct` 이하일 때 emergency unwind intent 생성.

---

## 5. 즉시 적용 가능한 코드 변경

### 5.1 `buildAdaptiveCapitalPlan` 개선

```js
function buildAdaptiveCapitalPlan(strategyIds) {
  return {
    newEntriesAllowed: true,
    strategies: strategyIds.map((id) => {
      const caps = getStrategyCaps(id);
      return {
        strategyId: id,
        autoExecute: caps?.autoExecute ?? false,
        newEntriesAllowed: true,
        effectiveCapsUsd: {
          perTxUsd: caps?.caps?.perTxUsd ?? 1,
          perDayUsd: caps?.caps?.perDayUsd ?? 5,
        },
        bindingConstraint: { perTxUsd: "static_cap" },
      };
    }),
  };
}
```

### 5.2 Receipt-only fallback evaluator

```js
export function evaluateReceiptOnlyAdapter({ config, market, receipts }) {
  const signerBacked = (receipts || []).filter(
    (r) => r.source === "signer" || r.broadcast?.txHash || r.lifecycle?.txHash,
  );
  const hasEvidence = signerBacked.length >= 2;
  const snapshotMissing = !market || Object.keys(market).length === 0;
  return {
    strategyId: config.id,
    mode: hasEvidence ? "live" : (snapshotMissing ? "blocked" : "shadow"),
    shadowReady: !hasEvidence && !snapshotMissing,
    liveReady: hasEvidence,
    blockers: snapshotMissing ? ["snapshot_missing"] : (hasEvidence ? [] : ["no_signer_backed_receipts"]),
    candidateCount: 0,
    allowCount: 0,
    denyCount: 0,
    receiptCountSignerBacked: signerBacked.length,
  };
}
```

### 5.3 Dashboard status 자동 갱신

`report-strategy-tick-slice.mjs`와 `report-strategy-catalog.mjs`가 실행될 때마다 `dashboard-status.json`의 `strategyParity`, `promotionSummary`, `liveEligibleCount`를 자동으로 덮어쓰도록 파이프라인 연결.

---

## 6. 결론

현재 BobClaw의 **인프라와 정책 엔진은 L7 수준**에 가깝지만, **전략 실행 표면은 L4~L5**.

가장 큰 병목은 **snapshot 수집 파이프라인 부재**와 **receipt 0개**.
gateway_native는 Merkl autopilot으로 이 병목을 우회했고, 결과적으로 **첫 live-eligible 전략**이 됨.

나머지 9개 전략은:
1. Snapshot fetcher 1개라도 구현 → `vault_tvl_unobserved`, `pt_implied_apr_missing` 등 해결
2. Dust canary 1회 실행 → `no_signer_backed_receipts` 해제
3. Caps committed diff → `autoExecute: true` 활성화

이 3단계를 반복하면 **2~4주 내에 live-eligible 전략 3~5개** 달성 가능.
