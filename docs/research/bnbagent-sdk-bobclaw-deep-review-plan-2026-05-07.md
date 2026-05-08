# BNBAgent SDK vs BOB Claw Deep Review And Roadmap

작성일: 2026-05-07
작성 방식: 로컬 3개 AI 보고서 비교, BOB Claw 코드 확인, 1차 출처 확인, 서브에이전트 3개 독립 검토
범위:
- `docs/research/bnbagent-sdk-applicability-report-2026-05-07.md`
- `docs/research/bnbagent-sdk-lessons-2026-05-07.md`
- `docs/research/competitor-bnb-agent-sdk.md`
- `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`

## 결론

BNBAgent SDK는 BOB Claw의 런타임 트레이더나 자금 실행 모델로 가져올 대상이 아니다. 이 결론의 근거는 "BNB가 testnet이라서"가 아니라 제품 도메인과 실행 경계가 다르기 때문이다. BNBAgent는 client/provider/evaluator job commerce SDK이고, BOB Claw는 single-operator BTC-first payback executor다.

2026-05-07 기준 1차 출처상 BNBAgent SDK는 BSC Testnet 중심의 alpha SDK이고, README는 production 사용 금지를 명시한다. 이 사실은 **runtime dependency maturity**를 낮추는 근거일 뿐, **순수 기술 패턴의 가치**를 낮추는 근거가 아니다. Multicall3 batching, nonce recovery, Keystore V3, module registry, storage/proof pattern은 BNB Chain이라는 브랜드나 testnet 상태와 분리해 평가한다.

다만 BNBAgent SDK에는 BOB Claw가 제한적으로 배울 수 있는 패턴이 있다. 안전한 차용 범위는 read-only visibility, dev/research provenance, proof manifest, signer hardening 쪽이다. 반대로 APEX job execution, public job endpoint, UMA arbitration, ERC-8004 reputation, live plugin auto-discovery는 BOB Claw의 deterministic policy, caps-as-code, signer isolation, BTC-first payback proof와 충돌하므로 채택하지 않는다.

가장 좋은 해석은 이렇다.

1. `bnbagent-sdk-lessons-2026-05-07.md`가 운영법과 가장 정합적이다.
2. `competitor-bnb-agent-sdk.md`는 실용적 후보를 잘 좁혔지만, Multicall3 주소 보장과 nonce gap 표현은 보정이 필요하다.
3. `bnbagent-sdk-applicability-report-2026-05-07.md`는 아이디어 폭은 좋지만, P0/P1 우선순위와 ROI 숫자가 과감하다. 이 문서는 "가설 모음"으로 낮춰 읽어야 한다.

## 신뢰도 보정

이 문서의 confidence claim은 두 층으로 나눈다.

| 층 | 확신 가능 여부 | 현재 판정 |
|---|---|---|
| 검증된 사실 | 1차 출처, 로컬 코드, 테스트 출력으로 100%에 가깝게 확인 가능 | BNBAgent README의 testnet/production warning, BOB Claw policy engine의 no-RPC 구조, BOB Claw의 Multicall3 helper 부재, signer underpriced regex gap은 확인됨 |
| 미래 전략 성과 | 100% 확신 불가능 | RPC/gas 절감률, protocol onboarding 속도, live PnL 개선은 benchmark 전까지 가설 |

따라서 "100% confident strategy"는 "미래 수익이 보장된다"가 아니다. 이 문서에서 허용되는 100% confidence는 다음 뜻이다.

1. unsupported factual claim을 제거했다.
2. brand, testnet, 개인/기업 규모 bias를 분리했다.
3. 모든 채택 후보를 BOB Claw operating law의 deterministic policy, caps-as-code, signer boundary, BTC-first proof에 통과시켰다.
4. 남은 불확실성은 benchmark/research bucket으로 격리했다.

## Bias And BNB Fixation Check

사용자 우려가 맞다. "BNB는 세계적 기업이고 operator는 개인"이라는 비대칭은 무시하면 안 된다. 다만 이 비대칭은 권위에 복종하거나 반대로 testnet이라는 이유로 dismiss하는 방식이 아니라, 더 엄격한 기술 분해로 다룬다.

### Anti-Brand-Bias Rule

BNB Chain의 조직 규모, 브랜드, market position은 source credibility와 maintenance likelihood를 높이는 참고 정보다. 그러나 그것만으로 BOB Claw live path 채택 근거가 되지는 않는다. 채택 근거는 다음 네 가지다.

