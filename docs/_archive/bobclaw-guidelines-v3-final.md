# BobClaw 완전 가이드라인 v3 (Final)

**프로젝트**: BOB Gateway 기반 Native BTC 입금 멀티체인 DeFi 자동화 에이전트
**대상 AI 코딩 도구**: Codex / GitHub Copilot / Claude Code
**작성 기준일**: 2026-04-17
**초기 자본 규모**: $500–$5,000 (소액 테스트 단계)

---

## Part 0: 이 문서를 읽는 AI/개발자에게 (필수 선독)

### 0.1 BobClaw의 본질 — 한 문장 정의

**"사용자가 항상 native BTC로 입금하면, BOB Gateway를 통해 destination chain의 DeFi 프로토콜에서 BTC를 운용하여 수익을 얻고, 수익의 일부는 다시 native BTC로 사용자에게 누적·환원하는 자동화 에이전트."**

핵심 구조:
- **Inflow**: 사용자의 native BTC (Bitcoin L1) → Gateway onramp
- **Operation**: destination chain (Ethereum/Base/Arbitrum/BSC/BOB L2)의 DeFi 프로토콜에서 BTC 담보·BTC LST·스테이블코인 전략 실행
- **Outflow (페이백)**: 수익의 일부 → Gateway offramp → native BTC로 사용자에게 누적

이는 "사용자가 USDC/스테이블로 입금하는 일반 yield aggregator"와 다르고, "native BTC로 BTC denominated 회계를 유지하는 페이백 모델"이다.

### 0.2 이 문서의 성격
이 문서는 **가이드라인(제약)**이지 **spec(완전한 설계)**이 아니다. 여기 명시되지 않은 세부 구현은 자유롭게 선택하되, 명시된 제약과 원칙은 반드시 지킨다.

### 0.3 AI 코딩 도구가 반드시 지켜야 할 8가지

1. **BTC denominated 회계 원칙**: 모든 PnL·수익률·축적 비율은 **BTC 단위로 우선** 계산하고, USD는 보조 표시. 25% 누적이 USD 기준이면 BTC 가격 상승 시 누적 BTC 수량이 줄어 페이백 모델이 무너진다.
2. **BOB 생태계의 세 레이어 절대 혼동 금지**: BOB Hybrid Chain(L2) ≠ BOB Gateway(intent 라우터) ≠ BOB Token(거버넌스). Part 1 참조.
3. **"BOB L2 TVL이 작다 = BOB는 죽었다"는 오판 금지**: BOB Gateway는 11+ 체인에서 동작하는 **라우팅 레이어**로 대부분의 경제 활동은 destination chain(Ethereum, Base, Arbitrum 등)에서 발생. BOB L2 DeFi TVL만 보고 Gateway 유용성 판단하면 **잘못된 결론**으로 이어진다.
4. **하드코딩 금지 항목**: 특정 APY 수치, 특정 TVL 임계치($100M 등), 특정 가스 가격(gwei 등), 특정 프로토콜 이름 우선순위. 모두 **설정 파일(YAML)로 외부화**.
5. **결정론 원칙**: 트랜잭션 금액/실행 여부/타이밍은 **반드시 결정론적 룰**로만 결정. LLM/AI가 직접 결정하거나 서명하면 안 된다.
6. **과적합 방지**: 단일 기간·단일 데이터포인트 기반 최적화 금지. Part 12 체크리스트 통과해야 프로덕션 배포.
7. **변경 가능성 가정**: 외부 수치(APY, TVL, 가스비)는 **항상 변한다**. 모든 임계치는 설정화 + 월 1회 재검증 의무.
8. **"BobClaw의 판단"과 "근거" 분리**: 코드가 내리는 결정에는 항상 **트리거된 룰 ID + 인풋 팩트 + 적용된 임계치**를 로그. 사후 감사 가능해야 함.

### 0.4 문서 업데이트 규칙
- Part 1의 숫자(BOB TVL, 감사 현황, 로드맵)는 **월 1회 재확인** 필수. 출처 URL 명시되어 있음.
- Part 3, 5, 6의 수학 공식과 원칙은 변하지 않음(안전함).
- Part 2의 자산 배분 상한선은 **초기 자본 규모에 따라 조정** 필요(Part 2.4 참조).

---

## Part 1: BOB 생태계 — 정확한 사실 기반 (가장 중요)

### 1.1 BOB는 세 개의 독립 레이어다

많은 AI가 이 셋을 혼동해서 잘못된 전략을 내놓는다. 반드시 구분하라.

| 레이어 | 정체 | 역할 | Chain ID |
|---|---|---|---|
| **BOB Hybrid Chain** | OP Stack L2 + Kailua ZK fault proofs + Superchain 멤버 | EVM 실행 환경, **일부** 집행 장소 | **60808** |
| **BOB Gateway** | Intent + SPV 기반 크로스체인 원자 스왑 **프로토콜** | Bitcoin↔EVM 라우팅, 15K dapps/11체인 연결 | (체인 아님) |
| **BOB Token** (ERC-20) | 거버넌스·스테이킹 토큰 | Hybrid node 담보, Gateway solver 담보, DAO 투표 | BOB Chain에서 발행, 멀티체인 OFT |

### 1.2 BOB Gateway 작동 원리 (5단계)

1. LP가 BOB 체인 escrow에 wrapped BTC 예치 (지연기간 잠금)
2. 사용자가 off-chain relayer에 quote/reserve 요청
3. 사용자가 LP의 BTC 주소로 송금, Bitcoin 트랜잭션 **OP_RETURN**에 주문 해시(EVM 주소 + intent) 포함
4. Relayer가 on-chain Bitcoin Light Client(`LightRelay`)에 **SPV Merkle proof** 제출
5. BOB 컨트랙트가 OP_RETURN 해시 일치 검증 → LP wrapped BTC 언락 + **destination intent 실행**

**Custom DeFi Actions (2025-12-04 라이브)**: LayerZero Composer 컨트랙트를 통해 "Bitcoin → BOB → destination chain"의 마지막 단계에서 **임의의 EVM 호출** 실행 가능. 예:
- 네이티브 BTC 한 번의 Bitcoin 트랜잭션으로 **Aave on Base**에 예치
- 네이티브 BTC → **SolvBTC.BNB Pendle market on BSC** 진입
- 네이티브 BTC → Morpho vault on Ethereum → 루핑 포지션 구성 (이론적)

출처: `gobob.xyz/blog/custom-defi-actions-now-integrated-in-bob-gateway-sdk`

**Offramp (수익 → native BTC)**: `OfframpRegistry` 컨트랙트에 wrapped BTC 락업 → solver가 사용자 BTC 주소로 송금. SDK: `bumpFeeForOfframpOrder()` (RBF), `unlockOfframpOrder()` (취소). 완료 5–10분(Bitcoin 블록타임).

**감사**: Pashov, Common Prefix 완료.

### 1.3 Gateway Round-trip 비용 (BobClaw 페이백 모델 핵심)

페이백 모델에서 round-trip 비용은 **수익에서 직접 차감**되므로 사전 계산 필수.

| 단계 | 비용 항목 | 추정 비용 (2026-04, $1K BTC 기준) |
|---|---|---|
| Onramp: Bitcoin tx 송금 | Bitcoin 가스 (~10–30 sat/vB) | $0.5–3 |
| Onramp: Gateway relayer fee | LP 마진 + relayer | 0.05–0.3% (~$0.5–3) |
| Onramp: destination 가스 | Custom Action gas (LayerZero Composer) | $0.10–2 (chain 별) |
| **Onramp 합계** | | **~$1.1–8** (0.1–0.8%) |
| Offramp: destination → BOB 가스 | LZ Composer 또는 직접 | $0.1–2 |
| Offramp: Gateway escrow + solver | Solver fee | 0.05–0.3% |
| Offramp: Bitcoin tx fee | Bitcoin 가스 | $0.5–3 |
| **Offramp 합계** | | **~$1.1–8** (0.1–0.8%) |
| **Round-trip 총** | | **~$2.2–16 (0.2–1.6%)** |

**시사점**:
- $500 입금 시 round-trip 1.6% = $8 → 첫 1년 net profit 기준 의미 있는 비용
- **소액 잦은 입출금 = 비용 폭증**. 입금은 **묶어서 한 번에**, 페이백은 **누적 후 주간 1회 batch** 처리
- 실제 비용은 `dune.com/bob_collective/gateway`에서 측정한 fees 데이터로 캘리브레이션 (월 1회)

### 1.4 지원 체인 (2026-04 기준, 11+)
Ethereum mainnet, **BOB L2 (60808)**, Base, Arbitrum, Optimism, BNB Chain, Avalanche, Unichain, Polygon 외. LayerZero OFT 표준 + Composer 컨트랙트, 보조 Chainlink CCIP / Hyperlane / deBridge.

**BobClaw 기본 집행 체인 우선순위 (유동성·감사·가스 기준)**:
1. Ethereum mainnet (대규모 포지션, 블루칩 프로토콜 전용)
2. Base (Morpho·Aerodrome 풍부, $5K 미만 default)
3. Arbitrum (Pendle·GMX·Gains)
4. BNB Chain (Pendle SolvBTC.BNB 시장)
5. BOB L2 (Euler v2·Veda·Velodrome 전용 포지션, 인센티브 farming)

### 1.5 BOB 생태계 규모 — 세 개의 다른 메트릭 (치명적 혼동 지점)

**이 섹션은 BobClaw를 "BOB L2가 작으니 전략이 무의미하다"는 오판에서 구하는 핵심 내용이다.**

| 메트릭 | 값 (2026-03~04) | 측정 대상 | 의미 |
|---|---|---|---|
| **BOB L2 DeFi TVL** (DeFiLlama) | **$10.17M** | BOB L2 **위에서** 동작하는 dApp에 락업된 자산 | BOB L2를 **집행 장소로** 사용하는 규모. 작다 = BOB L2 내부 전략 규모 제한 |
| **BOB L2 Bridged TVL** (L2Beat TVS) | **$66.16M** | BOB L2로 브리지된 총 자산 | BOB L2에 **존재하는** 자산 총량. Gateway onramp 규모 추정 |
| **BOB 생태계 전체 BTC value** | **~$152M peak (2025), ~$183M reported (2025-12)** | Gateway를 통해 **다른 체인에 배포된** BTC 담보 포함 | Gateway의 **실질 유용성**. 대부분이 BOB L2 **바깥**(Ethereum, Base 등)에서 동작 |

