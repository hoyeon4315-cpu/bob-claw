# Multi-Chain Tiny Live Canary Sweep - 2026-04-23

목적: 운영자 지시에 따라 "한 라우트가 막혔다"는 이유로 전체를 멈추지 않고, 현재 지갑에 있는 자산으로 비용 효율적인 소액 실전 경로를 최대한 넓게 검증한다.

이 문서는 다음 에이전트가 이어서 실행할 수 있도록 실제 실행 결과와 남은 작업을 구분해 남긴다.

## Operator Correction

- BTC Gateway off-ramp 하나가 막혀도 전체 sweep을 중단하지 않는다.
- 후보별 blocker는 작업 큐로 남긴다.
- 전역 중단은 kill-switch, signer/policy reject, cap 누락, liveTrading block, nonce/receipt 불확실성처럼 실제 자금 안전에 영향을 주는 경우로 제한한다.
- `wrapped-btc-loop-base-moonwell`은 운영자 판단으로 보류 상태를 유지한다. 이 sweep은 해당 전략 promotion이 아니라 현재 inventory 기반 execution-surface 검증이다.

## Preflight

확인 시각: 2026-04-22T20:55Z 근처

- kill-switch: absent (`/Users/love/.bob-claw/KILL_SWITCH` 없음)
- live baseline: `ALLOWED`
- current stage: `tiny_live_canary_review`
- objective / technical / operator blocker count: 0
- receipt ledger: 60 records, 56 reconciled, 0 failed, 4 pending outputs
- payback: 601 sats pending carry, 0 sats settled payback

## Executed Live Routes

아래는 repo CLI와 signer/policy 경로를 통해 실행한 소액 실전 검증이다. 수익 주장 목적이 아니라, 실제 quote -> signer -> broadcast -> receipt/delta 경로 확인 목적이다.

| Chain | Route | Tiny Amount | Status | Tx / Evidence |
| --- | --- | ---: | --- | --- |
| Base | USDC -> WETH | 0.1 USDC | delivered | `0x6daa8c1e8c31651f3d024b6403f1148d5c5fd3d2a759f6399259f6a6952266a2` |
| Sonic | USDC -> wS | 0.1 USDC | delivered | `0x21503072a631cef91f4a701caca5c99f3ffdf8225d4e72bf426081f83b993307` |
| BSC | USDT -> WBNB | 1 USDT | delivered | `0x155daf7b60d855ce88a37ce8add95c0903e8430c65746b64cf33d27d587fa74f` |
| Avalanche | USDC -> WAVAX | 0.1 USDC | delivered | `0xc556bee86dda789f8faf3da1496211acca78b1764843b76e1b3369efcc0ad219` |
| Optimism | USDC -> WETH | 0.1 USDC | delivered | `0x2306184a6757ad20dc57a15545b2584c798ff4f5bf56afc5b02deaa9a344147e` |
| BSC | BNB -> USDC | 0.001 BNB | delivered | `0xe7eddef1e2e345f184cd691e22ff855adcfd305289a8b1fcf774144c751c6fcc` |
| Optimism | ETH -> USDC | 0.0001 ETH | source confirmed, isolated reconcile needed | `0x91d8601bf5a1baab7de4d1654a33225d1e72ecd0c47a61fbad28f7ef1fcf8951` |
| Unichain | USDC -> WETH | 0.1 USDC candidate | stopped after signer timeout / receipt uncertainty | approval tx observed in audit: `0xb394cf773d8c1a92b6d15cb5eb764e8000d22a4fd8bedf90191861a892b95214` |

Optimism native route는 source tx가 확인됐지만, 같은 output asset을 동시에 건드린 다른 Optimism token swap 때문에 balance delta가 순수하게 분리되지 않았다. 따라서 "delivered"가 아니라 `source_confirmed_needs_isolated_reconcile`로 취급한다.

Unichain은 signer timeout 이후 RPC receipt 확인도 불안정했다. 이 상태에서 재시도하면 중복 approve 또는 nonce 꼬임 위험이 있어 전역 안전 규칙에 따라 live 재시도를 멈췄다.

## Inventory Effects

대표 변화:

- BSC USDT: 약 321.074998649 -> 320.074998649
- BSC WBNB: 0 -> 약 0.001854780786
- BSC USDC: 0 -> 약 0.641763605
- Base USDC: 약 0.514742 -> 0.414742
- Base WETH: 증가
- Avalanche USDC: 약 0.661945 -> 0.561945
- Sonic USDC: 약 0.307911 -> 0.207911
- Bitcoin L1: 5187 sats 유지

