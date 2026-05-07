# BNBAgent SDK에서 BOB Claw가 배울 점

> Status: source-grounded lessons input. The implementation boundary and final
> adoption order are controlled by
> `docs/research/bnbagent-sdk-bobclaw-deep-review-plan-2026-05-07.md` and
> `docs/superpowers/plans/2026-05-07-bnbagent-pattern-adoption.md`.

작성일: 2026-05-07  
범위: [bnb-chain/bnbagent-sdk](https://github.com/bnb-chain/bnbagent-sdk) 최신 `main` 공개 소스, ERC-8004/EIP-8183 원문, BNB Chain 발표 글, BOB Claw 로컬 아키텍처 대조

## 결론

BNBAgent SDK는 BOB Claw의 런타임 트레이더로 가져올 물건이 아니다. 현재 README가 명시하듯 BSC Testnet 중심이고 production 사용을 금지하고 있으며, 기본 편의 경로는 FastAPI 서버가 공개 job을 받아 wallet provider로 서명하고, LLM callback이 결과를 만들며, IPFS deliverable과 UMA optimistic oracle로 정산을 마무리하는 agent-commerce SDK다. 이 모델은 BOB Claw의 BTC-first payback, caps-as-code, deterministic policy, isolated signer, append-only receipt proof 원칙과 직접 충돌한다.

하지만 “런타임 자금 실행”이 아니라 “개발/리서치 작업의 provenance와 증거 패킷”으로 번역하면 차용할 가치가 있다. 핵심은 APEX의 job lifecycle, negotiation hash anchoring, deliverable hash, startup/progressive scan, module registry, budget validation, nonce/retry 패턴을 BOB Claw의 dev-agent, radar packet, payback proof, protocol visibility 쪽에 제한적으로 적용하는 것이다.

## BNBAgent SDK 핵심 구조

BNBAgent SDK는 크게 `erc8004`, `apex`, `wallets`, `storage`, `core`로 나뉜 Python SDK다. SDK의 모듈 레지스트리는 built-in `erc8004`와 `apex` 모듈을 discover하고 dependency validation 및 topological initialization을 수행한다. 관련 소스는 [ARCHITECTURE.md](https://github.com/bnb-chain/bnbagent-sdk/blob/main/ARCHITECTURE.md)와 [bnbagent/core/registry.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/registry.py)다.

ERC-8004는 agent identity/discovery 레이어다. SDK README는 agent별 `agentId`, URI profile, metadata, BSC testnet MegaFuel sponsored registration을 설명한다. APEX와 ERC-8004는 독립적이며, APEX provider는 ERC-8004 등록 없이도 임의 wallet address로 동작할 수 있다. 참고: [README](https://github.com/bnb-chain/bnbagent-sdk/blob/main/README.md), [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004).

APEX는 ERC-8183 job lifecycle/payment escrow, UMA OOv3 evaluator, off-chain HTTP negotiation을 묶는다. 상태 흐름은 `OPEN -> FUNDED -> SUBMITTED -> COMPLETED/REJECTED/EXPIRED`에 가깝고, `APEXClient`는 create/fund/submit/complete/reject/refund 계열 함수를 감싼다. 참고: [bnbagent/apex/client.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/client.py), [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183).

Negotiation layer는 request/response를 canonical JSON으로 만들고 `keccak256` hash를 계산한다. accepted result는 compact `Job.description`에 `negotiation_hash`와 `provider_sig`를 넣을 수 있다. 이는 off-chain 합의 조건의 사후 변조를 탐지하기 위한 anchoring layer다. 참고: [bnbagent/apex/negotiation.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/negotiation.py).

`create_apex_app()`는 FastAPI app을 구성하고 `/negotiate`, `/submit`, `/job/{id}`, `/job/{id}/response`, `/job/{id}/verify`, `/status`, `/health`, 그리고 `on_job`이 있을 때 `/job/execute`를 제공한다. `on_job`이 있으면 startup scan으로 pending funded jobs를 자동 처리할 수 있다. 참고: [bnbagent/apex/server/routes.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/server/routes.py), [bnbagent/apex/server/job_ops.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/server/job_ops.py).

## BOB Claw 관점의 차용 후보

### 1. Dev-agent task lifecycle 표준화

APEX의 job lifecycle은 BOB Claw live execution에는 부적합하지만, dev/research task에는 잘 맞는다. 현재 BOB Claw의 [dev-agent automation bridge](../../src/strategy/dev-agent-automation-bridge.mjs)는 이미 `ready_for_dev_agent`, `artifactOnly`, `requiresCommittedDiff`, `runtimeAuthority: none` 같은 안전 언어를 갖고 있다. 여기에 APEX식 lifecycle을 report-only 상태로 붙이면 작업 산출물 추적이 더 선명해진다.

추천 상태:

- `proposed`: radar/report가 작업 후보를 제안
- `scoped`: write scope, required tests, forbidden runtime authority 확정
- `submitted`: subagent 또는 coding LLM이 patch/report를 제출
- `validated`: output-validator, tests, human/Codex review 통과
- `accepted`: committed diff 또는 report artifact로 수용
- `rejected`: safety, evidence, test, policy 이유로 거절

주의점: 이 상태는 live promotion gate가 아니다. 실행 여부는 계속 committed config, `evaluateIntentPolicies()`, signer daemon, kill-switch, receipt evidence가 결정한다.

### 2. Evidence/deliverable hash manifest

BNBAgent는 deliverable을 IPFS 등에 저장하고 content hash를 chain에 올리는 구조다. BOB Claw는 raw audit/history를 외부 공개하면 안 되므로 IPFS를 그대로 쓰면 안 된다. 대신 해시 manifest 패턴은 유용하다.

적용 후보:

- [radar portable packet](../../src/strategy/radar/portable-packet-builder.mjs): opportunity packet에 `sourceHash`, `evidenceBundleHash`, `costLedgerHash`, `receiptProofHash`를 추가하는 방향
- [Codex output validator](../../src/llm/output-validator.mjs): LLM 산출 diff/report의 hash와 validator verdict를 append-only audit에 남기는 방향
- [payback scheduler](../../src/executor/payback/scheduler.mjs): payback period마다 source tx, Gateway order, Bitcoin L1 balance delta를 묶은 proof manifest hash를 기록하는 방향

주의점: 기존 `logs/*.jsonl`과 receipt artifacts는 append-only다. 해시 manifest는 새 record를 추가해야지 과거 로그를 재작성하면 안 된다.

### 3. Startup scan과 progressive scan 패턴

BNBAgent의 `APEXJobOps.get_pending_jobs()`는 첫 호출에 Multicall3 batch scan으로 기존 job을 확인하고, 이후 `jobCounter`와 pending OPEN IDs만 progressive scan한다. 이 발상은 BOB Claw의 protocol/position visibility와 health monitor에 유용하다.

적용 후보:

- protocol position readers: fresh boot 때 전체 known position set을 읽고, 이후 변화 가능성이 있는 position만 재확인
- inbound inventory watcher: 전체 snapshot과 delta scan을 분리
- payback proof collector: period 시작 시 baseline snapshot, 이후 Gateway/order/BTC tx만 incremental follow
- signer/capital monitor: stale heartbeat와 last-seen index를 함께 기록

주의점: BOB Claw에서 scan 결과는 execution approval이 아니라 observation/evidence다. 누락 또는 RPC 실패는 silent skip이 아니라 explicit error envelope로 남아야 한다.

### 4. Budget validation을 EV/cost gate로 번역

BNBAgent의 `budget >= service_price` 검증은 단순하지만, BOB Claw에는 “표시 APR이 아니라 realized net after measured cost”라는 원칙으로 번역할 수 있다. 이미 [sizing.mjs](../../src/config/sizing.mjs), [EV gate](../../src/executor/policy/ev-gate.mjs), [radar router](../../src/strategy/radar/radar-candidate-router.mjs)가 이 방향을 갖고 있다.

개선 아이디어:

- radar/campaign 후보의 `expectedNetPnlUsd`, p90/p99 cost, reward-token haircut, claim/swap cost를 “job budget 검증”처럼 한 화면에서 판정
- no-tx rejection과 realized loss를 분리해 ladder pause/retry 이유를 더 명확히 기록
- USD projection 옆에 sats/BTC-relative report field를 항상 유지

주의점: 이 검증은 sizing cap을 올리는 장치가 아니다. cap graduation은 AGENTS.md의 receipt-backed 조건과 committed config diff가 필요하다.

### 5. Module registry 감각을 extension surface에 제한 적용

BNBAgent의 `ModuleRegistry`는 protocol module discovery와 dependency validation을 제공한다. BOB Claw에는 이미 config registry와 strategy catalog가 많으므로 일반 plugin auto-discovery를 도입하면 오히려 위험하다. 다만 read-only/report-only extension에는 레지스트리 감각이 유용하다.

적용 후보:

- protocol readers registry: reader가 `ok/error envelope`, freshness, positionId schema를 만족하는지 검증
- dev-agent role registry: role, write scope, safe commands, forbidden runtime authority를 선언형으로 관리
- proof collector registry: payback/source tx/Gateway order/BTC delta proof collector를 dependency order로 실행

주의점: live strategy module을 entry point auto-discovery로 자동 등록하면 안 된다. 전략, caps, official Gateway destination scope는 계속 committed config가 주인이다.

### 6. Wallet provider abstraction은 signer backend 설계 참고로만 사용

BNBAgent의 wallet provider는 `address`, `sign_transaction()`, `sign_message()`를 추상화한다. BOB Claw도 [signer interface](../../src/executor/signer/signer-interface.mjs), [EVM local signer](../../src/executor/signer/evm-local-signer.mjs), [BTC local signer](../../src/executor/signer/btc-local-signer.mjs)를 갖고 있으므로 Hardware/MPC signer adapter 설계에는 참고할 수 있다.

주의점: BNBAgent의 app-process keystore나 `.env PRIVATE_KEY` 방식은 BOB Claw live path에 직접 도입하면 안 된다. BOB Claw 키는 signer daemon 내부에만 있고 env/path indirection만 허용된다.

## 구체적인 엔지니어링 후보

### P1-A. Multicall3 batch reader

BNBAgent의 `core/multicall.py`와 APEX startup scan은 broad event log scan 대신 batch read를 사용해 RPC 부담을 낮춘다. BOB Claw 로컬 `src/`에는 현재 Multicall3 helper가 없고, 관련 언급은 계획 문서뿐이다. 따라서 read-only inventory, protocol reader, position visibility 쪽에 `src/lib/multicall3.mjs` 같은 작은 helper를 두는 후보가 있다.

권장 API 방향:

- `multicall3Read({ provider, calls, batchSize, allowFailure })`
- 반환값은 `{ ok, value, error }[]` envelope
- Multicall3가 없거나 RPC가 실패하는 체인은 기존 direct read fallback 유지
- partial failure는 silent skip 금지, position/account 단위 error로 노출

이 후보는 signer, caps, policy를 건드리지 않는 read-only 성능/관측성 개선이다. 구현 전에는 11개 official Gateway destination별 Multicall3 배포 여부와 RPC별 `eth_call` 제한을 확인해야 한다.

### P1-B. Keystore V3 signer backend 연구

BNBAgent의 `EVMWalletProvider`는 Keystore V3 JSON을 `~/.bnbagent/wallets/<address>.json`에 저장하고, 파일/디렉터리 권한을 제한한다. BOB Claw의 live path에 BNBAgent wallet을 직접 쓰면 안 되지만, EVM signer daemon 내부 backend로 encrypted-at-rest key loading을 추가하는 방향은 검토할 가치가 있다.

가능한 방향:

- 기존 `EvmLocalKeySigner`와 `BURNER_EVM_KEY_PATH` 경로는 유지
- 별도 backend로 `EVM_KEYSTORE_PATH`와 password source를 signer daemon 내부에서만 읽음
- ethers v6의 encrypted JSON wallet 기능을 사용하고, password는 OS keychain 또는 path-indirected secret으로만 제공
- BTC signer는 별도 설계로 분리

주의점: password 파일을 평문으로 두면 개선 폭이 줄어든다. 또한 메모리 내 wallet 객체에는 여전히 signing material이 있으므로 signer daemon isolation과 kill-switch/policy boundary가 핵심 방어선이다.

### P2. Nonce error coverage audit

BNBAgent의 `NonceManager`는 `nonce too low`, `already known`, `replacement transaction underpriced` 계열 오류를 nonce resync 신호로 본다. BOB Claw의 [EVM local signer](../../src/executor/signer/evm-local-signer.mjs)는 이미 `already known`, `already imported`, `known transaction`, `nonce too low`를 처리하지만 `replacement transaction underpriced` 문구는 별도 매치하지 않는다.

이것은 작은 audit/fix 후보로 보인다. 실제 구현 시에는 `test/evm-local-signer.test.mjs`에 mock error를 추가해 해당 오류가 provider fallback 또는 nonce reset 판단에 어떤 영향을 주는지 먼저 고정해야 한다.

## 명확히 피해야 할 것

1. Runtime LLM job execution: BNBAgent의 `on_job` 예시는 client-provided job description을 LLM에 넘길 수 있다. BOB Claw에서는 LLM이 trade, payback, cap, signer 결정을 하면 안 된다.

2. Public `/job/execute` 스타일 execution endpoint: BOB Claw dashboard/public surface는 read-only여야 한다. 외부 HTTP 요청이 capital manager 또는 signer path를 자극하면 안 된다.

3. App-held keys: BNBAgent의 편의 경로는 private key import, encrypted keystore, wallet password를 app lifecycle에 둔다. BOB Claw live funds에는 signer daemon 경계가 깨지는 위험이다.

4. On-chain reputation as policy evidence: ERC-8004 원문도 Sybil/spam 가능성을 명시한다. Reputation은 discovery metadata로만 쓰고, cap graduation이나 token/protocol whitelist 근거로 쓰면 안 된다.

5. UMA optimistic oracle as settlement proof: APEX의 30분 liveness와 48-72h DVM dispute는 외부 작업 평가에는 쓸 수 있지만 BOB Claw payback delivery, unwind success, realized PnL proof를 대체하지 못한다.

6. ERC-8183 hooks as capital mover: EIP-8183은 hooks의 gas/revert/외부 로직 결합 위험을 경고한다. BOB Claw capital movement는 Capital Manager와 deterministic policy 밖으로 나가면 안 된다.

7. BSC testnet maturity overclaim: BNB Chain blog는 BNBAgent SDK를 testnet live, mainnet coming soon으로 소개한다. Testnet escrow, sponsored gas, test token flow는 live capital evidence가 아니다.

## 우선순위 제안

P0, 문서/리포트 레이어: dev-agent task lifecycle 용어를 확정하고 `docs/ai-agent-operations.md` 및 dev-agent bridge report에 반영한다. 실행 권한 없음, committed diff 필요, signer/policy bypass 금지를 명시한다.

P1, 증거 패킷 레이어: radar portable packet과 payback proof에 manifest hash 필드를 추가하는 설계를 만든다. 산출물은 local/private artifact hash 위주이고, raw route edge나 wallet inventory를 외부 publish하지 않는다.

P1, visibility 레이어: protocol reader와 position monitor에 startup baseline + progressive delta scan 패턴을 검토한다. 목표는 RPC 비용 절감보다 “부팅 직후 누락 포지션 없음”과 “stale/error가 보이는 상태”다.

P2, signer backend 연구: BNBAgent wallet provider를 참고해 hardware/MPC signer adapter interface를 비교 검토한다. 구현하더라도 signer daemon 내부 backend로만 추가한다.

P2, nonce/retry audit: `replacement transaction underpriced` 같은 tx replacement 계열 오류가 stuck nonce 복구 path에 들어가는지 테스트로 고정한다.

채택하지 않을 항목: APEX escrow를 payback lane으로 대체, ERC-8004 reputation으로 cap 자동 상향, public job execution endpoint, BNBAgent SDK Python wallet을 live signer로 사용, UMA oracle verdict를 realized PnL/settlement proof로 사용.

## BOB Claw에 대한 개선 체크리스트

- Dev/research 산출물마다 `taskId`, `sourceHash`, `outputHash`, `validatorVerdict`, `requiredTests`, `runtimeAuthority: none`을 남기는 report-only task record를 설계한다.
- Radar 후보 packet에 reward proof뿐 아니라 “terms/proof/dispute-or-review status”와 evidence bundle hash를 추가한다.
- Payback period proof에 source-side tx, Gateway order id, Bitcoin L1 balance delta를 묶은 manifest hash를 추가한다.
- Protocol readers는 startup full scan과 incremental refresh를 분리하고, every accounted live position에 `positionId`, `bindingKind`, `protocolId`, freshness/confidence를 유지한다.
- Read-only EVM balance/position reads에 Multicall3 helper를 도입할지 chain support matrix부터 만든다.
- Signer daemon의 nonce/retry/heartbeat surface를 BNBAgent `NonceManager`와 비교해, concurrent submission 시 재동기화 audit가 충분한지 점검한다.

## 소스

- [BNBAgent SDK README](https://github.com/bnb-chain/bnbagent-sdk/blob/main/README.md)
- [BNBAgent SDK ARCHITECTURE.md](https://github.com/bnb-chain/bnbagent-sdk/blob/main/ARCHITECTURE.md)
- [bnbagent/apex/server/job_ops.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/server/job_ops.py)
- [bnbagent/apex/server/routes.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/server/routes.py)
- [bnbagent/apex/negotiation.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/apex/negotiation.py)
- [bnbagent/core/registry.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/registry.py)
- [bnbagent/core/multicall.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/multicall.py)
- [bnbagent/core/nonce_manager.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/core/nonce_manager.py)
- [bnbagent/wallets/evm_wallet_provider.py](https://github.com/bnb-chain/bnbagent-sdk/blob/main/bnbagent/wallets/evm_wallet_provider.py)
- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8183: Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183)
- [BNB Chain Blog: BNBAgent SDK](https://www.bnbchain.org/en/blog/bnbagent-sdk-the-first-live-erc-8183-implementation-for-onchain-ai-agents)