**핵심 해석**:
- BOB L2 DeFi TVL $10M은 "BOB L2에서만 실행되는 DeFi dApp이 아직 작다"는 뜻이지, "BOB Gateway가 작다"는 뜻이 **아님**.
- BOB Gateway의 본질은 **Bitcoin → 임의 EVM 체인**으로의 라우팅 엔진. 따라서 BobClaw의 95%+ 가치는 destination chain(Ethereum/Base/Arbitrum)에서 발생하고, BOB L2 상 TVL은 이를 측정하지 않는다.
- **BOB L2 TVL만 보고 BobClaw 전략을 설계하면 "집행 체인 노출"을 잘못 평가하게 된다**. 실제 노출은 destination chain 기준으로 계산해야 한다.

**참고**: The Block 2026 Outlook은 Bitcoin L2 TVL이 2025년 **-74% 감소**, BTCFi TVL **-10%** (101,721→91,332 BTC, 총 BTC의 0.46%)라고 보고. 전 섹터 축소기이므로 BOB L2 수치는 **섹터 평균과 함께 해석**해야 한다.

**출처**:
- DeFiLlama: `defillama.com/chain/BOB`
- L2Beat TVS: `l2beat.com/scaling/projects/bob/tvs-breakdown`
- Altcoin Buzz (2026-01): BOB 2025년 피크 $152M
- The Block 2026 Outlook: `theblock.co/post/383329/2026-layer-2-outlook`

### 1.6 지원 자산 및 BTC 파생 토큰

| 자산 | 타입 | Yield 출처 | Gateway 지원 | 주의사항 |
|---|---|---|---|---|
| **WBTC / tBTC / FBTC / cbBTC** | Wrapped BTC | 없음 (래퍼) | ✅ 기본 라우팅 | |
| **SolvBTC** | Solv 범용 reserve | 없음 | ✅ onramp target | 2025-10 기준 24,226+ BTC ($1.7B 이상) |
| **xSolvBTC** (구 SolvBTC.BBN) | Babylon LST | Babylon PoS + delta-neutral + AI vault | ✅ | xSolvBTC 자체 해킹 이력은 없음. Solv 생태계 BRO 볼트 별건 사고 (1.7) |
| **LBTC** (Lombard) | Consortium + Babylon LST | Babylon ~1% + 인센티브 | ✅ / BOB Earn | Chainlink PoR, 컨소시엄: OKX/Galaxy/DCG/Wintermute |
| **uniBTC** (Bedrock) | LST/LRT 라우터 | Babylon + Pell + Kernel | ✅ | 2024-09 $2M 이력 |
| **eBTC** (ether.fi) | BTC LRT | Karak/Symbiotic + Lombard points | ✅ | |
| **Pell BTC** | Bitcoin re-staking AVS | 재스테이킹 + PELL | ✅ Gateway direct staking | 토큰 인센티브 위주, APY 변동성 큼 |
| **satUSD** | River BTC 담보 스테이블 | Protocol yield | BOB 네이티브 | BOB L2 스테이블 mcap 98.68% 점유 (집중도 위험) |

### 1.7 Solv Protocol 사건 (정확한 사실 — v2에서 정정)

**날짜**: 2026-03-03 (Verichains/Halborn 분석)
**대상**: Solv Protocol의 **BRO (BitcoinReserveOffering) 볼트**
**손실**: **38.0474 SolvBTC ≈ $2.7M**
**기술**: BRO 컨트랙트의 **double-mint 취약점** (Verichains는 re-entrancy가 **아닌** 내부 로직 결함이라고 결론, 일부 외부 분석가는 reentrancy로 오기). 22회 반복 호출로 135 BRO → 567M BRO 인플레이션 → 38 SolvBTC 스왑 → Uniswap에서 1,211 WETH로 전환
**영향 범위**: 10명 미만 사용자, 다른 볼트·SolvBTC 본체 자산 영향 없음
**대응**: Solv가 손실 전액 보상, 10% 화이트햇 바운티 제안, Hypernative Labs/SlowMist/CertiK 협력

**BobClaw 시사점**:
- **BRO 볼트는 사용 회피**. SolvBTC 본체와 xSolvBTC는 별개로 지속 사용 가능
- "큰 reserve 토큰의 위성 상품에서 사고가 난다"는 패턴 — BTCfi 위성 상품 노출 시 본체 vs 위성 구분 필수
- Solv가 **24,226+ BTC ($1.7B 이상) 보유 중**, 사고 후에도 SOLV 토큰 +2% 유지 = 본체 신뢰도 영향 제한적

출처: `halborn.com/blog/post/explained-the-solv-hack-march-2026`, `blog.verichains.io/p/solv-protocol-hack-analysis`, `theblock.co/post/392492/`

### 1.8 BOB L2에 배포된 프로토콜 (확인된 것만)

| 프로토콜 | 상태 | 용도 |
|---|---|---|
| **Euler v2** | ✅ 라이브 (2025, HybridBTC.pendle 런칭과 함께) | BTC LST 담보로 루핑 포지션 |
| **Velodrome Superchain** | ✅ 라이브 (2024-04, ve(3,3)) | 네이티브 DEX, BTC 페어 유동성 공급 |
| **Uniswap v3** | ✅ 배포됨 | 기본 스왑, CL 포지션 |
| **Hourglass** | ✅ 라이브 | 레버리지 에어드롭 farming |
| **Veda HybridBTC.pendle** | ✅ 라이브 (2025-02) | Bitcoin yield 토큰화, Veda $3B+ TVL |
| **Aave v3** | ⚠️ ARFC 2025-01-07 제안, 2025-06 자산 TEMP CHECK (SolvBTC/xSolvBTC/oUSDT), **2026-04 실제 라이브 여부 미확인** | (라이브 시) 메인 루핑 담보 장소 |
| **Morpho** | ❌ BOB L2 배포 미확인 | destination chain(Ethereum/Base) 사용 |
| **Pendle (on BOB)** | ❌ BOB L2 배포 미확인 | destination chain(Ethereum/Arbitrum/BSC) 사용 |

**해석**: BOB L2 자체는 Euler v2 + Velodrome + Veda 조합 중심의 "BTC LST 집중 L2". Aave/Morpho/Pendle 같은 주요 루핑 인프라는 **Ethereum/Base/Arbitrum**에서 실행하고, BOB Gateway Custom Actions로 원자적 진입.

### 1.9 BOB 공식 리소스

- Docs: `docs.gobob.xyz` / Gateway: `/docs/gateway/`
- GitHub: `github.com/bob-collective/bob` (v4.4.6 릴리스 2025-11-27)
- NPM: `@gobob/bob-sdk` (TypeScript)
- Dune: `dune.com/bob_collective/gateway` (Gateway 누적 볼륨/트랜잭션·수수료)
- RPC: `https://rpc.gobob.xyz/` / Explorer: `https://explorer.gobob.xyz/`
- L2Beat: `l2beat.com/scaling/projects/bob`
- Messari: `messari.io/project/build-on-bitcoin`

### 1.10 BOB Gateway SDK 최소 예시

```typescript
import { GatewaySDK, parseBtc, LayerZeroGatewayClient } from '@gobob/bob-sdk';
import { bob } from 'viem/chains';
import { parseEther } from 'viem';

const sdk = new GatewaySDK(bob.id);

// 예 1: Bitcoin → BOB L2 (BOB L2 네이티브 포지션)
const quote1 = await sdk.getQuote({
  fromChain: 'bitcoin', fromToken: 'BTC',
  toChain: 'bob', toToken: 'wBTC',
  fromUserAddress: 'bc1q...', toUserAddress: '0x...',
  amount: parseBtc("0.1"),
  gasRefill: parseEther("0.00001"),
  affiliateFeeSats: 500n,
});

// 예 2: Bitcoin → Base (Custom DeFi Action, 예: Aave 예치)
// destinationChain='base', customCall=aaveSupply(...)
// 실제 구현은 SDK docs의 destinationAction 파라미터 참조

// 예 3: 페이백 (수익을 native BTC로 사용자에게 환원)
// destination chain → BOB L2 → Bitcoin L1
const offrampOrder = await sdk.createOfframpOrder({
  amount: profitInBtc,
  toBtcAddress: userBtcAddress,
});
```

### 1.11 BOB 로드맵 (확인된 마일스톤)

| 날짜 | 내용 | 상태 |
|---|---|---|
| 2024-05 | Phase 1 메인넷 런칭 (OP Stack ETH L2), Fusion Season 1 $300M TVL | ✅ 완료 |
| 2025-07-02 | BitVM 브리지 testnet | ✅ 완료 |
| 2025-08-07 | $9.5M 전략 투자 (누적 $21.1M, Castle Island Ventures 리드) | ✅ 완료 |
| 2025-09-30 | BOB Gateway + LayerZero wBTC.OFT, 11 체인 | ✅ 라이브 |
| 2025-11-22 | Hybrid Nodes 컨소시엄 (Amber, Anchorage, Babylon, Lombard, P2P, RockawayX, Solv, Wintermute) | ✅ 라이브 |
| 2025-12-04 | **Custom DeFi Actions** 라이브 | ✅ 라이브 |
| 2025-12-05 | BitVM3 "cut and choose" 온체인 비용 87% 감소 (~$10.91) | ✅ 완료 |
| 2025-12-18 | Native Bitcoin Vaults Stack 오픈소스 | ✅ 완료 |
| **2026 초** | **BitVM 구현 메인넷** (bitvm/acc 파트너와 테스트 중) | ⏳ 예정 |
| 2026 중 | BitVM 기반 Native Bitcoin Vaults 강제성 | ⏳ 예정 |

### 1.12 BOB Gateway "Training Wheels" 리스크 (2026-04 기준)

- 현재 relayer가 SPV proof 제출 담당 → **중앙화 신뢰 요소 잔존**
- BitVM 메인넷 배포 전까지 "BTC on BOB = 네이티브 BTC" 약속은 **암묵적 트러스트 필요**
- BobClaw는 BitVM 라이브 전까지 **BOB L2 직접 노출(네이티브 BOB 자산 보유)을 총 운용 자산의 10% 이내**로 제한 권장 (단, **사용자 입금 BTC가 Gateway를 통해 수initial onramp 되는 것은 별개**, 이는 즉시 destination chain으로 라우팅됨)

---

## Part 2: BobClaw 자금 흐름 + 전략 아키텍처 원칙

### 2.1 자금 흐름 다이어그램 (정확한 양방향)