1. 기술 패턴이 chain-neutral하게 재사용 가능한가.
2. BOB Claw의 signer/policy/cap/payback 경계를 깨지 않는가.
3. read-only/dev/proof layer부터 작게 들어갈 수 있는가.
4. benchmark나 receipt evidence로 실제 개선을 측정할 수 있는가.

### Anti-Testnet-Bias Rule

Testnet alpha라는 사실은 다음에만 사용한다.

- live capital dependency로 직접 가져오지 않는다.
- mainnet contract address, paymaster availability, evaluator path를 production-ready로 주장하지 않는다.
- route profitability나 payback proof로 취급하지 않는다.

Testnet alpha라는 사실은 다음에는 사용하지 않는다.

- Multicall3 batching 자체를 낮게 평가하지 않는다.
- nonce manager, Keystore V3, module registry 같은 engineering pattern을 낮게 평가하지 않는다.
- BNB Chain이라는 생태계 전체를 배제하지 않는다.

### BNB/BSC Fixation Check

로컬 repo 텍스트를 거칠게 집계한 결과, `src`, `test`, `docs`에서 BNB/BSC 관련 토큰은 약 1,026회, Base는 약 6,097회, Ethereum은 약 2,351회, 기타 Gateway 체인은 약 2,729회 등장했다. 이 숫자는 완벽한 의존도 측정은 아니지만, 현 repo가 BNB/BSC에 과도하게 꽂혀 있다고 보기는 어렵다.

더 중요한 사실은 BSC가 `src/config/gateway-destinations.mjs`에 있는 11개 official Gateway destination 중 하나라는 점이다. 따라서 BSC coverage 자체는 편향이 아니라 operating scope다. 편향이 되는 순간은 BSC/BNBAgent 아이디어가 measured EV, exit proof, caps, signer boundary 없이 primary strategy로 승격될 때다.

## Confidence Loop

### Loop 1: Testnet Dismissal Loophole

Loophole: BNBAgent가 testnet alpha라는 이유로 좋은 기술 패턴까지 과소평가할 수 있다.

Fix:
- 기술 패턴 평가와 runtime maturity 평가를 분리한다.
- Multicall3, nonce, Keystore, module registry, storage/proof pattern은 pure technical merit로 평가한다.
- testnet status는 live dependency와 production readiness에만 적용한다.

Residual risk: benchmark 전에는 실제 BOB Claw 개선 폭을 알 수 없다.

### Loop 2: Brand Authority Loophole

Loophole: BNB Chain의 규모 때문에 BOB Claw와 맞지 않는 APEX/UMA/ERC-8004 runtime model까지 채택하고 싶어질 수 있다.

Fix:
- BNBAgent product model과 BOB Claw product model을 계속 분리한다.
- APEX `on_job`, public `/job/execute`, UMA arbitration, ERC-8004 reputation은 runtime execution path에 넣지 않는다.
- BNB-origin pattern도 BOB Claw policy/signer/cap boundary를 통과해야 한다.

Residual risk: future BNBAgent mainnet release가 나오면 재평가가 필요하다.

### Loop 3: BNB Chain Fixation Loophole

Loophole: BNBAgent 연구가 BSC strategy priority를 과도하게 끌어올릴 수 있다.

Fix:
- BSC는 official Gateway destination 중 하나로 유지하되, Base/Ethereum/other Gateway destinations와 같은 scoring rubric을 적용한다.
- chain selection은 current receipt, route availability, exit path, gas, inventory, campaign EV, payback path proof로만 결정한다.
- BSC-specific opportunity는 BSC-specific evidence가 있을 때만 sizing된다.

Residual risk: BSC venue data freshness가 낮으면 stale opportunity가 커 보일 수 있다.

### Loop 4: Safety Theater Loophole

Loophole: "read-only", "proof manifest", "dev lifecycle" 같은 말이 안전해 보이지만 나중에 policy/cap/live promotion input으로 새어 들어갈 수 있다.

Fix:
- 모든 imported BNBAgent pattern에는 allowed layer를 명시한다: `read_only`, `dev_report`, `proof_metadata`, `signer_internal`.
- policy/cap/payback ratio/autoExecute mutation은 명시적으로 forbidden layer로 둔다.
- tests에는 "manifest/provenance does not authorize live execution" 계열 regression을 추가한다.

Residual risk: future refactor가 layer labels를 무시할 수 있으므로 test와 docs 둘 다 필요하다.

