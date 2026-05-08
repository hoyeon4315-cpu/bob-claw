# BOB 생태계 — 사실 참조

> **이 문서의 성격**: 리서치 사실 참조. **규칙이 아님.** 운영 규칙은 리포 루트 `AGENTS.md`.
> **갱신 주기**: TVL/APY/거버넌스 상태 등 정량 수치는 **30일**, 체인 열거·인프라 사실은 **90일**마다 재검증.
> **마지막 실사 기준일**: 2026-05-08 (Gateway 공식 docs/API, BOB GitHub, npm 재확인. 정량 TVL/APY는 별도 주기 유지).

---

## 1.1 BOB는 세 개의 독립 레이어다

많은 AI가 이 셋을 혼동해 잘못된 전략을 내놓는다. 반드시 구분:

| 레이어 | 정체 | 역할 | Chain ID |
|---|---|---|---|
| **BOB Hybrid Chain** | OP Stack L2 + Kailua ZK fault proofs + Superchain 멤버 | EVM 실행 환경, 일부 집행 장소 | **60808** |
| **BOB Gateway** | Intent + SPV 기반 크로스체인 원자 스왑 **프로토콜** | Bitcoin ↔ EVM 라우팅, 11 체인 연결 | (체인 아님) |
| **BOB Token** (ERC-20) | 거버넌스·스테이킹 토큰 | Hybrid node 담보, Gateway solver 담보, DAO 투표 | BOB Chain 발행, 멀티체인 OFT |

---

## 1.2 BOB Gateway 작동 원리 (5단계)

1. LP가 BOB 체인 escrow에 wrapped BTC 예치 (지연기간 잠금)
2. 사용자가 off-chain relayer에 quote/reserve 요청
3. 사용자가 LP의 BTC 주소로 송금, Bitcoin 트랜잭션 **OP_RETURN**에 주문 해시(EVM 주소 + intent) 포함
4. Relayer가 on-chain Bitcoin Light Client(`LightRelay`)에 **SPV Merkle proof** 제출
5. BOB 컨트랙트가 OP_RETURN 해시 일치 검증 → LP wrapped BTC 언락 + **destination intent 실행**

**Custom DeFi Actions (2025-12-04 공식 게시, 2025-12 라이브)**: LayerZero Composer 컨트랙트를 통해 "Bitcoin → BOB → destination chain"의 마지막 단계에서 임의의 EVM 호출 실행 가능. 검증된 공식 use case:
- Aave on Base에 native BTC 예치 (cbBTC 경유)
- SolvBTC.BNB Pendle market on BSC 진입
- Unichain wBTC/USDC LP 공급

출처: `gobob.xyz/blog/custom-defi-actions-now-integrated-in-bob-gateway-sdk`

**Offramp (수익 → native BTC)**: `OfframpRegistry` 컨트랙트에 wrapped BTC 락업 → solver가 사용자 BTC 주소로 송금. 최신 Gateway SDK 문서는 order status에서 반환되는 action transaction인 `bumpFeeTx`(RBF)와 `refundTx`(취소/환불)를 실행하는 흐름으로 설명한다. 완료 5–10분(Bitcoin 블록타임).

**감사**: Pashov, Common Prefix 완료.

---

## 1.3 Gateway Round-trip 비용

페이백 모델(`AGENTS.md "Payback Model"`)에서 round-trip 비용은 **수익에서 직접 차감**되므로 사전 계산 필수.

| 단계 | 비용 항목 | 추정 (2026-04, $1K BTC 기준) |
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

**시사점 (페이백 설계에 직접 반영됨)**:
- 소액 잦은 입출금 = 비용 폭증
- 페이백은 누적 후 batch 처리 권장 (AGENTS.md `minPaybackBtc` · `maxOfframpCostPctOfPayback` 카프로 enforce)
- 실제 비용은 `dune.com/bob_collective/gateway`의 fees 데이터로 월 1회 캘리브레이션

---

## 1.4 Gateway 공식 지원 체인 (2026-04-17 확정, 정확히 11개)