```
┌─────────────────────────────────────────────────────────────────┐
│                   사용자 (Bitcoin L1, native BTC)              │
└──────────┬──────────────────────────────────────▲───────────────┘
           │                                       │
           │ ① Onramp                              │ ⑤ Payback
           │    (사용자 입금)                       │    (수익의 X% native BTC 환원)
           ▼                                       │
┌─────────────────────────────────────────────────────────────────┐
│  BOB Gateway (intent + SPV + LayerZero Composer)               │
│  [라우팅 레이어 — 통과 only, 자금 거치 ✗]                       │
└──────────┬──────────────────────────────────────▲───────────────┘
           │                                       │
           │ ② Custom Action 실행                   │ ④ Offramp 트리거
           ▼                                       │
┌─────────────────────────────────────────────────────────────────┐
│  Destination chains (Ethereum / Base / Arbitrum / BSC / BOB L2) │
│  [실제 운용 장소 — Aave/Morpho/Pendle/Euler/Velodrome ...]      │
│                                                                 │
│  ③ DeFi 운용: looping / IL / delta-neutral / LST staking ...   │
│     수익 발생 → harvest → reserve 분리                          │
└─────────────────────────────────────────────────────────────────┘
```

**5단계 흐름**:
1. **Onramp**: 사용자가 native BTC를 BOB Gateway로 송금. OP_RETURN에 destination intent 인코딩.
2. **Custom Action**: Gateway가 SPV proof 검증 후 destination chain에서 첫 포지션 자동 진입 (Aave 예치 등).
3. **운용**: 룰 엔진에 따라 destination chain에서 자동 운용. 수익은 reserve 계정으로 누적.
4. **Offramp 트리거**: 주간 cron 또는 수익 임계 시 페이백 비율만큼 BOB Gateway offramp 시작.
5. **Payback**: Gateway solver가 사용자 BTC 주소로 native BTC 입금. 누적 BTC 수량이 시각화.

### 2.2 Layer별 책임 (정정)

| 레이어 | 자금 거치 | 역할 |
|---|---|---|
| **Layer 1 (Bitcoin L1)** | **사용자 입금 출발점 + 페이백 도착점** | 모든 입금은 native BTC. 수익의 일부 페이백도 native BTC. **BobClaw 자금이 장기 거치되지 않음** (운영 cold reserve 제외). |
| **Layer 2 (BOB Gateway + BOB L2)** | **통과 레이어** | onramp/offramp 라우팅, BOB L2 상 일부 인센티브 farming은 예외 (≤10%) |
| **Layer 3 (Destination chains)** | **주 운용 장소** | 95%+ 자금이 여기서 운용. 체인별·프로토콜별 분산 |

### 2.3 운영 자금 vs 사용자 자금 분리

**MVP (1인 사용자 = 본인 1명)** 가정 시 단순 구조:
- 사용자 = 운영자 = 본인
- BTC 입금 → 운용 → BTC 페이백이 모두 **자기 자신에게**
- 회계는 **단일 계정 BTC denominated PnL**

**미래 확장 (멀티 사용자)** 시 필수:
- ERC-4626 vault 패턴 (사용자별 share 발행)
- 사용자별 cost basis 추적 (입금 시점 BTC 가격, 가스비 분담)
- 페이백 = 사용자별 share에 비례 분배
- **MVP에서는 멀티 사용자 미구현, 단일 계정으로 시작**

### 2.4 자산 배분 기본 원칙 (초기 $500–$5K 테스트)

소액 단계에서는 **가스비 효율**과 **단일 장애 지점 회피**가 지배 변수다.

| 항목 | 기본 상한 | 근거 |
|---|---|---|
| 단일 프로토콜 | **≤ 25%** | Part 4.4 (DeFiLlama 블루칩 기준 일반 관행) |
| 단일 체인 | **≤ 50%** (Ethereum 우위), L2 각 ≤ 20% | Top5 브리지 해킹 사례, 체인 리스크 |
| BOB L2 직접 노출 | **≤ 10%** (BitVM 전) / **≤ 20%** (BitVM 후) | 1.12 training wheels 리스크 |
| 고위험 실험 프로토콜 | **≤ 5–10%** (누적) | Exponential D–F 등급 |
| 가스비 리저브 | **체인별 5x safety multiplier** | Part 7.3 공식 |
| 청산 방어 준비금 | **포지션 청산가스 × P99 × 3회 × 1.5** | Part 7.3 공식 |
| **BTC 직접 보유 비율** | **≥ 누적된 페이백 BTC 전액** | 페이백 모델 핵심 |

**$500 스케일 특이 주의**:
- Ethereum L1 직접 포지션은 **가스비 대비 원금이 비효율**. Base/Arbitrum/BOB L2 우선.
- 단일 swap 슬리피지가 전체 수익의 10%+ 될 수 있음 → **최소 주문 크기 $50** 이하 거래 금지.
- Aave v3 Debt 최소 $4,000 요구 프로토콜은 **소액 단계에서 사용 불가** → Morpho (최소 없음) 또는 Compound v3 사용.
- **Round-trip 비용 최소 0.2–1.6%**이므로 $500 입금 후 즉시 페이백은 손해. **최소 운용 기간 4주 후 페이백 시작** 권장.

### 2.5 BOB L2 고유 전략 vs 크로스체인 전략

| 전략 유형 | 실행 장소 | 언제 선택 |
|---|---|---|
| **네이티브 BOB 전략** | BOB L2 (Euler v2, Veda HybridBTC.pendle, Velodrome) | BOB Rise 인센티브 farming, Veda vault 접근, BOB-exclusive 점프 |
| **크로스체인 라우팅 전략** | Ethereum/Base/Arbitrum/BSC (Aave/Morpho/Pendle/JLP/HLP) | 유동성·감사 성숙도가 중요한 주력 포지션 |
| **혼합 전략** | 둘 다 | BTC 담보는 destination에서 운용 + BOB L2 소규모 인센티브 farming |

---

## Part 3: Looping (랜딩 풍차돌리기) 전략

### 3.1 핵심 수학

| 개념 | 공식 |
|---|---|
| 최대 레버리지 (n→∞) | **L = 1 / (1 − LTV)** |
| n번 루프 누적 노출 | **Σₖ₌₀ⁿ (LTV)ᵏ = (1 − LTVⁿ⁺¹) / (1 − LTV)** |
| Net APY | **(Supply_APY × L) − (Borrow_APY × (L − 1))** |
| Aave Health Factor | **HF = Σ(Cᵢ × LT_i) / TotalDebt**, 청산 HF < 1 |
| Close Factor | HF ∈ [0.95, 1): 최대 50% / HF < 0.95: 최대 100% |

**예시**: ETH LTV=82.5% → L_max=5.71x. 9–12 loop 후 수렴. Supply 3.5% / Borrow 3.0% / L=5x → Net 5.5% APY (수수료·슬리피지 前).

### 3.2 BTC denominated 루핑 PnL 계산 (BobClaw 특화)

일반 루핑 PnL 계산은 USD 단위지만, BobClaw는 **BTC 단위로 변환**해야 페이백 회계가 일치한다.

```
PnL_btc = (Net_APY_usd × Position_size_usd) / BTC_price_t1
        - (Position_size_btc_t0)  # 입금 시점 BTC 수량
```

**BTC 가격 변동에 따른 BTC denominated 수익률**:
- BTC 가격 **상승** 시 USD 수익이 같아도 BTC 수량 수익은 **감소**
- BTC 가격 **하락** 시 USD 수익이 같아도 BTC 수량 수익은 **증가** (단, 입금된 BTC의 USD 가치가 감소했으므로 명목상 손실 가능)

**룰**: 페이백은 항상 **BTC 단위 누적 수익 기준**으로 계산. USD 기준 계산은 보조 지표.

### 3.3 프로토콜 TVL + 특이점 (DeFiLlama 2026-03~04)
- **Aave v3**: $24.8–25.95B, 208 pools, 44개 fork
- **Morpho V1/Blue**: $6.7–7.47B, 721 pools, **V2 전환 진행 중**, curated vault 평균 APY 36.4% (고위험 포함; USDC supply 4–8% 기저)
- **SparkLend**: $1.86–2.07B (Spark 전체 $5.85B)
- **Compound V3**: $1.24–1.39B, isolated base asset
- **Euler V2**: $480–526M, 156 pool, **EVK 모듈형**, BOB L2에 배포됨
- **Gearbox V3**: $48M, Credit Account 최대 10x
- **Fluid (Instadapp)**: $810M
- **Contango V2**: 소규모, flash-loan 기반 1-tx 루핑 UI, 8+ money markets

**주의**: 위 수치는 2026-03~04 스냅샷. 프로토콜 TVL은 **주간 ±20% 변동** 가능. Part 12 재검증 규칙 적용.

### 3.4 BTC Looping 실측 경로 (2025–2026)
- **LBTC/wBTC** on Morpho Blue: Lombard LUX + Babylon yield
- **eBTC** (ether.fi) on Zerolend/Morpho: ether.fi + EigenLayer points
- **PT-LBTC** Pendle 26-Dec-2024: 2025-03 PT **6.98% fixed APY**
- **PT-eBTC**: **4.73% fixed** (58d 만기)
- **SolvBTC.BBN** on Pendle Corn pool: Babylon + Solv points
- BTC LST 시장점유 (2024 Q4, Nansen): **LBTC 37%, solvBTC 26%, pumpBTC 9.5%**, 79.6%가 Ethereum mainnet

### 3.5 Health Factor 권장치 (근거)
- HF=2.0 → 담보 50% 하락까지 생존
- HF=1.5 → 33% 하락까지 생존
- **Correlated pair**(stETH/ETH, LBTC/WBTC): HF 1.1–1.3 허용
- **Non-correlated**(USDC/ETH): HF ≥1.5 필수

### 3.6 자동 리밸런싱 트리거 (DeFi Saver 관행)
- Ratio < "repay if below" → Auto-Repay (담보 일부 swap → debt 상환)
- Ratio > 상한 → Auto-Boost
- 1분 간격 oracle polling, fee 0.3% of repay/boost + gas(≤800 gwei cap)
- DeFi Saver **최소 debt $4,000** → 소액 단계에서는 **자체 구현** 또는 Summer.fi 대안

### 3.7 위험 사례 (반드시 학습)
| 사건 | 교훈 |
|---|---|
| 2022-06 stETH depeg (3AC/Celsius) | Correlated pair도 depeg 시 대규모 루핑 unwind 불가 → HF 버퍼 필수 |
| 2023-03-11 USDC depeg (SVB) | Aave v2/v3 **3,400건 자동 청산, $24M 담보**. Stable 담보도 depeg 가정해야 함 |
| 2023-03-13 Euler $197M exploit | 23일 후 전액 회수되긴 했으나, 프로토콜 신생도 = 코드 리스크 |
| 2026-03-03 Solv BRO 볼트 $2.7M | Reserve 토큰 본체와 위성 상품 구분 필수 |
| 2026-03-12 Aave CAPO $862K | 오라클 오설정 손실. 프로토콜 버그 아니더라도 주변 리스크 존재 |