### Loop 5: Measurement Loophole

Loophole: "RPC 80% 절감", "revert 90% 차단" 같은 숫자가 벤치마크 없이 roadmap priority를 왜곡할 수 있다.

Fix:
- 모든 효과 수치는 `hypothesis`로 라벨링한다.
- Multicall3 first PR은 helper + test + call-count benchmark만 한다.
- strategy/cap/live sizing 근거로 성능 가설을 사용하지 않는다.

Residual risk: 측정 tooling 자체가 특정 chain/RPC/provider에 편향될 수 있다.

### Loop 6: Copying And License Loophole

Loophole: BNBAgent source를 직접 port하면서 license attribution, dependency shape, hidden assumptions를 놓칠 수 있다.

Fix:
- BNBAgent source는 reference로 읽고, BOB Claw implementation은 local interface에 맞게 clean-room style로 작성한다.
- 직접 복사할 경우 MIT license attribution을 남긴다.
- UMA source는 AGPL reference가 걸릴 수 있으므로 runtime dependency나 copied contract source로 끌어오지 않는다.

Residual risk: dependency transitive behavior는 implementation phase에서 별도 review가 필요하다.

### Loop 7: Solo Operator Under-Adoption Loophole

Loophole: "나는 개인"이라는 사실 때문에 좋은 infra를 지나치게 보수적으로 미룰 수 있다.

Fix:
- low-blast-radius infra는 적극 채택한다: nonce hardening, Multicall3 read helper, proof manifest, signer keystore research.
- high-blast-radius commerce/runtime features만 보류한다.
- 작은 자본 규모는 "학습 금지"가 아니라 "blast radius 제한"으로 해석한다.

Residual risk: 너무 많은 infra work가 alpha discovery 시간을 잡아먹을 수 있다. Phase order로 제한한다.

## 1차 출처 기준 사실

### 2026-05-08 재확인 델타

2026-05-08 KST 재확인 기준, BNBAgent SDK의 live-capital 해석은 바뀌지 않았다. GitHub `main`의 확인된 최신 커밋은 2026-04-20이고, PyPI 최신 릴리스는 `bnbagent 0.2.1`(2026-04-15)이다. 즉 PyPI 패키지는 GitHub `main`의 최신 BSC testnet contract address/defaults보다 뒤처질 수 있으므로, `pip install bnbagent` 결과를 "최신 운영 기본값"으로 간주하면 안 된다. 이 버전 skew는 BOB Claw의 기존 결론을 강화한다: BNBAgent는 pattern source일 뿐 runtime dependency가 아니다.

| 항목 | 확인 결과 | BOB Claw 해석 |
|---|---|---|
| BNBAgent 성숙도 | README: BSC Testnet only, do not use in production. BNB Chain blog: testnet now, mainnet coming soon. GitHub repo is active as of 2026-05-07. | live capital dependency로 직접 채택 금지. 순수 기술 패턴은 별도 평가. |
| 표준 상태 | ERC-8004와 ERC-8183는 EIP 페이지상 Draft. | "확정 표준"처럼 쓰지 않는다. |
| 제품 도메인 | BNBAgent는 A2A paid job commerce, escrow, deliverable, dispute SDK. | BOB Claw는 단일 operator BTC-first payback agent. 도메인 다름. |
| APEX와 ERC-8004 | README는 APEX가 ERC-8004 없이도 provider wallet으로 동작 가능하다고 설명한다. Architecture 문서는 모듈 초기화 의존 순서를 둔다. | "프로토콜 사용은 독립 가능, facade/module lifecycle은 의존 관계 있음"으로 표현. |
| UMA | BNBAgent/APEX evaluator 확장이다. ERC-8183 자체가 dispute system을 강제하는 것은 아니다. | UMA verdict는 payback delivery proof를 대체할 수 없다. |
| Multicall3 | BNBAgent 구현은 실제 존재한다. 단 "모든 EVM 체인 보장"은 과장이다. | 11개 Gateway destination별 code 존재 확인 후 read-only fallback으로만 도입. |
| Paymaster | BNBAgent `paymaster.py`는 sponsorship JSON-RPC wrapper 성격이다. UserOperation/bundler/EntryPoint full stack은 확인되지 않는다. | "ERC-4337 full support"라고 부르면 과장. BOB Claw에서는 sponsorship research로만 보류. |
| Wallet provider | Keystore V3 구현은 실제다. MPC provider는 stub이다. | signer daemon 내부 backend 참고만 가능. app-process key holding 금지. |
| IPFS/hash | job deliverable hash anchoring은 있다. | BOB Claw raw audit log IPFS 공개가 아니라 private proof manifest hash로 번역. |

