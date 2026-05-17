# Aggressive Velocity Chaser v2 — Execution-Oriented Expansion Plan

**Version**: 2.0  
**Date**: 2026-05-17  
**Status**: Draft (New Session Review Required)

## 1. Executive Summary

기존 v1은 “진짜 고수익만”이라는 철학을 강하게 지켰으나, 그 결과 실제 실행이 거의 발생하지 않는 문제가 발생했다.  
v2에서는 다음을 동시에 추구한다:

- 고수익 중심 철학 유지 (Tier 1은 엄격하게)
- 실행 가능성 확보 (Tier 2 도입)
- DefiLlama, 토큰 에어드랍, 캠페인 등 데이터 소스 공격적 확대
- 유동성이 낮은 고수익 기회도 적극 공략
- 기준을 실험하면서 최적의 실행-수익 균형점을 찾아가는 운영 방식 (5분 Ralph Loop + AI 적극 개입)

## 2. Tiered High-Yield Structure (Core Design)

### Tier 1 — True High Yield
- 기준 (초안): expectedNetBtcProfit ≥ 0.00008 BTC + quality = high + 높은 feasibility
- 역할: 진짜 고수익만 집중 공략
- 비중: 40~60%
- 우선순위: 최고

### Tier 2 — Executable High Yield
- 기준 (초안): expectedNetBtcProfit ≥ 0.00003 BTC + 일정 수준의 실현 가능성
- 역할: 실행량을 확보하면서도 중수익 이하로 떨어지지 않게 관리
- 비중: 40~60%

### Tier 3 (Optional)
- 기본 배제. 필요시 정책 승인 하에만 제한적으로 허용

## 3. Data Source Expansion Strategy

- Merkl: Tier 1 중심으로 유지 (고품질)
- DefiLlama: 공격적으로 확대
- Token Airdrop & Campaign: 별도 수집/분석 로직 개발
- Low-liquidity high-yield opportunities: 적극 탐색

## 4. Criteria Adjustment Framework

- 5분 Ralph Loop를 지속적으로 운영
- 매 틱마다 AI가 직접 loophole을 지적하고 기준 변경 제안
- 주요 조정 대상: 최소 순수익 기준, Capture Rate, Feasibility threshold, Tier 간 비중
- 모든 변경은 데이터 기반으로 판단하고 기록

## 5. Existing System Stability

- v1에서 만든 핵심 개념 (highNetYieldVelocity, riskAdjustedHighNetYieldVelocity, highNetYieldRankScore 등)은 훼손하지 않음
- Tier 구조는 기존 로직 위에 추가 레이어로 구현
- 기존 highYieldSummary, realizationPreview 등은 더 풍부한 데이터를 제공하도록 확장

## 6. Phase Plan (Draft)

- Phase 0: 계획 리뷰 및 최종 방향 확정 (새 세션)
- Phase 1: Tier 구조 구현 + risk-adjusted scoring 일관화
- Phase 2: DefiLlama 적극 활용을 위한 Scanner 대폭 개선
- Phase 3: Airdrop / Campaign 전용 기회 수집 및 분석 로직 개발
- Phase 4: 기준 실험 루프 본격 운영 + 지속 개선

## 7. Operating Principles

- “고수익 중심”은 포기하지 않되, “실행 불능” 상태도 용인하지 않는다.
- 기준 변경은 항상 실제 데이터와 성과로 검증한다.
- 루프마다 AI가 적극적으로 개입하여 loophole을 찾고 개선을 주도한다.