### 3.8 오픈소스 참조
- **Contango V2** (`docs.contango.xyz`): 0.05%/0.25% fee, 1-tx 루핑
- **DeFi Saver** (ConsenSys/Dedaub 감사): Aave V4 day-1 지원
- **Instadapp DSA** (`github.com/instadapp/dsa-contracts`)
- **Summer.fi**: Maker/Aave/Spark/Morpho
- **Yearn V3** (`github.com/yearn/yearn-vaults-v3`): Morpho 기반 전략 다수

---

## Part 4: 멀티체인 분산 — 프로토콜 리스크

### 4.1 주요 해킹 이력 (rekt.news 2026-04)
- Ronin $624M (2022-03), Poly $611M (2021-08), Euler $197M (2023-03, 전액 회수), Curve Vyper $69.3M (2023-07)
- **2024–2025 Top 5**: ByBit $1.436B (2025-02, DPRK), DMM Bitcoin $304M (2024-05), Drift $285M (2025-04, DPRK 소셜엔지니어링), WazirX $235M (2024-07), Cetus $223M (2025-05)
- **2026 Q1**: 31건 / **$112.5M** (Solv BRO $2.7M, 1월 $86M 다수, 2월 보조)
- Halborn 2025 리포트: **80.5%가 off-chain, 55.6%가 compromised accounts**

### 4.2 블루칩 기준 (DeFiLlama 2026-03~04)
| 프로토콜 | TVL | 감사 | 해킹 이력 |
|---|---|---|---|
| Aave v3 | ~$24.8–26B | OpenZeppelin, Trail of Bits, Certora, SigmaPrime | CAPO $862K (2026-03, 전액 회수) |
| Compound v3 | $1.24–1.39B | OZ, ChainSecurity | v2 COMP $147M (2021) |
| Uniswap v3/v4 | $3.3B / $654M | Trail of Bits, ABDK, ConsenSys | 프로토콜 해킹 無 |
| Curve | 수십억$ | Trail of Bits, MixBytes, ChainSecurity | Vyper $69.3M, 2026-03 sDOLA LlamaLend $240K |
| Sky/Maker | Spark $1.86–2.07B | Runtime Verification, PeckShield | 2020 Black Thursday |
| Lido | ~$10–36B | Sigma Prime, MixBytes, StateMind | 해킹 無 |

### 4.3 고위험 섹터 특이점
- **Pendle**: 2025-08 피크 $13.1B → 2026 초 $1.96B. **75% TVL이 Ethena 파생** (컴포저빌리티 집중)
- **Ethena**: sUSDe APY 3.72–4.25% (2026-04), 2025-10 피크 $14.8B → $5.88B(-60%)
- **Morpho Curated**: 2026 Q1 Resolv 사건으로 Morpho $10B→$7B, Steakhouse=zero, Gauntlet USDC 수백만$ 손실
- **재스테이킹**: EigenLayer $15.26–18B (93.9%), Symbiotic $897M–1.7B, Karak $102–260M

### 4.4 분산 가이드라인 (업계 합의)
- 단일 프로토콜 최대 **20–25%** (A급), 신생/B–C급 ≤10%, 미감사/F급 ≤2–5%
- 단일 체인 최대 **40–50%** (Ethereum 우위), L2/대체체인 각 ≤15–20%
- 브리지 TVL **별도 위험 버킷** (Top5 hacks 중 4건이 브리지)

**카테고리 배분 예시 (적극적)**: 블루칩 Lending 30% / LST 25% / DEX LP 15% / Stable 15% / Curated Vault 10% / 고위험 5%

### 4.5 리스크 점수화
- **DeFiSafety PQR**: 6축 평가(컨트랙트/문서/테스트/감사/어드민/오라클), **80%+ PQR의 97%가 사고 無**(2020 이후). `defisafety.com`
- **Exponential.fi**: A–F 단일 등급 (2024 개편). `exponential.fi/learn/risk-rating`
- **Gauntlet**: Morpho 최대 큐레이터 (30+ vaults)
- **Chaos Labs Edge**: Aave 실시간 파라미터 자동 조정, **$60B+ secured volume**

### 4.6 컴포저빌리티 = 숨은 집중도
**Ethena-Pendle-Aave 루프는 세 프로토콜이지만 사실상 하나의 포지션**이다. 2026 Pendle TVL 85% 하락 시 동시 충격. **의존 그래프 기준으로 실질 노출 재집계** 필수.

---

## Part 5: Impermanent Loss + CL 관리

### 5.1 IL 공식
- **CPMM**: `IL(k) = 2√k/(1+k) - 1` (대칭)
- 2x: **-5.72%**, 3x: -13.40%, 4x: **-20.00%**, 5x: -25.46%, 10x: -42.54%
- 손익분기 필요 fee yield: f* = IL / (1 − IL)
- **Uniswap v3 CL**: IL **v2 대비 ~4배 확대** (Peteris Erins 분석)
- **Topaze Blue arXiv 2111.09192**: 17개 v3 풀에서 총 fee $199.3M vs 누적 IL $260.1M, **LP 49.5%가 HODL 대비 음수**

### 5.2 Uniswap v3 CL 수학
```
L = √(x·y),  x_virtual = L/√P,  y_virtual = L·√P
Δy = L · Δ(√P),  Δx = L · Δ(1/√P)
Fee APR = (DailyVol × fee_tier × 365) / TVL_in_range × 포지션점유율
```
Fee tiers(tickSpacing): 0.01%(1), 0.05%(10), 0.30%(60), 1.00%(200)

### 5.3 ALM 비교 (DeFiLlama 2026-04)
| ALM | TVL | 트리거 | 특수 기능 |
|---|---|---|---|
| **Arrakis Modular/Pro** | $73–88M | vol MA + oracle, ≥24h | 다중 포지션, Private vault |
| **Gamma** | $11–13M | 가격 이탈 % | Dynamic/Stable/Pegged/Manual |
| **ICHI Yield IQ** | $34–37M | Inventory + TWAP 5m/60m | **Single-sided deposit** |
| **Maverick** | — | 3h TWAP, bin edge 통과 | Directional, **linear IL** |
| **Steer** | $32–42M | 프로그래머블 | 40+ chains, 백테스트 엔진 |
| **Bunni V2** | $29–50M | 매 거래 후 LDF 재계산 | Uniswap v4 hook, **2025-08 해킹 $8.4M** |
| **Kamino** (SOL) | $593M+ | 가격 기반 | kToken 담보화, leveraged LP |

### 5.4 BTC LP 전략 (BobClaw 우선)
- **cbBTC/WBTC, tBTC/WBTC** peg 페어: ±0.5% 이내 drift → IL <0.1%
- **0.01% fee tier, ±1% 범위** 권장
- **WBTC/WETH 0.05%**: Uniswap v3 전체 fee 점유 **2위**
- **BOB L2 Uniswap v3**: cbBTC/WBTC 같은 BTC-BTC peg 페어로 IL 최소화 가능

### 5.5 IL 헷지 (고급)
- **Squeeth (Opyn)**: ETH² power perp로 LP gamma 헷지
- **Panoptic**: LP 차입/쇼트 = long put → Impermanent Gain
- **CEX 선물 델타중립**: 선형 헷지, gamma 대응 부족

---

## Part 6: 페이백 — 수익의 native BTC 자동 환원 (★ 핵심)

### 6.1 페이백 모델 정의

**BobClaw 페이백**: 사용자가 입금한 native BTC가 destination chain에서 운용되어 발생한 수익의 일정 비율을 주기적으로 native BTC로 변환하여 사용자 Bitcoin L1 주소로 환원.

**PNL 회계 원칙**:
- 모든 수익률은 **BTC 단위 우선** 표시
- USD 단위 수익률은 보조 지표
- 사용자에게 보고: "지난 30일 수익 = 0.0023 BTC ($245 at 시점)"

### 6.2 페이백 비율 권장치

**기본값: 운용 수익의 20–25%를 주간 단위로 native BTC 환원**

| 프로파일 | 페이백 비율 | 수학적 근거 |
|---|---|---|
| Conservative | **15%** | Quarter-Kelly, Tether 분기 15% 정책 |
| **Moderate (기본)** | **20–25%** | **Half-Kelly 근사, ARK 2023 최적배분 19.4%, Vanguard DCA 연구** |
| Aggressive | **40–50%** | Full-Kelly 근사, MicroStrategy/Metaplanet 근접 |

**나머지 75–80%**는 destination chain에서 **재투자 (compound)** 되어 운용 자본이 점진 증가.

### 6.3 Kelly Criterion 근거
- 공식: `f* = (μ − r) / σ²` (로그정규 자산)
- BTC 4.5–10년 월간 데이터 (Perrenod, `stephenperrenod.substack.com`): **Full Kelly 32.8–36%**
- Half Kelly는 기대성장의 75% 유지 + 변동성 50% 감소 (Thorp, MacLean-Thorp-Ziemba 2010)
- **Half Kelly ≈ 16.5%, Quarter Kelly ≈ 8%**

### 6.4 DCA 연구 근거
- **Vanguard 2012**: LSI가 DCA를 67% 빈도로 이김, 초과수익 2–3% (1926–2011 미/영/호)
- **Amdax (Tim Stolte)**: LSI 연수익 3배 but drawdown +20% 더 큼. **Calmar 비율 기준 주간 DCA가 가장 위험조정 효율적**
- $100/월 BTC DCA 2014–2025: 총투입 $35,700 → $589,000, ROI 1,648%

### 6.5 기업/펀드 정책 사례
- **Strategy (MicroStrategy)**: 638,985 BTC (공급의 3.05%), 잉여현금흐름+자본조달의 ~100%
- **Metaplanet**: 30,823 BTC, 옵션 프리미엄 수익의 95%
- **Tether**: **분기 순이익의 15%를 BTC로 (공식 정책 2023)**
- **ARK Invest Big Ideas 2024**: 2023 최적 BTC 배분 **19.4%** (2015: 0.5% → 2023: 19.4%)
- **Fidelity Digital Assets**: BTC 5년 Sharpe 0.96 vs S&P500 0.65, **Sortino 1.86**

### 6.6 페이백 공식 (BobClaw 자동 엔진)