주요 1차 출처:
- BNBAgent SDK README: https://github.com/bnb-chain/bnbagent-sdk/blob/main/README.md
- BNBAgent SDK architecture: https://github.com/bnb-chain/bnbagent-sdk/blob/main/ARCHITECTURE.md
- BNBAgent Multicall: https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/multicall.py
- BNBAgent NonceManager: https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/nonce_manager.py
- BNBAgent Paymaster: https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/paymaster.py
- BNBAgent wallet provider: https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/wallets/evm_wallet_provider.py
- BNBAgent APEX job ops: https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/server/job_ops.py
- BNB Chain blog: https://www.bnbchain.org/en/blog/bnbagent-sdk-the-first-live-erc-8183-implementation-for-onchain-ai-agents
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- ERC-8183: https://eips.ethereum.org/EIPS/eip-8183

## 보고서별 판정

### `bnbagent-sdk-lessons-2026-05-07.md`

판정: 가장 채택 가치가 높다.

강점:
- BNBAgent를 runtime trader로 가져오면 안 된다는 결론이 맞다.
- dev/research task lifecycle, evidence hash manifest, progressive scan, EV/cost gate translation처럼 BOB Claw 경계 안에서 재해석한다.
- live authority 없음, committed diff 필요, signer/policy bypass 금지를 명확히 둔다.

보정:
- "차용 가치"는 반드시 dev/report/proof/read-only layer로 제한한다.
- proof manifest가 payback delivery proof를 대체한다는 식으로 읽히지 않게 해야 한다. delivery proof는 계속 source tx, Gateway order, Bitcoin L1 txid/balance delta다.

### `competitor-bnb-agent-sdk.md`

판정: 실용 후보가 좋지만 표현 보정 필요.

확인된 부분:
- BOB Claw `src/`에는 현재 Multicall3 helper가 없다.
- `src/executor/realtime-portfolio.mjs`는 직접 RPC 방식이며 일부 unreadable token/protocol path가 silent skip 성격이다.
- `src/executor/signer/evm-local-signer.mjs`의 signer broadcast regex에는 `replacement transaction underpriced`가 빠져 있다.
- Keystore V3는 signer backend 후보로 검토할 가치가 있다.

보정:
- "Multicall3는 모든 EVM 체인 동일 주소"는 "많은 체인에 같은 주소로 배포되어 있으나 destination별 code check 필요"로 낮춘다.
- underpriced는 BOB Claw 전체 미지원이 아니라 signer broadcast path gap이다. `src/evm/transaction-submit.mjs` classifier에는 이미 있다.
- Keystore V3는 live signer default가 아니라 optional signer-daemon-internal backend로만 설계한다.

### `bnbagent-sdk-applicability-report-2026-05-07.md`

판정: 아이디어 풀로는 유용하지만, 우선순위와 효과 수치가 과적합되어 있다.

강점:
- Multicall3, progressive scan, nonce/retry, hash manifest, provider abstraction 같은 비교 축을 넓게 잡았다.
- BOB Claw가 BNBAgent보다 execution safety와 multichain policy 측면에서 강하다는 방향성은 맞다.

과장/위험:
- `eth_call` pre-flight를 `evaluateIntentPolicies()`에 넣자는 제안은 BOB Claw policy purity와 충돌한다. 네트워크 I/O는 policy pure function이 아니라 signer pre-broadcast, helper planning, prelive simulation evidence로 분리해야 한다.
- Paymaster/ERC-4337을 단기 로드맵으로 둔 것은 과하다. BNBAgent의 current paymaster source가 full UserOperation stack으로 확인되지 않았다.
- IPFS audit trail은 raw signer audit upload처럼 보이면 위험하다. raw logs, wallet inventory, route edge, receipt details를 외부에 publish하면 안 된다.
- Plugin entry-point auto-discovery를 live strategy catalog에 붙이면 capless/untested strategy registration 위험이 생긴다.
- UMA OO payback dispute는 채택 금지에 가깝다. BOB Claw payback은 deterministic config와 Bitcoin L1 delivery proof가 기준이다.
- "90% revert 차단", "80% RPC 절감", "1일 to 1시간", "compliance cost 절감"은 현재 BOB Claw benchmark가 없으므로 가설이다.

