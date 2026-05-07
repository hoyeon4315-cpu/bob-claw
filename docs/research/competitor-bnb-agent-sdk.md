# 경쟁 분석: bnb-chain/bnbagent-sdk vs BOB Claw

> Status: comparison input. Use this alongside
> `docs/research/bnbagent-sdk-bobclaw-deep-review-plan-2026-05-07.md`; do not
> promote any BNBAgent pattern into live execution from this document alone.

- 출처: https://github.com/bnb-chain/bnbagent-sdk (Python, v0.2.1, BSC testnet only, 별 ~10)
- 검토일: 2026-05-07
- 목적: BNB Agent SDK 아키텍처와 구현을 BOB Claw 운영 룰(`AGENTS.md`)과 정면 대조하고, BOB Claw로 포팅할 가치가 있는 기술/패턴을 추려 우선순위와 구체 작업 단위를 잡는다.

## 1. 도메인 비교 — 다른 문제를 풀고 있다

| 축 | BNB Agent SDK | BOB Claw |
|---|---|---|
| 언어/런타임 | Python (FastAPI) | Node.js ES Modules (`.mjs`) |
| 프로덕트 | "AI agent가 on-chain에서 paid job 수주/배달/정산"하는 마켓플레이스 인프라 | 자기자본 BTC를 multichain DeFi로 굴려 BTC L1 wallet으로 payback하는 무인 실행기 |
| Agent 정의 | identity(ERC-8004) + paid job 콜백(`on_job(job) -> str`) | proposer → policy → signer 분리 deterministic 파이프라인 |
| LLM 실행 경로 | `on_job` 콜백 안에서 자유. SDK가 LLM 사용 강제/금지 안 함 | **LLM은 실행 경로 차단**. 코딩 세션 LLM만 committed diff로 코드/설정 수정 가능 (`AGENTS.md` Execution Safety) |
| Identity / Discovery | ERC-8004 on-chain 등록 | 단일 운영자 모델, 다중 사용자/금고화 out-of-scope |
| Commerce / Escrow | APEX (ERC-8183) escrow + UMA OOv3 30분 dispute window | 외부 고객 없음. 정산은 운영자 본인 BTC L1 |
| 체인 | BSC Testnet (97), BSC Mainnet 예정 | 11개 Gateway destination + Bitcoin L1 (`AGENTS.md` Core Context) |
| 키 보관 | Keystore V3 (scrypt + AES-128-CTR), `~/.bnbagent/wallets/<address>.json` | `BURNER_EVM_KEY_PATH` / `BURNER_BTC_KEY_PATH` 환경변수 path indirection |
| 리스크 컨트롤 | budget < price reject, job expiry, SSRF guard, UMA dispute | per-tx/per-day/per-chain cap, kill-switch 파일, HF/IL/auto-kill triggers, drawdown lock |
| 전략 추상화 | 없음 — 콜백 1개 | strategy module + protocol-binding-registry + capital manager + payback engine |
| Settlement proof | UMA dispute 결착 | source tx + destination balance delta 양쪽 필수 (Operator Memory) |
| 성숙도 | testnet, 미배포 | 라이브 자본 운용 중, 다수 라이브 receipt |

결론: 도메인 자체가 다르다. ERC-8004 identity, APEX commerce, UMA dispute, on_job 콜백 모델은 **BOB Claw에 가져올 가치 없음**. 특히 콜백 안에서 LLM 자유 실행 모델은 `AGENTS.md` "No LLM in trade execution decision path"와 정면 충돌하므로 절대 차용 금지.

## 2. 모듈 인벤토리 (BNB SDK)

```
bnbagent/
  apex/            # commerce: client, server, negotiation, evaluator, service_record
  core/            # contract_mixin, multicall, nonce_manager, paymaster, registry
  erc8004/         # on-chain identity registration
  storage/         # IPFS / local file backends
  wallets/         # evm_wallet_provider (Keystore V3), mpc_wallet_provider (stub)
  utils/, config.py, constants.py, exceptions.py, main.py
```