```python
def calculate_payback_btc(harvest_period: timedelta) -> Decimal:
    # 1. BTC 단위 수익 계산
    profit_btc = sum_position_pnl_in_btc(period=harvest_period)
    if profit_btc <= MIN_PAYBACK_THRESHOLD_BTC:  # 가스비 대비 의미 있는 최소량
        return 0
    
    # 2. 동적 페이백 비율
    base_rate = config['payback']['base_ratio']  # 0.20 default
    regime_mult = market_regime_multiplier()      # bear:1.2, neutral:1.0, bull_peak:0.7
    vol_mult = min(1.0, 0.5 / realized_vol_60d())
    
    # 3. Round-trip 비용 차감 (Part 1.3)
    expected_offramp_cost_btc = estimate_gateway_cost(profit_btc * base_rate * regime_mult * vol_mult)
    if expected_offramp_cost_btc > profit_btc * 0.10:  # 비용이 페이백의 10% 초과 시
        defer_until_next_period()  # 누적 후 다음 주에 batch
        return 0
    
    return profit_btc * base_rate * regime_mult * vol_mult - expected_offramp_cost_btc
```

**트리거 규칙**:
1. 주간 harvest cron → 위 공식 계산 → BOB Gateway offramp via OfframpRegistry
2. **Mayer Multiple > 2.4** (BTC > 200d MA × 2.4) → 페이백 비율 50%로 축소 (가격 비싸므로 BTC 더 많이 누적)
3. **Bear market (BTC −50% from ATH)** → 페이백 비율 120% 상향 (싸게 BTC 누적)
4. 30일 실현 변동성 >100% → 페이백 50% 감소 (불안정 시 누적 보수)
5. **비상 페이백 중단**: 프로토콜 exploit, Gateway 슬리피지 >2%, 운용 자본 drawdown >30%

### 6.7 핵심 KPI (페이백 모델 전용)

BobClaw가 실제로 잘 동작하는지 평가하는 지표:

| KPI | 정의 | 목표 |
|---|---|---|
| **BTC Yield Ratio (BYR)** | 1년간 누적 페이백 BTC / 입금 BTC | **5–15%** (네이티브 BTC 기준) |
| **Compound Growth (CG)** | 1년간 운용 자본 BTC 증가율 | **10–25%** |
| **Total BTC Return (TBR)** | (페이백 BTC + 운용 자본 BTC) / 입금 BTC - 1 | **15–40%** |
| **Round-trip 효율** | (Gross profit - Gateway 비용) / Gross profit | **>90%** |
| **Days to Breakeven** | round-trip 비용 회수까지 일수 | **<60일** |

이 KPI는 모두 **BTC denominated**. USD denominated KPI는 BTC 가격 변동에 오염되므로 보조용으로만.

### 6.8 페이백 흐름 (구현 단계)

```
[Destination chain (Aave/Morpho/Pendle 운용 중)]
  ↓ Harvest (주간 cron)
[Reserve account on destination chain]
  ↓ Convert to WBTC/cbBTC (CoW Swap or Uniswap v3)
[WBTC/cbBTC on destination chain]
  ↓ LayerZero Composer → BOB L2
[wBTC.OFT on BOB L2]
  ↓ Gateway OfframpRegistry.createOrder()
[Gateway escrow]
  ↓ Solver picks order → Bitcoin L1 tx to user address
[Native BTC on user Bitcoin L1 wallet]
```

소요 시간: 5–15분 (Bitcoin 블록타임 의존)
비용: Part 1.3 round-trip 표 참조

---

## Part 7: 가스비 관리

### 7.1 핵심 EIP
- **EIP-1559**: baseFee(burn) + priorityFee(tip), 블록당 ±12.5%
- **EIP-4844 (Dencun, 2024-03)**: blob 데이터로 **L2 수수료 50–90% 감소**
- **EIP-7702 (Pectra, 2025-05-07)**: EOA → Type 4, 배칭/paymaster/세션키

### 7.2 체인별 실측 tx 비용 (l2fees.info 2026-04)
| 체인 | ETH 송금 | 스왑 |
|---|---|---|
| Ethereum L1 | $1.10 | $5.48 |
| Arbitrum One | $0.09 | $0.27 |
| Optimism | $0.09 | $0.18 |
| Base | $0.002–0.05 | $0.05–0.10 |
| Polygon zkEVM | $0.19 | $2.75 |
| zkSync Era | $0.07 | — |
| Linea | $0.02–0.10 | $0.10–0.30 |
| BOB L2 | sub-cent~수 cent | 수 cent |

### 7.3 공식
```
권장 보관량   = 월 예상 tx 수 × 평균 tx 비용 × safety multiplier
  safety_multiplier: 일반 3x, DeFi 포지션 방어 5x, 청산 보호 10x

긴급가스예비 = liquidation_gas × P99_gas_stress × N_retry × buffer(1.5)
```

**BobClaw $500 스케일 예**: Arbitrum 600 tx/월 × $0.01 × 5 = **$30 ETH 상시 유지**. Ethereum L1은 $100+ 버퍼 필요 → **소액 단계에서 L1 포지션 자제**.

**Bitcoin L1 송금 가스 (페이백 시)**: ~10–30 sat/vB × ~250 vB = $0.5–3. 페이백 BTC 수량이 가스보다 의미 있어야 (최소 0.0005 BTC ≈ $50 권장).

### 7.4 비상 임계치 (L1 base fee)
| base fee | 상태 | 행동 |
|---|---|---|
| <5 gwei | 정상 | 전체 자동화 정상 |
| 5–50 | 주의 | 비긴급 연기, 배치 대기 |
| 50–200 | 경계 | 청산 방어 / HF 유지만 |
| **>500** | 비상 | Flashbots Protect only, maxFeePerGas 캡 |

### 7.5 자동화 도구
- **Gelato Automate / Web3 Functions**: worker 모델, **USDC 결제 가능**, 7+ 메인넷
- **Chainlink Automation**: `gasPrice × (gasUsed + 80,000 overhead) × (1 + premium%)`
- **OpenZeppelin Defender** ⚠️ **2026-07-01 셧다운 확정** → OSS Monitor/Relayer(Docker, AWS/GCP KMS)로 마이그레이션
- **Tenderly Web3 Actions**: 서버리스 트리거/시뮬레이션

### 7.6 MEV + Paymaster
- **Flashbots Protect `/fast`**: TEE BuilderNet (2024-12~), 27M+ tx 보호
- **MEV-Blocker** (CoW): 백런 수익 **90% 사용자 환급**
- **Pimlico ERC-20 paymaster**: Chainlink TWAP, markup 10–20%, USDC 가스
- **Circle Paymaster**: USDC gasless + EIP-7702 EOA (2026-04-08)

### 7.7 가스 리필 브릿지
- **Gas.zip**: 350+ chains (LayerZero)
- **Li.Fi**: 40+ chains 애그리게이터
- **Across**: L2↔L2 3초, L1→L2 18초, tx 평균 $0.04
- **Gateway 자체 `gasRefill` 파라미터**: onramp 시 자동으로 destination chain에 가스 토큰 주입 (Part 1.10 SDK 예시)

---

## Part 8: Rule Engine — 유연한 룰 개발

### 8.1 권장 아키텍처: **YAML + Python Action 훅**

90% 룰은 YAML(리스크 팀 편집, git audit, 핫 리로드), 특이 케이스만 Python 플러그인. RETE는 DeFi 에이전트 fact cardinality 낮아 과잉 설계.

### 8.2 라이브러리 비교
| 라이브러리 | 언어 | 정의 방식 | 핫리로드 |
|---|---|---|---|
| venmo/business-rules | Python | JSON | ★★★★★ |
| santalvarez/python-rule-engine | Python | JSON (json-rules-engine 호환) | ★★★★★ |
| zerosteiner/rule-engine | Python | 문자열 AST | ★★★★ |
| gorules/zen-engine | Rust | JDM 그래프 | ★★★ |

### 8.3 BobClaw YAML DSL (완전 예시)

```yaml
version: "1.0"
meta: { author: "risk-team", updated: "2026-04-17" }

# 글로벌 제약: Part 2에서 외부화된 상한선
guards:
  chain_policy:
    ethereum:  { mode: read_only }    # "이더리움은 관찰만"
    arbitrum:  { mode: read_write, max_exposure_pct: 30 }
    base:      { mode: read_write, max_exposure_pct: 30 }
    bsc:       { mode: read_write, max_exposure_pct: 20 }
    bob:       { mode: read_write, max_exposure_pct: 10 }  # BitVM 전 10% 캡
  
  protocol_whitelist:
    - { name: aave_v3,      min_tvl_usd: 500_000_000, max_allocation_pct: 25 }
    - { name: morpho,       min_tvl_usd: 500_000_000, max_allocation_pct: 20 }
    - { name: compound_v3,  min_tvl_usd: 500_000_000, max_allocation_pct: 20 }
    - { name: euler_v2,     min_tvl_usd: 200_000_000, max_allocation_pct: 10 }  # BOB L2

  # 페이백 모델 가드
  payback_policy:
    accounting_unit: btc                # USD 아님!
    min_payback_btc: 0.0005            # ~$50, 이하면 누적
    max_offramp_cost_pct: 10           # 페이백의 10% 이상 비용이면 연기
    frequency_default: weekly

rules:
  # 최우선: 긴급 디레버리지
  - id: emergency_deleveraging
    priority: 900
    when:
      all: [ { fact: position.health_factor, op: lt, value: 1.5 } ]
    then:
      action: deleverage
      params: { target_hf: 2.0, max_slippage_bps: 50, urgency: immediate }

  # Ethereum 관찰 전용 가드
  - id: eth_readonly_guard
    priority: 1000
    when:
      all:
        - { fact: chain, op: equals, value: ethereum }
        - { fact: intent, op: in, value: [swap, deposit, borrow, liquidate] }
    then: { action: reject, reason: "ethereum is observe-only" }

  # 가격 게이트 (예: "300달러 기준으로만")
  - id: price_gated_entry
    priority: 500
    when:
      all:
        - { fact: intent, op: equals, value: open_position }
        - { fact: asset.price_usd, op: gte, value: 300 }
        - { fact: asset.symbol, op: in, value: [ETH, BTC, SOL] }
    then:
      action: execute_entry
      params: { min_profit_usd: 50, max_gas_gwei: 80 }

  # 페이백 자동 트리거 (Part 6 ★)
  - id: weekly_btc_payback
    priority: 400
    when:
      all:
        - { fact: event, op: equals, value: weekly_harvest }
        - { fact: profit_btc, op: gt, value: 0.0005 }   # 가스 대비 의미 있는 수량
    then:
      action: payback_to_user_btc_wallet
      params:
        base_ratio: 0.25
        market_regime_mult_source: mayer_multiple
        vol_adjust_source: realized_vol_60d
        offramp_route: bob_gateway
        deferred_if_cost_pct_gt: 10

  # Solv BRO 볼트 차단 (Part 1.7 사건 후)
  - id: avoid_solv_bro_vault
    priority: 800
    when:
      all:
        - { fact: protocol_name, op: equals, value: solv_bro }
    then: { action: reject, reason: "BRO vault exploited 2026-03-03; use SolvBTC main only" }

  # 기본 거부 (default deny)
  - id: fallback_deny
    priority: 1
    when: { always: true }
    then: { action: reject, reason: "no matching rule; default deny" }
```