## 과적합 점검

### 1. 성숙도 과적합

BNBAgent의 testnet/alpha 구현을 BOB Claw live-capital hardening 근거로 쓰면 안 된다. "작동하는 SDK"와 "BOB Claw에 live-safe한 dependency"는 다르다.

판정:
- 패턴 연구: 허용.
- live dependency 채택: 금지.
- 코드 port: read-only/helper/test layer부터.

### 2. 도메인 과적합

BNBAgent는 client/provider/evaluator job commerce다. BOB Claw는 single-operator BTC-first payback executor다. 외부 고객 escrow, subjective deliverable dispute, agent reputation은 BOB Claw의 product model에 직접 대응하지 않는다.

판정:
- APEX lifecycle을 dev/research task lifecycle로 번역: 허용.
- APEX escrow를 capital manager로 사용: 금지.
- public `/job/execute` style runtime endpoint: 금지.

### 3. 정책 경계 과적합

BOB Claw policy engine은 pure approval composition이어야 한다. 네트워크 `eth_call`은 실패/지연/상태 변화가 있는 I/O다.

판정:
- signer pre-broadcast simulation evidence: 검토.
- prelive/mechanical simulation: 이미 방향성 있음.
- `evaluateIntentPolicies()` 내부 RPC: 금지.

### 4. 관측 최적화 과적합

Multicall3는 read optimization이지 execution evidence가 아니다. partial failure가 생길 수 있고, chain별 deploy 여부도 확인해야 한다.

판정:
- `{ ok, value, error }` envelope으로 read-only helper 도입: 권장.
- missing code면 direct read fallback: 필수.
- multicall success를 trade approval로 사용: 금지.

### 5. 감사/증명 과적합

IPFS hash anchoring은 tamper evidence에는 유용하지만, BOB Claw의 append-only audit와 Bitcoin L1 settlement proof를 대체하지 못한다.

판정:
- private/local artifact hash manifest: 권장.
- raw audit log/IPFS public publish: 금지.
- on-chain anchor: operating capital and privacy cost 검증 후 opt-in.

### 6. 모듈 확장 과적합

BNBAgent plugin discovery는 SDK extension에는 좋지만, BOB Claw live strategy auto-discovery에는 위험하다.

판정:
- protocol reader registry validation: 허용.
- dev-agent role registry: 허용.
- live strategy catalog entry-point auto-registration: 금지.

### 7. 경제 효과 과적합

ROI 수치는 benchmark 전에는 claim이 아니라 hypothesis다. Small-capital mode에서는 작은 fixed cost도 크게 보이므로, 도입 비용과 operational complexity를 같이 봐야 한다.

판정:
- "예상 절감"은 benchmark plan에만 둔다.
- cap raise, sizing, live route admission 근거로 사용 금지.

## 채택 결정표

| 결정 | 항목 | 이유 | 조건 |
|---|---|---|---|
| Adopt now | signer nonce underpriced coverage audit | 작고 명확한 signer broadcast gap | 테스트 먼저, regex 1줄, signer path에 한정 |
| Adopt after design | Multicall3 read-only helper | direct RPC 비용과 silent skip 개선 | 11개 destination code matrix, fallback, ok/error envelope |
| Adopt after design | dev/research task lifecycle | Codex/agent scaffold provenance 강화 | `runtimeAuthority: none`, committed diff/test requirement |
| Adopt after design | proof manifest hash | payback/radar/dev artifacts tamper evidence | append-only record, raw secret/route data 외부 publish 금지 |
| Adopt carefully | signer simulation evidence | revert/gas waste 감소 가능 | policy purity 유지, pre-broadcast or prelive layer |
| Adopt after research | Keystore V3 backend | at-rest protection은 순수 기술 가치가 큼 | signer daemon internal only, password source secure, no app-process key widening |
| Defer | Paymaster sponsorship research | BNB source는 sponsorship RPC wrapper로 확인되며 full UserOp stack은 아님 | real gas bottleneck, sponsor availability, fallback and policy evidence |
| Defer | signed off-chain intent anchor | 단일 operator 모델에서는 과함 | 외부 validator/multi-operator/audit requirement 발생 시 |
| Reject | BNBAgent `on_job` runtime model | LLM/runtime execution 경계 위반 | 없음 |
| Reject | public job execution endpoint | dashboard/read-only 원칙 위반 | 없음 |
| Reject | UMA as payback proof | BTC L1 delivery proof 대체 불가 | 없음 |
| Reject | ERC-8004 reputation as cap evidence | sybil/reputation signal이 realized PnL proof 아님 | 없음 |
| Reject | live plugin auto-discovery | caps-as-code, committed strategy registry 위반 | 없음 |
| Reject | raw audit IPFS publish | privacy/secret/route leakage 위험 | 없음 |