BTC-denominated payback 상태:

- settled payback: 0 sats
- pending carry: 601 sats
- minimum payback: 50,000 sats
- remaining to minimum: 49,880 sats

## Why It Still Stopped

이번 중단은 "수익성이 없어 보이니 임의로 멈춤"이 아니다.

중단 사유는 두 가지다.

- Unichain signer timeout 이후 receipt/RPC 확인이 불확실했다. 이 상태에서 계속 밀면 중복 nonce/approval 위험이 있다.
- Gateway BTC route inventory는 여전히 `bitcoin -> bob`, `bob -> bitcoin` 중심이고, 현재 BOB wBTC.OFT 잔고 41 sats는 off-ramp minimum 5000 sats보다 작다. BSC의 320달러 상당 자산을 Bitcoin L1으로 바로 보내는 repo-safe route는 아직 없다.

## Current Blocker Queue

- `gateway_route_missing`: BSC USDT/wBTC.OFT -> BTC 또는 BSC -> Base/BOB BTC-family route가 현재 quote surface에 없다.
- `bob_offramp_inventory_below_minimum`: BOB wBTC.OFT 41 sats < 5000 sats minimum.
- `bob_dex_router_missing`: BOB DEX path는 현재 `no_supported_router_for_chain:60808`.
- `soneium_dex_router_missing`: Soneium DEX path는 현재 `no_supported_router_for_chain:1868`.
- `unichain_receipt_uncertain`: signer timeout 후 approval receipt/nonce 상태를 먼저 분리 확인해야 한다.
- `isolated_reconcile_needed`: 같은 chain/output asset을 동시에 만지면 balance delta proof가 왜곡된다.

## Coding Plan

### P0. Live sweep runner

Add `run-live-canary-sweep` as a deterministic CLI.

Required behavior:

- read kill-switch, signer health, live baseline, whole-wallet inventory
- build candidates from all non-dust inventory across Gateway official destinations
- classify candidate blockers without stopping the whole sweep
- stop globally only on kill-switch, policy reject, missing caps, signer outage, liveTrading block, or nonce/receipt uncertainty
- use tiny route-specific amounts only
- write latest machine report to `data/live-canary-sweep-latest.json`

### P1. Output-asset lock and isolated reconciliation

Add a per-chain/output-asset execution lock.

Reason:

- two live txs that both change `optimism:USDC` can make balance-delta proof look smaller or larger than the actual route
- if a conflict is detected, the runner should mark the route as `source_confirmed_needs_isolated_reconcile`, not `delivered`

### P2. Unichain nonce/receipt recovery

Before retrying Unichain:

- read signer audit entries for the pending approval tx
- query all configured Unichain RPCs for receipt and latest nonce
- if tx is confirmed, reconcile approval and continue with swap only once
- if tx is absent and nonce unused, retry from fresh quote
- if nonce is ambiguous, stop Unichain only and continue other chains

### P3. Gateway fallback watcher

Keep polling Gateway inventory and route quote surface.

Trigger tiny off-ramp only when:

- `bob -> bitcoin` route is available
- BOB wBTC.OFT >= 5000 sats
- policy/caps pass
- Bitcoin destination proof can be observed

### P4. Router support expansion

Implement chain-specific router adapters or explicit fallback plans for:

- BOB
- Soneium
- Berachain
- Sei

Do not call these chains "done" until a live quote, broadcast, and receipt/delta proof exists.

### P5. Tests

Add tests for:

- candidate classification does not globally stop on per-route no-route
- global stop triggers on kill-switch and signer outage
- missing caps blocks execution
- output-asset lock prevents false delivered proof
- Unichain timeout prevents duplicate retry until nonce state is known

## Next Execution Policy

다음 heartbeat/agent는 다음 순서로 이어간다.

1. `report:live-baseline`이 `ALLOWED`인지 확인한다.
2. Unichain pending approval receipt/nonce를 먼저 분리한다.
3. 다른 체인은 현재 inventory에서 아직 안 건드린 tiny route를 후보별로 계속 검증한다.
4. BTC off-ramp는 BOB wBTC.OFT가 5000 sats 이상이 되거나 Gateway route가 확장될 때 즉시 재시도한다.

이 접근은 "막히면 멈춤"이 아니라 "안전 전역 게이트만 멈추고, 나머지는 계속 밀기"다.