직접 분석한 파일:
- `wallets/evm_wallet_provider.py` (11.6 KB)
- `wallets/mpc_wallet_provider.py` (1.8 KB) — 전부 `NotImplementedError` 스텁
- `core/multicall.py` (6.4 KB)
- `core/paymaster.py` (8.1 KB)
- `core/registry.py` (6.4 KB)
- `core/nonce_manager.py` (4.3 KB)
- `apex/negotiation.py` (26.2 KB)

## 3. 포팅 후보 — 가져올 만한 것 3개

### P1 — Multicall3 배치 리더 (큰 값)

**BNB SDK 패턴**

- 캐노니컬 Multicall3 컨트랙트 `0xcA11bde05977b3631167028862bE2a173976CA11` (모든 EVM 체인 동일 주소).
- `aggregate3(calls, allowFailure=true)` 호출 → `(success, returnData)[]` 반환. 실패 콜은 `(False, None)`로 반환되어 배치 전체는 살아남음 (graceful degradation).
- 디폴트 배치 크기 100, 청크 페이지네이션은 단순 range slicing.

```python
def multicall_read(
    w3, contract, function_name, call_args_list,
    batch_size=100, allow_failure=True,
) -> list[tuple[bool, Any]]
```

**BOB Claw 현 상태**

- `src/` 어디에도 Multicall3 사용 흔적 없음 (`grep -rln "multicall\|0xcA11" src/` 0건).
- `src/executor/realtime-portfolio.mjs` (7.5 KB)는 직접 RPC `balanceOf` 호출.
- `src/treasury/inventory-watcher.mjs`, `src/protocol-readers/`, `src/treasury/protocol-position-*` 모두 체인×토큰 곱만큼 RPC 호출.
- 운영자 메모리 기준 wallet은 13체인 분포 (Operator Memory 2026-05-06). 한 스냅샷에 수백 RPC 호출 가능성.

**이식**

- `src/lib/multicall3.mjs` 신설. ethers v6 `Contract` + `staticCall`로 직접 호출 가능. 외부 lib 불필요.
- API: `multicall3Read({ provider, calls, batchSize=100, allowFailure=true })` → `{ ok, value, error }[]`.
- 호출별 `ok`/`error` envelope으로 매핑 (`AGENTS.md` Component 12 "ok/error envelope" 룰과 정합).
- 적용 대상 1차: `realtime-portfolio.mjs`, `treasury/inventory-watcher.mjs`.
- 회귀 안전 위해 동일 입력→동일 출력 fixture 테스트 추가.

**기대 효과**

- 인벤토리 스냅샷 RPC 호출 수 50–100×↓.
- 무료 RPC quota 보존, snapshot latency 단축.

**리스크**

- 일부 RPC가 Multicall3 deploy 안 되어 있을 수 있음 (체인별 사전 확인). 누락된 체인은 fallback path 유지.
- partial failure semantics를 호출자가 명시적으로 처리하도록 강제하면 silent miss 위험 없음.

### P1 — Keystore V3 EVM 서명자 백엔드

**BNB SDK 패턴**

```python
# encrypt
keystore = Account.encrypt(self._account.key, self._password)
# atomic write with 0o600
fd, tmp = tempfile.mkstemp(...); os.chmod(tmp, 0o600); os.replace(tmp, dst)

# decrypt
private_key = Account.decrypt(keystore, self._password)
self._account = Account.from_key(private_key)
```

- `eth_account.Account.encrypt`이 scrypt KDF + AES-128-CTR + HMAC을 내부에서 수행. MetaMask/Geth 호환 JSON.
- 패스워드는 생성자 인자로만 받음 (`if not password: raise ValueError`). env/프롬프트 결정은 호출자 책임.
- 메모리에는 `LocalAccount` 객체로만 보관. 명시적 zeroization은 없음.

**BOB Claw 현 상태**

- `src/executor/signer/evm-local-signer.mjs:1-2` ethers `^6.16.0` 사용.
- `BURNER_EVM_KEY_PATH`로 평문 hex 또는 mnemonic 경로 indirection (`AGENTS.md` Execution Safety).
- 디스크 도난 시 즉시 노출 위험. `AGENTS.md`는 "키는 signer 프로세스 안에서만, OS keystore 파일에서 로드"를 명시하지만 현 구현은 "OS 파일 시스템에 평문" 단계.
- ethers v6는 `Wallet.encryptKeystoreJson(password)`와 `Wallet.fromEncryptedJson(json, password)`을 표준 제공. 추가 의존성 0.