## 향후 계획

아래 계획은 runtime phase gate가 아니다. 실행 여부는 계속 committed config, caps, deterministic policy, signer approval, kill-switch, receipt evidence가 결정한다.

### Phase 0: 보고서 정정과 연구 기준 고정

목표: 세 보고서의 결론을 하나의 운영 가능한 기준으로 정리한다.

작업:
1. 이 문서를 canonical synthesis로 사용한다.
2. `applicability-report`의 P0/P1 표현은 "가설"로만 취급한다.
3. 향후 BNBAgent 관련 문서에는 다음 문장을 고정한다: "BNBAgent SDK의 runtime commerce model은 BOB Claw live execution path에 직접 채택하지 않는다. 단, 순수 engineering pattern은 BNB/testnet status와 분리해 평가한다."
4. ROI 숫자는 benchmark 전까지 claim 금지로 표시한다.

검증:
- docs-only 변경이면 `npm run graph:focus -- status`.

### Phase 1: nonce underpriced gap 수정

목표: signer broadcast path에서 `replacement transaction underpriced`를 already-broadcast/nonce-conflict 계열로 인식하게 한다.

파일:
- Modify: `src/executor/signer/evm-local-signer.mjs`
- Modify: `test/evm-local-signer.test.mjs`

작업:
1. 실패 테스트를 먼저 추가한다. `broadcastError: new Error("replacement transaction underpriced")`일 때 `broadcastSignedIntent()`가 signed envelope hash를 accepted result로 반환하는지 고정한다.
2. `isLikelyAlreadyBroadcast()` regex에 `replacement transaction underpriced`를 추가한다.
3. 기존 `transaction-submit` classifier와 의미가 충돌하지 않는지 확인한다.

검증:
- `node --test test/evm-local-signer.test.mjs test/transaction-submit.test.mjs`
- signer/policy 영향 우려가 있으면 `node --test test/executor-signer-client.test.mjs test/executor-policy-index.test.mjs`

위험:
- 낮음. 기존 raw tx classifier에는 이미 해당 문자열이 있으므로 signer path alignment 성격이다.

### Phase 2: Multicall3 read-only design

목표: BOB Claw의 portfolio/protocol read layer에 안전한 batch read 기반을 만든다.

파일 후보:
- Create: `src/lib/multicall3.mjs`
- Create: `test/multicall3.test.mjs`
- Create: `docs/research/multicall3-gateway-destination-matrix-2026-05.md`
- Later modify: `src/executor/realtime-portfolio.mjs`
- Later modify: `src/treasury/inventory-watcher.mjs`
- Later modify: `src/protocol-readers/*`

설계 원칙:
1. API는 `multicall3Read({ provider, calls, batchSize, allowFailure })`.
2. 반환은 반드시 input order를 보존하는 `{ ok, value, error }[]`.
3. Multicall3 contract missing, RPC reject, decode failure는 silent skip 금지.
4. chain별 `eth_getCode(0xcA11...)` 확인 전에는 direct read fallback 유지.
5. 이 helper는 read-only다. policy approval이나 cap graduation 근거로 직접 사용하지 않는다.

작업:
1. 11개 official Gateway destinations의 Multicall3 code existence matrix를 만든다.
2. helper unit test를 mock provider로 작성한다.
3. direct-read fallback contract를 테스트로 고정한다.
4. 첫 적용 대상은 `realtime-portfolio`의 ERC20 balance batch read다.
5. 두 번째 적용 대상은 protocol readers의 known-position state refresh다.

검증:
- `node --test test/multicall3.test.mjs test/account-state.test.mjs test/whole-wallet-scan.test.mjs`
- 적용 후 `node --test test/treasury-holdings-slice.test.mjs test/protocol-readers.test.mjs`

성공지표:
- RPC call count와 latency를 before/after로 기록한다.
- 절감률은 측정 전 claim 금지.

### Phase 3: progressive visibility scan

목표: boot 직후 누락 포지션을 줄이고, stale/error 상태를 dashboard/report에서 볼 수 있게 한다.