**이전 세션 v3 가이드라인의 오류 정정**: v3 Part 1.4는 "Ethereum, BOB L2, Base, Arbitrum, Optimism, BNB, Avalanche, Unichain, Polygon 외. 11+"라고 기술했으나 이는 3개 오류:
1. **Arbitrum은 공식 11 리스트에 없음** (2026-04 기준 Gateway onramp 공식 지원 아님)
2. **Polygon도 11 리스트에 없음**
3. **Sei, Berachain, Soneium이 누락됐거나 "외"로 뭉개짐**

**정확한 11개 destination chain**:

| # | Chain | Chain ID | 스택 | Gateway 모드 |
|---|-------|----------|------|---------------|
| 1 | Ethereum | 1 | L1 | Onramp + Offramp |
| 2 | BOB L2 | 60808 | OP Stack + Kailua ZK fault proofs | Onramp + Offramp (허브) |
| 3 | Base | 8453 | OP Stack L2 | Onramp + Offramp |
| 4 | BNB Chain | 56 | Alt-L1 | Onramp + Offramp |
| 5 | Avalanche | 43114 | Alt-L1 | Onramp + Offramp |
| 6 | Unichain | 130 | OP Stack L2 (Uniswap) | Onramp + Offramp |
| 7 | Berachain | 80094 | Alt-L1 PoL | Onramp + Offramp |
| 8 | Optimism | 10 | OP Stack L2 | Onramp + Offramp |
| 9 | Soneium | 1868 | OP Stack L2 (Sony) | Onramp + Offramp |
| 10 | Sei | 1329 | Alt-L1 EVM (parallelized) | Onramp + Offramp |
| 11 | Sonic | 146 | Alt-L1 (구 Fantom) | Onramp + Offramp |

**공식 원문 (gobob.xyz/blog/btc-to-wbtc, 2025-09-29, 2025-10-23 업데이트, 확인 2026-04-17)**: Gateway는 Ethereum, Avalanche, Base, BNB, Unichain, Soneium, Bera, Optimism, Sei, Sonic 그리고 BOB 자체 — 총 11개 체인에서 native BTC on/offramp를 wBTC.OFT로 지원.

**Gateway 공식 지원이 아닌 체인** (2026-04 기준): Arbitrum, Polygon, Mantle, Scroll, Linea, Hemi, Corn, Plasma, HyperEVM, Ink, Taiko.
- 이들 체인의 BTC 자산은 **BOB L2까지만 온다**. one-click native-BTC 라우팅 대상이 아님.
- 코드에서 이들 체인을 Gateway destination으로 지정하면 **즉시 reject**. 필요 시 post-Gateway 수동 브릿지 경로로 별도 처리.

**"15K dapps" 해석 주의**: "15K dapps across 11 chains" 문구의 15K는 BOB 네이티브 dApp이 아니라 **LayerZero wBTC.OFT가 배포된 11개 체인 전체의 dApp 수**. 마케팅 문구로 인용할 때 "BOB 전용 dApp 수"로 오해하지 말 것.

---

## 1.5 BOB 생태계 규모 — 세 가지 메트릭 (치명적 혼동 지점)

이 섹션은 "BOB L2가 작으니 전략이 무의미하다"는 오판에서 프로젝트를 구하는 핵심 사실이다.

| 메트릭 | 값 (2026-03~04) | 측정 대상 | 의미 |
|---|---|---|---|
| **BOB L2 DeFi TVL** (DeFiLlama) | **$10.17M** | BOB L2 위에서 동작하는 dApp에 락업된 자산 | BOB L2를 집행 장소로 사용하는 규모. 작다 = BOB L2 내부 전략 규모 제한 |
| **BOB L2 Bridged TVL** (L2Beat TVS) | **$66.16M** | BOB L2로 브리지된 총 자산 | BOB L2에 존재하는 자산 총량. Gateway onramp 규모 추정 |
| **BOB 생태계 전체 BTC value** | **~$152M peak (2025)**, **~$183M reported (2025-12)** | Gateway를 통해 다른 체인에 배포된 BTC 담보 포함 | Gateway의 실질 유용성. 대부분이 BOB L2 **바깥**에서 동작 |