### 8.4 Python 엔진 요구 기능
- **Priority-sorted first-match** (sequential, 결정론적)
- `watchdog` 파일 모니터 + **atomic write + schema validate + 실패시 이전 버전 유지**
- **Dry-run / Shadow 모드 플래그** (프로덕션 전 최소 1주 shadow 필수)
- **A/B Canary** (`hash(wallet) % 100 < 10 ? v2 : v1`)
- Prometheus 지표: `rule_fired_total{version,rule_id}`, `rule_divergence_total`, `payback_btc_total`

### 8.5 실전 참조
- **OpenZeppelin Defender Autotasks** ⚠️ 2026-07-01 셧다운 → Gelato/Chainlink/OSS로 이관
- **Gelato Web3 Functions**: TS + schema.json, `TriggerType.TIME/EVENT/BLOCK`, `canExec/callData`
- **Chainlink Automation**: Time-based / Custom Logic / Log Trigger / StreamsLookup
- **Tenderly Web3 Actions**: `tenderly.yaml` + TS 함수, 30초 제한, 100 exec/5min
- **Hypernative Guardian**: no-code + Python, 70+ 체인, 99.8% 탐지, 2025-11 Safe 네이티브 통합
- **Phylax Credible Layer**: Solidity assertion → 시퀀서가 블록 포함 前 거부

---

## Part 9: DeFi 전략 라이브러리 + BTCfi 통합

### 9.1 델타중립 스테이블 (주의)
| 프로토콜 | 작동 | 최근 APY | TVL (2026-04) | 리스크 |
|---|---|---|---|---|
| Ethena sUSDe | ETH/BTC 롱 + perp 숏 | **3.72–4.25%** | $5.88B (피크 $14.8B, -60%) | 펀딩 역전 시 유보금 소진 |
| Resolv USR/stUSR | ETH+BTC 중립 + RLP | stUSR 7–10%, RLP 20–30% | ~0 | **2026-03-22 $25M exploit** |
| Elixir deUSD | wstETH+sUSDS | wind-down | ~0 | Stream Finance 사태 |

**Pendle Boros**: BTC/ETH 펀딩비 YU 토큰화, 2025-09 거래량 $2.2B(ETH)+$600M(BTC), OI 캡 $28M

### 9.2 Morpho Curated (V2 전환 중)
| 큐레이터 | TVL | 특성 |
|---|---|---|
| Gauntlet | ~$2B | USDC Prime/Core, ~9% |
| Steakhouse | $1.29–1.77B | steakUSDC, 7일 타임락 |
| MEV Capital | $360–915M | 볼라 자산 20–70% |

### 9.3 Real Yield Perp DEX
| 프로토콜 | TVL | APY | 수수료 출처 |
|---|---|---|---|
| **Jupiter JLP** | **$1.62B** | **~12.88%** | Jupiter Perps fee 75% |
| Hyperliquid HLP | ~$373M | 1–14% + HYPE 3x | MM + 청산 |
| GMX v2 | ~$450M | 9–18% | GM pool 변동 |

### 9.4 BTCfi 핵심 (★ BobClaw 직결)
| 프로토콜 | TVL (2026-04) | Yield 출처 | APY | 감사·이력 |
|---|---|---|---|---|
| **Babylon** | **$3.6B** (피크 $7B) | BSN 검증 + BABY | GRR **1–2%** | 감사 완료 |
| **Lombard LBTC** | ~$1.5B, 15+ 체인 | Babylon staking | **~1%** (8% perf fee 후) | Chainlink PoR 2026-02-05 |
| **Solv solvBTC** | ~$1.7B (24,226+ BTC) | 래퍼 (무수익) | 0% | CertiK/SlowMist/Quantstamp. **2026-03-03 BRO 볼트 별건 $2.7M** (본체 영향 없음) |
| **Solv xSolvBTC** | subset | Babylon + basis + Core + AI | **4.2–7.8%** (상한 23%) | (xSolvBTC 자체 사고 없음) |
| **Pell** | 수만 BTC | Restaking AVS/DVS + PELL | 포인트 중심 | Yes |
| **Bedrock uniBTC** | $338.91M | Babylon+Pell+Kernel+SatLayer | 2–5% + 포인트 | Chainlink PoR, 2024-09 $2M 이력 |

**핵심 인사이트**: Babylon이 BTCfi 실수익 원천(1–2%). LBTC/xSolvBTC/brBTC는 모두 Babylon 래퍼. 고APY는 대부분 토큰 인센티브.

### 9.5 Bitcoin L2 비교
| L2 | TVL | 특징 |
|---|---|---|
| Bitlayer | $400M+ | BitVM 사이드체인 |
| Merlin | $1.7B 피크 | ZK Rollup, 중앙화 Cobo 커스터디 |
| CoreDAO | 상위권 | Satoshi Plus |
| B² Network | $369M | ZK Rollup |
| Stacks | ~$208M | Nakamoto sBTC, Clarity |
| **BOB** | $10.17M DeFi TVL / $66M bridged / $152M peak ecosystem | OP Stack + Kailua + BitVM (초기 2026) + **Gateway 11+체인** |

### 9.6 BobClaw 추천 포지션 조합 ($500–$5K 기준, BTC denominated)

**보수 (예상 BYR 5–8%)**
- 40% Morpho Gauntlet USDC Prime (on Base, Custom Action 진입; BTC → USDC swap)
- 30% Pendle PT-sUSDe (on Arbitrum, 고정수익)
- 20% LBTC on Aave/Morpho (destination chain, Babylon 노출, **BTC denomination 유지**)
- 10% native WBTC reserve (긴급 페이백/리밸런싱용)

**균형 (예상 BYR 10–15%)**
- 25% Pendle PT (Arbitrum, USDC↔BTC 복합)
- 20% Morpho USDC vault (Base)
- 20% JLP (Solana, Wormhole 경유 예외 — 또는 회피)
- 15% xSolvBTC/LBTC → Pendle PT 루프 (BTC denomination)
- 10% HLP (Hyperliquid)
- 10% stable reserve

**BOB L2 인센티브 farming (별도 allocation, 전체의 ≤10%)**
- Euler v2 BTC LST 담보 루프 (HybridBTC.pendle)
- Velodrome BTC-BTC 페어 LP
- BOB Rise 캠페인 OP 토큰 수확

**BTC denomination 유지 비율 권장**: 전체 운용 자본의 **최소 40%는 BTC 계열 자산** (WBTC/LBTC/xSolvBTC/PT-LBTC) 으로 유지. USDC/스테이블 노출은 페이백 회계 변동성을 키우므로 제한.

---

## Part 10: 보안·운영 인프라

### 10.1 MEV 보호
| 도구 | 방식 | 리베이트 |
|---|---|---|
| **Flashbots Protect `/fast`** | Private RPC → BuilderNet (TEE) | MEV-Share: 사용자 90%/검증자 10% |
| **MEV Blocker** (CoW) | Private RPC + 백런 경매 | **90% 사용자 환급** |
| **CoW Swap** | 인텐트 배치 경매 | surplus 전액 |

권장: 자동 봇=**Flashbots /fast**, 스왑=**CoW Swap API**, 일반 dApp=**MEV Blocker**

### 10.2 Kill Switch + 이상거래 탐지
- **OpenZeppelin Pausable** (`PAUSER_ROLE` 멀티시그)
- **Hypernative**: 75+ 체인, 99.5% 탐지 / 0.001% FP, $100B+ 모니터링, Safe 네이티브 통합(2025-11). 엔터프라이즈 $30k–$200k+/년
- **Forta**: OSS Bot 마켓플레이스, 무료 Tier
- **Phylax Credible Layer**: Solidity assertion → 시퀀서 pre-inclusion 거부
- 구성: Hypernative alert → Webhook → Gelato Relayer → `pause()`

### 10.3 세금
- CoinTracker Hobbyist $59/yr, Koinly Hodler $99/yr
- **Rotki**: 오픈소스 로컬, Premium $11.99/월 (프라이버시)
- **한국 시행**: 2027-01-01 (3차 유예 확정), 연 250만원 초과 22%. CARF MCAA 48개국 2027년부터 자동 정보교환
- **페이백 모델 세무 주의**: 페이백 BTC는 **수익 실현 시점 과세**. USD denominated cost basis 추적 필수.

### 10.4 성과 대시보드
- **Grafana + Prometheus** OSS / Grafana Cloud Free 10k 시리즈
- **DeBank Open API** (Pro $200부터), **Zapper** ($0.0002/point), **Zerion** ($99/월 Starter)
- BobClaw 전용 KPI 대시보드: BYR, CG, TBR, 페이백 cumulative BTC (Part 6.7)

### 10.5 디페그 감지
- **Chainlink** heartbeat 24h, deviation 0.25%
- **Pyth** pull, ~400ms
- 임계치 **Warning <$0.98 / Critical <$0.95** (2023 USDC 최저 $0.87 Kraken)

### 10.6 키 관리 비교
| 솔루션 | 가격 (2026-04) | 용도 |
|---|---|---|
| AWS CloudHSM | $1,168/월 (HA 2대 $2,336) | 은행급 루트 키 |
| Fireblocks MPC | $30k–$150k+/년 | 기관 트레저리 |
| **Privy** (Stripe 인수 2025-06) | Free 1k MAU, Pro $99+/월 | 소비자 임베디드 |
| **Turnkey** | Free dev, Scale $99+/월 (AWS Nitro TEE) | **백엔드 자동화 (권장)** |
| **Safe Multisig** | **무료** (가스만) | **트레저리 3/5 (권장)** |

**BobClaw 권장**: 운영 핫월렛=**Turnkey TEE**, 트레저리=**Safe 3/5 + Hypernative Guardian**, 루트 키=**CloudHSM** (규모 $50K+ 시).

**Bitcoin L1 측 키 관리 (페이백 도착 주소)**: **Sparrow + 하드웨어 월렛** (Coldcard/Foundation Passport) 권장. 페이백은 항상 같은 주소 또는 derived path에 도착하도록 룰 고정.