파일 후보:
- Modify: `src/protocol-readers/registry.mjs`
- Modify: `src/protocol-readers/spec.mjs`
- Modify: `src/executor/health/position-monitor-loop.mjs`
- Modify: `src/treasury/inventory-watcher.mjs`
- Test: `test/protocol-reader-registry.test.mjs`
- Test: `test/protocol-readers-bootstrap.test.mjs`
- Test: `test/position-action-engine.test.mjs`

작업:
1. startup baseline scan과 incremental refresh를 분리한다.
2. known position set은 full scan으로 확인하고, 이후 last-seen block/timestamp/index 기반으로 refresh한다.
3. 모든 reader 결과는 ok/error envelope으로 유지한다.
4. silent skip legacy path는 dashboard/report-visible error로 전환한다.
5. position health monitor는 action descriptor만 emit한다. rebalance intent creation은 계속 Capital Manager 소유다.

검증:
- `node --test test/protocol-reader-spec.test.mjs test/protocol-reader-registry.test.mjs test/protocol-readers.test.mjs`
- `node --test test/protocol-position-marker.test.mjs test/protocol-position-marks-slice.test.mjs test/report-portfolio-coverage.test.mjs`
- `node --test test/position-action-engine.test.mjs test/phase4-cli.test.mjs`

### Phase 4: private proof manifest

목표: BNBAgent의 deliverable hash idea를 BOB Claw의 private, append-only proof manifest로 번역한다.

파일 후보:
- Create: `src/proof/manifest.mjs`
- Create: `test/proof-manifest.test.mjs`
- Modify: `src/executor/payback/scheduler.mjs`
- Modify: `src/executor/ingestor/execution-receipt-ingest.mjs`
- Modify: `src/strategy/radar/portable-packet-builder.mjs`
- Data output: `data/proof-manifests.jsonl` 또는 scoped existing receipt store

설계 원칙:
1. raw audit log를 외부에 올리지 않는다.
2. manifest에는 artifact hash, schema version, local source pointer, redaction status, validation verdict만 둔다.
3. append-only record만 추가한다. 과거 logs/data rewrite 금지.
4. payback manifest는 source tx, Gateway order id, Bitcoin L1 txid, destination balance delta를 묶되, delivered 판단은 기존 receipt proof가 한다.
5. on-chain anchor는 처음에는 하지 않는다. BOB L2 anchor는 privacy/cost/use-case 검증 후 별도 PR.

검증:
- `node --test test/proof-manifest.test.mjs`
- `node --test test/payback-scheduler.test.mjs test/payback-accumulator.test.mjs test/payback-dashboard.test.mjs`
- `node --test test/phase35-cli.test.mjs`

### Phase 5: dev/research task lifecycle

목표: BNBAgent APEX job lifecycle을 live execution이 아니라 coding/research provenance로 번역한다.

파일 후보:
- Modify: `src/strategy/dev-agent-automation-bridge.mjs`
- Modify: `src/llm/output-validator.mjs`
- Create or modify docs: `docs/ai-agent-operations.md`
- Test: `test/auto-research-pipeline.test.mjs`
- Test: `test/codex-llm.test.mjs`

추천 상태:
- `proposed`
- `scoped`
- `submitted`
- `validated`
- `accepted`
- `rejected`

필수 필드:
- `taskId`
- `sourceHash`
- `outputHash`
- `validatorVerdict`
- `requiredTests`
- `writeScope`
- `forbiddenRuntimeAuthority`
- `runtimeAuthority: "none"`
- `requiresCommittedDiff: true`

금지:
- task lifecycle을 live promotion gate로 사용하지 않는다.
- LLM output이 cap, signer, payback timing, strategy autoExecute를 runtime side channel로 바꾸지 않는다.

검증:
- `node --test test/codex-llm.test.mjs test/phase35-cli.test.mjs test/auto-research-pipeline.test.mjs`

### Phase 6: signer simulation evidence without policy impurity

목표: revert/gas waste를 줄이되 policy engine purity를 깨지 않는다.

파일 후보:
- Modify: `src/evm/transaction-read.mjs`
- Modify: `src/executor/signer/evm-local-signer.mjs`
- Modify: `src/executor/signer/daemon.mjs`
- Test: `test/transaction-read.test.mjs`
- Test: `test/evm-local-signer.test.mjs`
- Test: `test/executor-signer-client.test.mjs`