**핵심 해석**:
- BOB L2 DeFi TVL $10M은 "BOB L2에서만 실행되는 DeFi dApp이 아직 작다"는 뜻이지, "BOB Gateway가 작다"는 뜻이 **아님**.
- BOB Gateway의 본질은 Bitcoin → 임의 EVM 체인 라우팅 엔진. BobClaw의 95%+ 가치는 destination chain(Ethereum/Base/Avalanche 등)에서 발생하고, BOB L2 상 TVL은 이를 측정하지 않는다.
- **BOB L2 TVL만 보고 BobClaw 전략을 설계하면 집행 체인 노출을 잘못 평가**. 실제 노출은 destination chain 기준으로 계산.

섹터 맥락: The Block 2026 Outlook은 Bitcoin L2 TVL이 2025년 **-74% 감소**, BTCFi TVL **-10%** (101,721→91,332 BTC). 섹터 평균과 함께 해석해야 한다.

**출처**: `defillama.com/chain/BOB`, `l2beat.com/scaling/projects/bob/tvs-breakdown`, `theblock.co/post/383329/2026-layer-2-outlook`, Altcoin Buzz 2026-01 BOB 피크 보고.

---

## 1.6 지원 자산 — BTC 파생 토큰

| 자산 | 타입 | Yield 출처 | Gateway 지원 | 주의사항 |
|---|---|---|---|---|
| **WBTC / tBTC / FBTC / cbBTC** | Wrapped BTC | 없음 (래퍼) | ✅ 기본 | WBTC는 3-of-3 multisig custody (BitGo US + BiT Global HK + BitGo Singapore, 2025-12 OCC national trust 취득) |
| **SolvBTC** | Solv 범용 reserve | 없음 | ✅ onramp target | 2025-10 기준 24,226+ BTC (~$1.7B). 2026-03-03 BRO 별건 사고 (§1.7 참조) |
| **xSolvBTC** (구 SolvBTC.BBN) | Babylon LST | Babylon PoS + delta-neutral + AI vault | ✅ | xSolvBTC 자체 해킹 이력 없음. BRO는 별건 |
| **LBTC** (Lombard) | Consortium + Babylon LST | Babylon ~1% + 인센티브 | ✅ / BOB Earn | Chainlink PoR 2026-02-05. 컨소시엄: OKX/Galaxy/DCG/Wintermute |
| **uniBTC** (Bedrock) | LST/LRT 라우터 | Babylon + Pell + Kernel | ✅ | 2024-09 $2M exploit 이력 |
| **eBTC** (ether.fi) | BTC LRT | Karak/Symbiotic + Lombard points | ✅ | |
| **Pell BTC** | Bitcoin re-staking AVS | 재스테이킹 + PELL | ✅ Gateway direct staking | 토큰 인센티브 위주, APY 변동성 큼 |
| **satUSD** | River BTC 담보 스테이블 | Protocol yield | BOB 네이티브 | BOB L2 스테이블 mcap 98.68% 점유 (집중도 위험) |

**BobClaw 선호도 (docs/research/strategies-and-risk.md에서 리스크 점수와 교차)**:
- Base 체인: cbBTC > LBTC > tBTC > WBTC
- Ethereum 체인: WBTC > LBTC > tBTC
- BSC 체인: BTCB > xSolvBTC (BRO 관련 제한 포함)

---

## 1.7 Solv Protocol BRO 사건 (2026-03-03, 정확한 사실)