### 10.7 RPC 다양화
- Alchemy Free 300M CU/월, Growth $49
- Infura Free 6M CU/일, Developer $50
- QuickNode Starter $10
- **chainlist.org** (퍼블릭), dRPC, Ankr
- **ethers v6 FallbackProvider** (v5는 GH #3366 버그), **2-provider minimum** 프로덕션 표준
- Bitcoin RPC: **본인 노드 (Bitcoin Core)** 또는 **Mempool.space API** (페이백 전 fee estimation용)

### 10.8 로깅 + 감사증적
- Sentry Developer Free 5k events, Team $26/월
- OpenTelemetry OSS (Tempo/Jaeger)
- Loki + Grafana Cloud Free 50GB/월
- 배포 바이트코드 해시 온체인 저장, `extcodehash` 매 기동 비교
- Config SHA-256 → IPFS CID → 이벤트 emit (Pinata Free 1GB / Filebase $5.99/TB)
- **페이백 트랜잭션 영수증**: Bitcoin txid + BOB Gateway order ID + destination chain harvest tx 3개 한 묶음 로그

---

## Part 11: LLM 활용 판단 — **MVP에서는 불필요**

### 11.1 Mac Mini M4 16GB 로컬 LLM 벤치마크
출처: `llama.cpp` Discussion #4167, geerlingguy #57 (2024-11), mlx-examples #1029

| 모델 + 양자화 | 생성 속도 | 메모리 | 비고 |
|---|---|---|---|
| LLaMA 7B Q4_0 | **24.11 t/s** | ~3.8 GB | 기본 벤치 |
| **Llama 3.1 8B Q4_K_M** | **20.95 t/s** @ 29.4W | ~5 GB | **실용 최고치** |
| Qwen 2.5 7B Q4_K_M | 32–35 t/s | ~5 GB | |
| Llama 3.2 3B Q4_K_M | 60–80 t/s (추정) | ~2 GB | 빠름, 품질 낮음 |
| Phi-4 14B Q4_K_M | 8–12 t/s (추정) | ~9.1 GB 모델 + KV = **16GB 한계** | M4 Pro 권장 |

**현실**:
- **Q4_K_M이 실질적 표준** (16GB 제약)
- Ollama는 llama.cpp보다 3–10% 느림
- MLX는 flash attention 없으면 llama.cpp(-fa)보다 느림
- M4 vs M4 Pro: 대역폭 120 vs 273 GB/s → 디코딩 **2배 차이**

### 11.2 외부 API 월 비용 (10회/일 기준, input 2K/output 500 tokens)
| 모델 | Input $/M | Output $/M | 월 비용 |
|---|---|---|---|
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | **$0.12** |
| Gemini 2.5 Flash | $0.30 | $2.50 | $0.57 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $1.35 |
| Gemini 2.5 Pro | $1.25 | $10.00 | $2.25 |
| Claude Sonnet 4.5/4.6 | $3.00 | $15.00 | $4.05 |
| Claude Opus 4.6 | $5.00 | $25.00 | $6.75 |

100회/일로 확장해도 Gemini Flash ~$5.7/월, Haiku ~$13.5/월. **Mac Mini 전기세보다 싸다**. Batch API 50% 할인, Prompt caching 90% 할인.

### 11.3 LLM이 유리한 작업 vs 룰로 충분한 작업
| 작업 | 룰 충분 | LLM 유리 |
|---|---|---|
| 가격 임계치, TVL/APR, 가스 최적, **청산/리밸런싱/금액·페이백 결정** | ✅ (결정론 필수) | |
| 거버넌스 제안 카테고리화 | | ✅ |
| Discord/Twitter 센티먼트 | | ✅ |
| 감사보고서 위험 요약 | | ✅ |
| 자연어 운영 로그 설명·사용자 리포트 생성 | | ✅ (post-hoc) |
| 파라미터 튜닝 | ✅ (Bayesian opt/grid search) | 🚫 (LLM은 수치 최적화 취약) |

**절대 금지**: LLM 직접 트랜잭션 서명, 금액 결정, **페이백 비율 결정**. 블록체인은 되돌릴 수 없다.

### 11.4 BobClaw 결론

| Phase | LLM 전략 | 월 비용 |
|---|---|---|
| **Phase 1 (MVP)** | **LLM 없음**. 완전 룰 기반. | $0 |
| **Phase 2** | Gemini 2.5 Flash **읽기 전용 보조**. 거버넌스 요약, 감사보고서 RAG, 센티먼트 배치, **사용자에게 보내는 주간 페이백 리포트 자연어 생성**. 사람 승인 or 결정론적 가드레일 경유. | **$5–20** |
| **Phase 3** | 호출량 수백/일 or 프라이버시 요구 시 M4 Pro 24–48GB/M4 Max 업그레이드. 16GB는 14B+ 모델에 부족. | 하드웨어 $1500~ |

**결론**: BobClaw MVP에 LLM **불필요**. Phase 2에서 외부 API($5–20/월)로 시작, 필요성 검증 후 Phase 3에서 하드웨어 투자 검토. **16GB Mac Mini에서 로컬 DeFi LLM 돌리는 것은 비용 대비 가치 없음**.

---

## Part 12: 과적합 방지 + 백테스트 (강화)

### 12.1 과적합 방지 체크리스트 (BobClaw 실전)

**AI 코딩 도구가 반드시 통과해야 하는 12개 질문** (페이백 모델 특화 추가):

1. ☐ 모든 임계치가 **YAML 설정**에 있고 코드에 하드코딩되지 않았는가?
2. ☐ 전략이 **최소 1회의 regime change** (급락장, depeg, 유동성 crunch)를 포함한 데이터로 검증되었는가?
3. ☐ **OOS (Out-of-Sample) 검증** 결과가 IS 대비 WFE ≥50%인가?
4. ☐ **Deflated Sharpe Ratio (Bailey & López de Prado 2014)** 적용하여 다중 시도 조정된 결과가 유의미한가?
5. ☐ **PBO (Probability of Backtest Overfitting)** 계산 결과 <50%인가?
6. ☐ **Shadow mode** 최소 1주 실측 결과와 백테스트 예측이 ±20% 이내 일치하는가?
7. ☐ **슬리피지·MEV·가스 스파이크**가 보수적으로 시뮬레이션되었는가?
8. ☐ **인센티브 토큰 매도 압력**이 모델링되었는가? (점수 단순 누적 ≠ 현금화 가능)
9. ☐ **과거 APY가 미래 APY가 아니라는 가정**이 명시되었는가? (토큰 emission decay)
10. ☐ **생존 편향** 제거: 해킹된 프로토콜, 청산된 pair 포함했는가?
11. ☐ ★ **Gateway round-trip 비용**이 백테스트에 포함되었는가? (Part 1.3)
12. ☐ ★ **BTC 가격 변동에 따른 BTC denominated PnL 시나리오**가 검증되었는가? (BTC ±50% 시 KPI)

### 12.2 하드코딩 금지 패턴 (AI 안티패턴)

**아래 패턴을 코드에서 발견하면 즉시 리팩토링**:

```python
# ❌ 금지: 하드코딩
if tvl < 500_000_000:  # ← 특정 숫자
    reject()
if apy > 15:  # ← 특정 숫자
    enter()
if gas_gwei > 80:  # ← 특정 숫자
    skip()
if payback_ratio == 0.25:  # ← 페이백도 마찬가지
    payback()

# ✅ 권장: 설정 외부화
if tvl < config['risk']['min_protocol_tvl_usd']:
    reject()
if apy > config['strategy']['min_apy_threshold']:
    enter()
if gas_gwei > config['execution']['max_gas_gwei']:
    skip()
if payback_ratio == config['payback']['base_ratio']:
    payback()
```

### 12.3 단일 데이터포인트 함정 (v1에서 실제 발생한 예)

**사례**: "BOB L2 DeFi TVL = $10M, 따라서 BOB는 죽은 생태계" → **잘못된 결론**.

**올바른 접근**:
- BOB Gateway가 **11+ 체인에서 routing 역할**을 하므로 BOB L2 TVL은 Gateway 유용성의 **일부 지표에 불과**
- 최소 **3가지 메트릭 교차 확인**: DeFi TVL, Bridged TVL, 생태계 전체 가치(예: Dune Gateway 볼륨)
- **섹터 평균과 비교**: Bitcoin L2 전체 TVL이 2025년 -74% → BOB만의 문제가 아님
- **로드맵 대비 현재 위치 확인**: BitVM 메인넷 전/후는 전혀 다른 상황

**AI 가드레일**: 단일 수치로 프로토콜/체인을 평가하는 코드는 **자동으로 warning** 발생시키기.

### 12.4 적응형 임계치 사용

**정적 임계치 대신 상대/적응형 임계치**:

| 정적 (취약) | 적응형 (권장) |
|---|---|
| `if tvl < 500M` | `if tvl < rolling_30d_median(tvl) * 0.5` |
| `if apy > 15%` | `if apy > sector_p75(apy)` |
| `if gas > 80 gwei` | `if gas > last_7d_p90(gas)` |
| `if price < $2000` | `if price < 200d_MA(price) * 0.8` |
| `payback if profit > $100` | `payback if profit_btc > 0.0005 (gas-adjusted)` |

### 12.5 재검증 주기 (Cron으로 강제)

| 항목 | 주기 | 실패 시 동작 |
|---|---|---|
| 프로토콜 TVL | 주 1회 | `min_tvl` 이하면 `read_only` 전환 |
| 감사 상태 | 월 1회 | 새 취약점 공개 시 긴급 pause |
| 프로토콜 해킹 이력 | 일 1회 (rekt.news feed) | 매치 시 즉시 pause + alert |
| Oracle heartbeat | 실시간 | stale >2x threshold 시 거래 중단 |
| BOB BitVM 상태 | 월 1회 | 메인넷 론칭 시 BOB 노출 상한 상향 가능 |
| 파라미터 튜닝 | 분기 1회 | Deflated SR 재계산 |
| **Gateway round-trip 실측 비용** | **주 1회** | 0.5% 초과 시 페이백 빈도 조정 |
| **BTC 가격 회계 재계산** | **일 1회** | KPI (BYR, CG, TBR) 재계산 |

### 12.6 백테스트 프레임워크
- **Foundry forge test**: `--fork-url`, `vm.createFork()`, `vm.warp()`, `vm.roll()`, `deal()`. v1.3.0 이후 Reth 기반.
- **Tenderly Virtual TestNets**: 109 네트워크 fork. Pro 100 sim/min.
- **vectorbt** (polakowo, Numba 1000x backtrader 속도), NautilusTrader
- **R CRAN `pbo` 패키지**: PBO 계산 표준 구현
- **Bitcoin testnet/signet**: Gateway onramp/offramp 사이클 통합 테스트

### 12.7 Walk-Forward + Deflated Sharpe

**WFA (Pardo 1992 gold standard)**:
- IS/OOS 비율: 70–80% / 20–30%
- DeFi 특화: IS 12–24개월 / OOS 3–6개월
- **WFE >50%** 이면 profitable 가능성 有

**Deflated Sharpe Ratio** (Bailey & López de Prado 2014):
```
DSR = Φ[ (SR̂ − SR₀)·√(T−1) / √(1 − γ₃·SR₀ + (γ₄−1)/4·SR₀²) ]

SR₀ = √V[SRₙ] · [(1−γ)·Φ⁻¹(1−1/N) + γ·Φ⁻¹(1−1/(N·e))]
γ = 0.5772156649 (Euler-Mascheroni)
```

**구현 함정**: SR은 **반드시 unannualized**, γ₄는 **non-excess kurtosis (Pearson)**. Wikipedia cross-check: `davidhbailey.com/dhbpapers/deflated-sharpe.pdf`, SSRN 2460551.

**페이백 모델 특화 SR 계산**: Sharpe 분자는 **BTC denominated returns**, 분모는 **BTC denominated volatility**. USD SR과 BTC SR을 분리 보고.

**PBO (CSCV)**: Bailey-Borwein-López de Prado-Zhu 2015/2017. N trials → (T×N) matrix → S subsets → C(S, S/2) combos → IS 최고의 OOS rank → logit. **PBO > 50% 심각한 overfit**. 최근 BTC top-40: PBO=0.586.

### 12.8 Paper Trading 권장
- Retail 관행: 3–6개월
- Institutional (LGT, Bridgewater): 12–24개월
- Bailey MinTRL: SR=0 벤치, 관측 SR=1.0, skew=-1, kurt=5 → MinTRL ≈ **24개월**
- **최소 1회 regime change(급락) 포함** 필수
- ★ **첫 페이백 전 최소 4주 shadow** (round-trip 비용 누적 손실 방지)

---

## Part 13: Codex / GitHub Copilot 작업 지침

### 13.1 이 문서 업데이트 규칙
- Part 1.5의 수치는 **월 1회** `defillama.com/chain/BOB`, `l2beat.com/scaling/projects/bob/tvs-breakdown`, `dune.com/bob_collective/gateway`에서 재확인 후 갱신
- Part 1.3 Gateway round-trip 비용 실측치는 **주 1회** Dune에서 재확인
- Part 9.4 BTCfi TVL은 **월 1회** 재확인
- Part 3.3 프로토콜 TVL은 **월 1회** 재확인
- 수치 갱신 시 **출처 URL + 날짜** 명시 의무

### 13.2 데이터 소스 우선순위
1. **공식 문서** (gobob.xyz/docs, aave.com/docs, morpho.org/docs)
2. **감사 보고서** (Pashov, OpenZeppelin, Trail of Bits, Certora, Verichains, Halborn)
3. **DeFiLlama** (TVL, APY)
4. **L2Beat** (브리지·L2 보안)
5. **Dune Analytics** (볼륨·사용자, Gateway 수수료 실측)
6. **rekt.news** (해킹 이력)
7. **Exponential.fi, DeFiSafety** (리스크 점수)

**금지 소스**: Medium 블로그(소스 없는), 트위터 스레드(검증 없는), "10대 DeFi 추천" 어뷰즈 사이트.

### 13.3 코딩 안티패턴 체크리스트

**AI가 작성한 코드가 아래 중 하나라도 해당하면 즉시 리팩토링**:

- 프로토콜/체인 이름이 코드에 **문자열로 하드코딩** → config enum화
- TVL/APY 임계치가 **숫자로 하드코딩** → config 외부화
- 단일 RPC provider 사용 → **FallbackProvider 2+개** 필수
- try/except 없이 웹훅/외부 API 호출 → **지수 백오프 재시도** 필수
- Private key가 env var/파일에 **평문 저장** → Turnkey/Safe/HSM 경유 필수
- 트랜잭션 전 **시뮬레이션 없이** 직접 전송 → Tenderly `eth_simulate` 필수
- **maxFeePerGas 캡 없이** 트랜잭션 제출 → 가스 스파이크 시 예상 외 비용
- LLM이 **금액/실행 여부/페이백 비율**을 직접 결정 → 룰 엔진 통과 필수
- 백테스트 **OOS 검증 없이** 프로덕션 → 12.1 체크리스트 필수
- Aave `flashLoan` 후 **repay 실패 경로 미처리** → revert 대비 필수
- ★ **PnL이 USD 단위로만 계산** → BTC denominated 회계 필수
- ★ **Gateway round-trip 비용 미반영** → 페이백 net이 마이너스 가능

### 13.4 파일 구조 권장 (단일 레포)

```
bobclaw/
├── AGENTS.md              # 이 문서 (최상위, 단일 진실)
├── README.md              # 프로젝트 개요
├── config/
│   ├── rules.yaml         # Part 8 rule engine
│   ├── protocols.yaml     # Part 4 프로토콜 whitelist
│   ├── chains.yaml        # Part 2 체인 정책
│   ├── thresholds.yaml    # Part 12 적응형 임계치
│   └── payback.yaml       # ★ Part 6 페이백 정책
├── src/
│   ├── engine/            # Rule engine (Part 8)
│   ├── gateway/           # BOB Gateway SDK wrapper (Part 1)
│   │   ├── onramp.ts      # native BTC → destination chain
│   │   └── offramp.ts     # destination chain → native BTC (페이백)
│   ├── strategies/        # Looping / IL / Delta-neutral (Part 3, 5, 9)
│   ├── risk/              # HF 모니터, 청산 방어 (Part 3.5)
│   ├── payback/           # ★ Part 6 페이백 엔진
│   │   ├── calculator.py  # BTC denominated 계산
│   │   ├── scheduler.py   # weekly cron
│   │   └── kpi.py         # BYR, CG, TBR
│   ├── accounting/        # ★ BTC denominated PnL
│   ├── gas/               # Part 7 가스 관리
│   ├── security/          # Part 10 키 관리, MEV, kill switch
│   └── llm/               # Part 11 Phase 2+ (초기 비어있음)
├── backtest/              # Part 12 Foundry + Tenderly
├── shadow/                # Shadow mode 로그
└── docs/
    └── runbooks/          # 사고 대응 매뉴얼
```

### 13.5 커밋 전 필수 체크
- [ ] 모든 임계치가 `config/*.yaml`에 있는가?
- [ ] 새 프로토콜 추가 시 `protocols.yaml` whitelist 경유했는가?
- [ ] 새 체인 지원 시 `chains.yaml`에 `mode` 명시했는가?
- [ ] 트랜잭션 경로에 `maxFeePerGas` 캡이 있는가?
- [ ] Private key가 Turnkey/Safe 경유하는가 (직접 노출 없음)?
- [ ] 단위 테스트 + Foundry fork 테스트 통과했는가?
- [ ] Shadow mode 1주 데이터 있는가 (전략 변경 시)?
- [ ] ★ PnL 계산이 BTC denominated로 되어 있는가?
- [ ] ★ Gateway round-trip 비용이 페이백 계산에 차감되는가?

---

## 결론: BobClaw 7가지 확고한 설계 원칙

1. **본질은 페이백 모델**: 사용자가 native BTC로 입금 → destination chain에서 운용 → 수익의 일부 native BTC로 환원. 모든 회계는 **BTC denominated**.

2. **모든 온체인 의사결정은 결정론적 룰 기반**이다. LLM은 Phase 2+에서 읽기 전용 보조 + 사용자 리포트 자연어 생성으로만 존재한다.

3. **페이백 비율은 운용 수익의 20–25%** (Half-Kelly + ARK 19.4% + Tether 15% 정책의 합의 구간). Mayer Multiple·변동성·drawdown 트리거로 동적 조정. **나머지 75–80%는 destination chain에서 compound 재투자**.

4. **BOB Gateway는 라우팅 레이어, 집행은 destination chain에서** 한다. BOB L2 DeFi TVL을 기준으로 전략을 재단하는 것은 오판이다. **Custom DeFi Actions로 Ethereum/Base/Arbitrum의 블루칩 프로토콜에서 실제 수익을 만들고, 페이백은 다시 BOB Gateway offramp를 통해 native BTC로 돌아온다**.

5. **Health Factor ≥ 1.5 (correlated 1.1–1.3)** 유지 + 자동 deleveraging + 2023 USDC/Euler/2026 Solv BRO 사례 기반 비상 pause가 운영 마지노선이다.

6. **YAML 선언적 룰 + Python 훅 + watchdog atomic 핫리로드**가 rule engine 표준. OpenZeppelin Defender(2026-07-01 셧다운)는 Gelato/Chainlink/OSS Monitor로 반드시 이관.

7. **Round-trip 비용 (0.2–1.6%)을 항상 차감하여 net 수익 계산**. $500 스케일에서는 이 비용이 첫 1년 수익의 10% 이상을 잠식 가능하므로 입금은 묶고, 페이백은 누적 후 batch.

**운영 스택**: Turnkey TEE(핫월렛) + Safe 3/5(트레저리) + Hypernative Guardian(위협) + Flashbots `/fast`(MEV) + 2+ RPC FallbackProvider + Sentry/OpenTelemetry/Loki + Sparrow + 하드웨어 월렛(BTC 페이백 도착). 감사증적은 IPFS CID를 온체인 이벤트로 emit + 페이백 Bitcoin txid + Gateway order ID 3중 영수증.

**BOB Gateway 활용**: BitVM 메인넷(2026 초~중) 전까지 BOB L2 직접 노출 ≤10%. 이후 ≤20%로 상향 가능. Gateway Custom DeFi Actions로 BTC → Aave/Morpho/Pendle on destination chain 진입, 수익 발생 시 Gateway OfframpRegistry로 native BTC 페이백.

**과적합 방지**: Deflated Sharpe Ratio + CSCV PBO <50%, WFE ≥50%. Foundry mainnet fork + Tenderly Virtual TestNets + Bitcoin testnet/signet 검증. **최소 1회 regime change 포함 12–24개월 데이터** + BTC ±50% 가격 시나리오 KPI 검증 + shadow mode 최소 4주 후 첫 페이백 시작.

이 문서의 Part 1–13 모든 규칙을 위반하지 않고 구현하면, Codex/Copilot이 BobClaw를 일관되게 확장할 수 있다.