방향:
1. `simulateTransactionCall()`은 이미 있다. 이를 signer pre-broadcast or preview evidence layer와 연결하는 설계를 먼저 문서화한다.
2. `evaluateIntentPolicies()` 내부에는 RPC를 넣지 않는다.
3. simulation failure는 signer audit에 rejected/errored reason으로 남긴다.
4. state-dependent tx는 simulation success 후에도 stale quote, gas, slippage, deadline checks를 유지한다.

검증:
- `node --test test/transaction-read.test.mjs test/evm-local-signer.test.mjs`
- `node --test test/executor-signer-client.test.mjs test/executor-policy-index.test.mjs`

### Phase 7: Keystore V3 signer backend research

목표: EVM key at-rest protection을 강화할 수 있는지 signer daemon 내부 backend로만 검토한다.

파일 후보:
- Create: `docs/research/evm-keystore-v3-signer-backend-design.md`
- Later create: `src/executor/signer/evm-keystore-v3.mjs`
- Later create: `src/lib/secure-write.mjs`
- Later test: `test/evm-keystore-v3-signer.test.mjs`

원칙:
1. 기존 `BURNER_EVM_KEY_PATH` path indirection은 유지한다.
2. keystore password는 OS keychain 또는 path-indirected secret로만 읽는다.
3. plaintext private key는 LLM context, logs, CLI args, dashboard에 절대 노출하지 않는다.
4. backend는 signer daemon 내부에서만 wallet object를 만든다.
5. BTC signer는 별도 설계다.

검증:
- design only: `npm run graph:focus -- status`
- implementation: `node --test test/evm-keystore-v3-signer.test.mjs test/evm-local-signer.test.mjs`

### Phase 8: deferred research bucket

아래는 지금 구현하지 않는다.

Paymaster sponsorship:
- 트리거: 실제 gas float bottleneck, failed gas cost, chain-specific sponsor availability evidence가 생길 때.
- 선행조건: sponsorship RPC semantics, chain support, fallback path, signer audit semantics, policy failure handling.
- 주의: 현재 확인한 BNBAgent source는 `pm_isSponsorable`와 `eth_sendRawTransaction` wrapper 성격이다. full ERC-4337 UserOperation/bundler/EntryPoint stack으로 가정하지 않는다.

Signed intent anchoring:
- 트리거: 외부 validator, multi-operator, third-party audit requirement가 생길 때.
- 선행조건: EIP-712 schema, privacy filter, replay/deadline policy.

Provider/Strategy generalized abstraction:
- 트리거: protocol binding duplication이 실제 maintenance blocker로 측정될 때.
- 선행조건: reader coverage, exit executor, health policy, cap registry가 함께 움직이는 migration plan.

ERC-8004 identity:
- 트리거: 외부 agent discovery가 product requirement가 될 때.
- 선행조건: reputation is metadata only. cap/evidence/policy input 금지.

UMA optimistic oracle:
- 트리거 없음. BOB Claw payback proof에는 부적합하다.

## 실행 순서 추천

1. Phase 1 nonce underpriced gap부터 처리한다. 작고, 위험이 낮고, BNBAgent 비교에서 실제 발견된 gap이다.
2. Phase 2 Multicall3 design을 시작한다. 단 첫 PR은 helper와 tests까지만 두고, portfolio integration은 benchmark 후 별도 PR로 나눈다.
3. Phase 4 proof manifest를 payback dashboard/report와 연결한다. raw external publish 없이 local hash manifest만 둔다.
4. Phase 5 dev/research lifecycle을 Codex harness에 붙인다. live execution authority는 계속 none이다.
5. Phase 6 signer simulation은 설계 후 한다. policy pure boundary를 넘지 않는다.
6. Phase 7 Keystore V3는 research doc부터 둔다. 구현은 key handling UX가 확정된 뒤 진행한다. 이는 BNB/testnet 여부와 무관한 signer-hardening 후보로 평가한다.

## 최종 운영 가드레일

- BNBAgent에서 차용하는 모든 패턴은 BOB Claw operating law 아래에서 재해석한다.
- LLM, job server, plugin discovery, external oracle은 signer/policy/cap/payback decision authority를 갖지 않는다.
- BTC-first accounting과 payback settlement proof는 바뀌지 않는다.
- 모든 PnL, ROI, RPC 절감, gas 절감 claim은 measured benchmark나 receipt evidence 전에는 가설로만 기록한다.
- 표시 APR, reputation, testnet success, SDK marketing copy는 strategy evidence가 아니다.