**이식**

- `src/executor/signer/evm-keystore-v3.mjs` 신설. `signer-interface.mjs`의 `SignerInterface`를 동일하게 구현 (`SequentialNonceManager` 등 기존 인프라 재사용).
- 부팅 흐름:
  1. `EVM_KEYSTORE_PATH` env가 가리키는 V3 JSON 로드.
  2. `EVM_KEYSTORE_PASSWORD_PATH` 또는 OS keychain에서 password 1회 로드.
  3. `Wallet.fromEncryptedJson` → 메모리 `Wallet` 객체.
  4. password 변수 즉시 `null` 처리.
- 신규 키 생성 CLI `npm run signer:keystore-create -- --address=<...>`:
  1. 평문 키 입력 또는 임시 random 생성.
  2. `Wallet.encryptKeystoreJson(password)`.
  3. 원자적 쓰기 (`tempfile + rename + chmod 0o600`)를 새 helper `src/lib/file-write.mjs`에 추가 또는 별도 `secure-write.mjs`.
- BTC signer (`btc-local-signer.mjs`)는 BIP38 또는 별도 PSBT 키 패스워드 기반 백엔드가 별 작업이라 본 PR scope 밖. EVM 단독으로 구현 후 BTC는 별 issue로 분리.
- 기존 `EvmLocalKeySigner`는 그대로 유지 (`SignerInterface` 스왑 가능 설계 활용).

**기대 효과**

- 디스크 at-rest 보호. 키 파일이 그대로 새도 패스워드 없이는 복호 불가.
- `AGENTS.md` "signer 인터페이스 스왑 가능, `HardwareSigner / MpcSigner`로 일줄 변경" 노선과 정합.

**리스크**

- 패스워드 운영. OS keychain (macOS Keychain, Linux secret-service) 통합 권장. 평문 password 파일은 안티패턴.
- 메모리 dump 시 `Wallet` 내부에 키 hex가 그대로 있음 — Python eth_account도 동일 한계라 수용 가능.

### P2 — Nonce manager 에러 패턴 audit

**BNB SDK 패턴**

```python
def handle_error(self, error: Exception, used_nonce: int) -> bool:
    # match: "nonce too low", "already known", "replacement transaction underpriced"
    # → resync from chain "pending", return True for retry
```

세 가지 에러 문자열을 매치하면 `eth_getTransactionCount(addr, "pending")`로 재동기화하고 retry 신호 반환.

**BOB Claw 현 상태**

- `src/executor/signer/evm-local-signer.mjs:226`에 `SequentialNonceManager`의 에러 매칭 정규식이 존재:
  ```javascript
  /already known|already imported|known transaction|nonce too low/iu
  ```
- 두 케이스(`already known`, `nonce too low`)는 커버. **`replacement transaction underpriced`는 미매치**.
- 이 케이스는 RBF/속도교체 충돌 시 발생. 매치 안 되면 stuck tx가 silent drop으로 남고 nonce gap 감지 늦어질 위험.

**이식**

- 정규식에 `replacement transaction underpriced` 추가. 1줄 수정.
- 회귀 테스트: `evm-local-signer.test.mjs`에 해당 에러 메시지 mock으로 nonce 재동기화 트리거되는지 검증.
- 이건 신규 PR이라기보다 짧은 audit + fix.

**리스크**

- 거의 0. 누락된 분기를 추가하는 것이라 기존 거동 영향 없음.

## 4. 검토했으나 보류

### ERC-4337 Paymaster (`core/paymaster.py`)

- `pm_isSponsorable` RPC + sponsored UserOp.
- 도입 비용: ERC-4337 EntryPoint, bundler, UserOp 빌더, 별도 paymaster 인프라.
- BOB Claw 현 거래량은 BSC 트래픽 적음. `maxFailedGasCost24hUsd` 캡 트리거 자주 없음.
- 가스가 실제 운영 비용 병목이 되거나 BSC 캠페인 라인이 활발해지면 재검토.
- **defer**.

