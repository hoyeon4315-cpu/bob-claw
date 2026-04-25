# Merkl BTC 후보 1차 스크리닝 (2026-04-22)

목적: Merkl를 "수익률 보드"가 아니라 "후보 발굴기"로 한 번 실제 사용해 보고, BOB Claw의 현재 범위와 승격 규칙에 맞는지 1차로 거른다.

이 문서는 다음 원칙을 따른다.

- BTC 기준 회계가 먼저다. USD/APR 표시는 참고만 한다.
- 에어드랍/인센티브는 본수익이 아니라 추가 업사이드로 본다.
- same-chain, deterministic unwind, receipt-backed 검증이 우선이다.
- Merkl에 보인다는 사실만으로 live 승격하지 않는다.

## 필터

이번 1차 컷은 아래 네 조건을 통과하는지 본다.

1. BTC 또는 BTC 담보가 직접 들어가야 한다.
2. 현재 운영 범위 체인 또는 그에 가까운 확장 체인이어야 한다.
3. 보상 토큰을 빼도 설명 가능한 전략 구조여야 한다.
4. unwind와 정책 검증을 repo에 붙일 수 있어야 한다.

## 바로 탈락시키는 패턴

- APR은 높은데 TVL이 너무 작아 인센티브 왜곡이 큰 경우
- LP/in-range 유지가 핵심인데 현재 repo에 해당 포지션 관리기가 없는 경우
- campaign가 이미 inactive인 경우
- Monad 같은 현재 운영 범위 밖 체인에만 있는 경우
- "포인트/프리TGE" 의존도가 높아 확정 현금흐름으로 보기 어려운 경우

## 1차로 본 후보

### 1. Morpho Ethereum — Borrow EURC on WBTC/EURC 86%

- Merkl 페이지: <https://app.merkl.xyz/opportunities/ethereum/MORPHOBORROW/0xff527fe9c6516f9d82a3d51422ccb031d123266e>
- 관측값: Ethereum / Morpho / WBTC 담보 / EURC 차입 / APR 5.78% / TVL 약 $10.13M / live campaign 13일 남음
- 해석:
  - BTC 담보 기반이라 우리 회계 모델과 맞는다.
  - "BTC 담보 + stable 차입" 구조라 `recursive_stablecoin_lending_loop` 연구 방향과 닿아 있다.
  - 다만 현재 repo blocker인 `stable_swap_binding_missing`, `dry_run_receipt_missing`, `recursive_observed_receipts_missing`를 그대로 맞게 된다.
- 1차 판정: `연구 후보로 통과`
- 승격 메모:
  - live 승격 전 필요: Morpho Ethereum binding, stable unwind route, health-factor receipt, signer-backed dry run

### 2. Base — Hydrex EURC-cbBTC LP

- Merkl 페이지: <https://app.merkl.xyz/opportunities/base/HYDREX/0xfe4d6560d04fed2c9b6b163cb88979d7cce3874a>
- 관측값: Base / Hydrex / cbBTC+EURC / APR 38.39% / TVL 약 $36.8K / live campaign 4일 남음
- 해석:
  - 표면 APR은 높지만 TVL이 너무 작다.
  - LP + in-range 유지가 핵심이라 현재 deterministic executor 구조보다 훨씬 운영 난도가 높다.
  - 인센티브가 빠지면 경제성이 급격히 약해질 가능성이 크다.
- 1차 판정: `보류`
- 보류 이유:
  - low TVL
  - LP manager 부재
  - 인센티브 왜곡 가능성 큼

### 3. Base — Ichi wETH-cbBTC vault

- Merkl 페이지: <https://app.merkl.xyz/opportunities/base/ERC20LOGPROCESSOR/0xCf27Dd90878Dd88FD58bFfFCBDfBC7E0Cf7cd779>
- 관측값: Base / Ichi / cbBTC+wETH / APR 30.96% / TVL 약 $669.98K / active campaigns 3개 / 4일 남음
- 해석:
  - TVL은 위 후보보다 낫다.
  - 하지만 managed LP vault라 내부 재조정 로직과 실제 손익 분해가 더 어렵다.
  - 현재 repo는 lending carry와 deterministic sleeves 쪽이 더 잘 맞고, managed LP vault는 관측/통제가 약하다.