**날짜**: 2026-03-03 (Verichains / Halborn 분석)
**대상**: Solv Protocol의 **BRO (BitcoinReserveOffering) 볼트**
**손실**: **38.0474 SolvBTC ≈ $2.7M**
**기술**: BRO 컨트랙트의 **double-mint 취약점**. Verichains는 re-entrancy가 **아닌** 내부 로직 결함으로 결론(일부 외부 분석가는 reentrancy로 오기). 22회 반복 호출로 135 BRO → 567M BRO 인플레이션 → 38 SolvBTC 스왑 → Uniswap에서 1,211 WETH 전환.
**영향 범위**: 10명 미만 사용자. 다른 볼트·SolvBTC 본체 자산 영향 없음.
**대응**: Solv가 손실 전액 보상, 10% 화이트햇 바운티 제안, Hypernative Labs/SlowMist/CertiK 협력.

**BobClaw 시사점** (운영 규칙은 AGENTS.md Risk Limits로):
- **BRO 볼트는 사용 회피**. SolvBTC 본체와 xSolvBTC는 별개로 지속 사용 가능
- "큰 reserve 토큰의 위성 상품에서 사고가 난다" 패턴 — BTCfi 위성 상품 노출 시 본체 vs 위성 구분 필수
- Solv가 24,226+ BTC (~$1.7B) 보유 중, 사고 후에도 SOLV 토큰 +2% 유지 = 본체 신뢰도 영향 제한적

**출처**: `halborn.com/blog/post/explained-the-solv-hack-march-2026`, `blog.verichains.io/p/solv-protocol-hack-analysis`, `theblock.co/post/392492/`

---

## 1.8 BOB L2 배포 프로토콜 (확인된 것만)

| 프로토콜 | 상태 | 용도 |
|---|---|---|
| **Euler v2** | ✅ 라이브 (2025, HybridBTC.pendle 런칭과 함께) | BTC LST 담보 루핑 |
| **Velodrome Superchain** | ✅ 라이브 (2024-04, ve(3,3)) | 네이티브 DEX, BTC 페어 유동성 |
| **Uniswap v3** | ✅ 배포됨 | 기본 스왑, CL 포지션 |
| **Hourglass** | ✅ 라이브 | 레버리지 에어드롭 farming |
| **Veda HybridBTC.pendle** | ✅ 라이브 (2025-02) | Bitcoin yield 토큰화 |
| **Aave v3 on BOB** | ❌ **halted 2025-07-15** | 참조 금지 (ACI 2026-03 Aave DAO 철수) |
| **Morpho on BOB** | ❌ BOB 배포 미확인 | destination chain 사용 |
| **Pendle on BOB** | ❌ BOB 배포 미확인 | destination chain 사용 |
| **Avalon Finance on BOB** | ✅ 라이브 (Aave fork) | 메인 루핑 대안. SolvBTC.BBN 담보 비중 주의 |

**해석**: BOB L2 자체는 Euler v2 + Velodrome + Veda 조합 중심의 "BTC LST 집중 L2". Aave/Morpho/Pendle 주요 루핑 인프라는 **Ethereum/Base/Avalanche**에서 실행하고, BOB Gateway Custom Actions로 원자적 진입.

---

## 1.9 BOB 공식 리소스

- Docs: `docs.gobob.xyz` / Gateway: `/docs/gateway/`
- GitHub: `github.com/bob-collective/bob` (GitHub latest release object는 v4.4.6로 남아 있으나, tags/npm 기준 SDK는 v5.5.0까지 진행됨)
- NPM: `@gobob/bob-sdk` (TypeScript — 최신 확인: 5.5.0, 2026-05-06 publish)
- Dune: `dune.com/bob_collective/gateway` (Gateway 누적 볼륨·트랜잭션·수수료 실측)
- RPC: `https://rpc.gobob.xyz/` / Explorer: `https://explorer.gobob.xyz/`
- L2Beat: `l2beat.com/scaling/projects/bob`
- Messari: `messari.io/project/build-on-bitcoin`

---

## 1.10 BOB Gateway SDK 사용 참고 (TypeScript/.mjs)

SDK 자체는 TypeScript. BobClaw의 `.mjs`에서 import 가능:

```javascript
// 예시 — 실제 wrapper는 src/gateway/ 하위에 이미 있을 가능성.
// 그리로 먼저 import 검색하고, 없을 때만 직접 호출.
import { GatewaySDK, parseBtc, LayerZeroGatewayClient } from '@gobob/bob-sdk';
// ethers v6 체인 객체를 쓰면 viem 대신 ethers provider로도 전달 가능.

const sdk = new GatewaySDK(/* chainId */);

// Onramp (Bitcoin → destination chain). 최신 Gateway API/SDK examples는
// token symbol보다 address/null-style token identifiers를 우선한다. 실제
// repo에서는 src/gateway/ wrapper와 route snapshot이 정규화한 값을 사용한다.
const quote = await sdk.getQuote({
  fromChain: 'bitcoin', fromToken: '0x0000000000000000000000000000000000000000',
  toChain: 'base', toToken: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  fromUserAddress: 'bc1q...', toUserAddress: '0x...',
  amount: parseBtc("0.0001"),
});

// Payback (destination → BOB → Bitcoin L1)
const offrampOrder = await sdk.createOfframpOrder({
  amount: profitInBtc,
  toBtcAddress: operatorBtcAddress,
});
```

실제 repo의 기존 `gateway:*` executor (예: `gateway-btc-onramp`, `gateway-btc-offramp`, `gateway-btc-consolidation`)가 이미 이런 호출을 감싸고 있으므로, 페이백 scheduler 작성 시 **신규 SDK 래퍼를 추가하지 말고 기존 executor의 intent 제출 경로를 재사용**.

---

## 1.11 BOB 로드맵 (확인된 마일스톤)

| 날짜 | 내용 | 상태 |
|---|---|---|
| 2024-05 | Phase 1 메인넷 런칭 (OP Stack ETH L2), Fusion Season 1 $300M TVL | ✅ 완료 |
| 2025-07-02 | BitVM 브리지 testnet | ✅ 완료 |
| 2025-08-07 | $9.5M 전략 투자 (누적 $21.1M, Castle Island Ventures 리드) | ✅ 완료 |
| 2025-09-30 | BOB Gateway + LayerZero wBTC.OFT, 11 체인 | ✅ 라이브 |
| 2025-11-22 | Hybrid Nodes 컨소시엄 (Amber, Anchorage, Babylon, Lombard, P2P, RockawayX, Solv, Wintermute) | ✅ 라이브 |
| 2025-12-05 | **Custom DeFi Actions** 라이브 | ✅ 라이브 |
| 2025-12-05 | BitVM3 "cut and choose" 온체인 비용 87% 감소 (~$10.91) | ✅ 완료 |
| 2025-12-18 | Native Bitcoin Vaults Stack 오픈소스 | ✅ 완료 |
| **2026 mid** | **BitVM 구현 mainnet** (mid-2026 planned per Messari) | ⏳ 예정 |
| 2026 후반 | BitVM 기반 Native Bitcoin Vaults 강제성 | ⏳ 예정 |

---

## 1.12 BOB Gateway "Training Wheels" 리스크 (2026-04 기준)

- 현재 relayer가 SPV proof 제출 담당 → **중앙화 신뢰 요소 잔존**
- BitVM 메인넷 배포 전까지 "BTC on BOB = 네이티브 BTC" 약속은 암묵적 트러스트 필요
- 출처: `gobob.xyz/blog/best-of-bob-2025`에서 testnet 상태 확인, Messari "BitVM-based enforcement planned for mid-2026"

**BobClaw 시사점**: BOB L2를 **최종 보관 장소**로 쓰지 않음. BOB L2는 Gateway 허브·경로로만. operating float의 장기 보관은 destination chain(Base/Ethereum) 또는 Bitcoin L1(페이백 누적).

---

## 문서 이력

- 2026-04-17: 이전 세션 v3 Part 1 기반 초기 작성. Arbitrum/Polygon 오류 정정. Aave-on-BOB halted 2025-07-15 반영. Custom DeFi Actions 날짜 2025-12-05로 정정(v3은 2025-12-04).