### EIP-191 negotiation_hash + provider_sig (`apex/negotiation.py`)

- `keccak256(canonical JSON)` + EIP-191 personal sign + `quote_expires_at`.
- BOB Claw intent → policy → signer는 단일 프로세스 신뢰 모델. cryptographic intent 서명 오버킬.
- 미래에 외부 검증 가능한 audit log를 만들거나 운영자 다중화 시 동일 패턴이 답.
- **defer**.

### Module registry topological init (`core/registry.py`)

- `_topological_sort`로 의존 순서 init, `validate_dependencies`로 사전 검증.
- BOB Claw `protocol-binding-registry.mjs`는 flat. 현 사용 패턴(ERC4626 자동 등록)에서 의존 그래프 부재로 충분.
- plan-builder/exit-handler 의존 체인이 복잡해지면 재검토.
- **defer**.

### MPC wallet provider (`wallets/mpc_wallet_provider.py`)

- 전부 `NotImplementedError` 스텁. 가져올 코드 없음.
- 실 MPC가 필요해지면 `Fireblocks`, `Safe` MPC, `Threshold ECDSA` 라이브러리 직접 도입.

### ERC-8004 / APEX / UMA / on_job

- 도메인 불일치. 가져올 가치 없음. on_job 모델은 LLM 실행 경로 룰과 충돌.

## 5. 작업 우선순위

| 우선순위 | 작업 | 파일/스코프 | 추정 작업량 | 리스크 |
|---|---|---|---|---|
| P1 | Multicall3 helper + 인벤토리 적용 | `src/lib/multicall3.mjs` (신설), `src/executor/realtime-portfolio.mjs`, `src/treasury/inventory-watcher.mjs` | 0.5–1 day | 낮음 (체인별 deploy 사전 확인) |
| P1 | Keystore V3 EVM signer 백엔드 + secure-write helper | `src/executor/signer/evm-keystore-v3.mjs` (신설), `src/lib/secure-write.mjs` (신설), CLI `signer:keystore-create` | 0.5 day | 낮음 (기존 signer 유지, 스왑 가능) |
| P2 | Nonce manager 에러 정규식 audit | `src/executor/signer/evm-local-signer.mjs:226` + 회귀 테스트 | 1 hour | 매우 낮음 |
| P3 | ERC-4337 paymaster | BSC 거래량 트리거 시 | defer | 도입 비용 큼 |
| P3 | EIP-712/EIP-191 signed intent | 다자 운영자/외부 audit 모델 시 | defer | 현 단일 프로세스 모델에서 불필요 |
| Skip | ERC-8004 / APEX / UMA / on_job / MPC stub | — | — | 도메인 불일치 또는 stub |

## 6. 정합성 체크 — `AGENTS.md` 룰과 충돌 없음

- Multicall3: 정보 읽기만, 서명/캡 영향 없음.
- Keystore V3: signer 인프라 강화. `BURNER_EVM_KEY_PATH` 인터페이스 그대로 두고 신규 백엔드 추가, 기존 키 운영 정책 그대로 유지.
- Nonce 정규식: stuck tx 탐지/회복 강화. 정책/캡/킬 스위치와 무관.

세 항목 모두 `AGENTS.md` Risk Limits, Execution Safety, LLM permissions matrix와 충돌하지 않음. 캡 변경/자동 promotion 변경/payback 비율 변경 없음.

## 7. 다음 액션

1. P1-A Multicall3 helper PR — 다음 단계로 합의되면 `src/lib/multicall3.mjs` + `realtime-portfolio.mjs` 통합 + 테스트.
2. P1-B Keystore V3 PR — secure-write helper + EVM keystore signer 백엔드 + CLI + 테스트.
3. P2 Nonce 정규식 audit — 단독 1시간 PR (정규식 1줄 + 테스트 1개).

원하는 순서로 잘라서 진행 가능. P1-A와 P1-B는 독립이라 병렬 PR 가능.