- 1차 판정: `보류`
- 보류 이유:
  - managed vault 블랙박스 성격
  - ETH 베타 노출 증가
  - 현재 BTC-first deterministic lane과 거리 있음

### 4. Base — Quickswap USDC-cbBTC LP

- Merkl 페이지: <https://app.merkl.xyz/opportunities/base/CLAMM/0xaCc2874ed22e811afdc47979c7b7985cCEd53b29>
- 관측값: Base / Quickswap / USDC+cbBTC / APR 25.48% / TVL 약 $203.38K / live campaign 6일 남음
- 해석:
  - 구조는 단순하지만 결국 LP 인센티브 trade다.
  - current repo의 LP support는 Aerodrome 중심이고, Quickswap 전용 range/fee/incentive 측정은 없다.
  - 보상 토큰 QUICK 의존도가 높다.
- 1차 판정: `보류`

### 5. BOB — UniswapV3 WBTC-USDT 0.3%

- Merkl 페이지: <https://app.merkl.xyz/opportunities/bob/CLAMM/0x6407FEc527aBad1AafdB9A3b5A2171800C21a2Fe>
- 관측값: BOB / Uniswap / WBTC+USDT / TVL 약 $444.77K / no active campaign
- 해석:
  - 체인 관점에서는 매력적이다.
  - 하지만 현재 campaign가 inactive라 지금 당장 인센티브 기반 진입 근거는 없다.
  - LP 운용 측면에서도 위와 같은 executor 부재 문제가 있다.
- 1차 판정: `지금은 탈락`

### 6. Euler 계열 WBTC 기회

- 예시 페이지: <https://app.merkl.xyz/opportunities/unichain/EULER/0x5d2511C1EBc795F4394f7f659f693f8C15796485>
- 관측값: Unichain / Euler / WBTC lend / no active campaign
- 해석:
  - Euler 자체는 우리 연구 범위에 맞고, BOB 생태계 문서상 Euler v2는 중요한 프로토콜이다.
  - 하지만 Merkl에서 바로 잡히는 현재 기회는 inactive가 많거나, 현재 운영 범위 밖 체인 사례가 섞여 있다.
- 1차 판정: `watchlist`

## 이번 라운드 결론

Merkl에서 지금 당장 가장 "우리 방식으로 재가공해 볼 가치가 있는" 후보는 아래 하나였다.

- `Morpho Ethereum / WBTC 담보 / EURC 차입`

이 후보를 고른 이유는 단순하다.

- BTC 담보가 직접 들어간다.
- 구조가 lending-loop 연구와 이어진다.
- LP range management보다 deterministic policy로 다루기 쉽다.
- 인센티브를 빼도 전략 구조 설명이 가능하다.

반대로 이번 라운드에서 LP/에어드랍성 후보들은 대부분 보류했다.

- APR은 높아도 TVL이 작거나
- 인센티브 비중이 크거나
- managed vault라 실측 손익 분해가 어렵거나
- 우리 executor가 아직 직접 다루기 어려웠다

## BOB Claw에 바로 연결하면 좋은 다음 작업

1. Morpho Ethereum WBTC/EURC 시장을 `recursive_stablecoin_lending_loop`의 외부 후보로 추가
2. 필요한 binding을 정리
3. dry run receipt shape를 먼저 확정
4. unwind 경로를 "EURC 상환 -> WBTC 담보 해제" 기준으로 문서화

## 소스

- Merkl 메인 opportunities: <https://app.merkl.xyz/>
- Merkl protocol page, Morpho: <https://app.merkl.xyz/protocols/morpho>
- Merkl protocol page, Euler: <https://app.merkl.xyz/protocols/euler>
- 내부 상태 기준: `docs/current-status.md`, `AGENTS.md`, `docs/research/bob-ecosystem.md`
