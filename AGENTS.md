# BOB Claw Rules

## Core Context

- **Product model: payback**. The system takes native BTC from the operator's Bitcoin L1 wallet, routes it through BOB Gateway into destination-chain DeFi positions, and returns a configured share of the realized profit back to a native BTC wallet on a fixed schedule. All PnL, caps, and KPIs are **BTC-denominated first**; USD values are display-only.
- **Operator = user**. Single-account mode. Multi-depositor vaulting (ERC-4626 shares, per-user cost basis) is out of scope until explicitly unlocked by a committed diff to this document.
- Capital sizing is operator-controlled per strategy. There is no project-wide ring-fenced wallet — the operator decides which wallet a given strategy uses and what cap that wallet runs at, declared in the strategy's config.
- Primary product objective: a native-BTC payback agent. Gateway / Instant Swap quote verification is the **transport and settlement lane**, not the alpha source by itself.
- Active strategy lanes: destination-chain BTC yield and lending loops, wrapper-BTC arbitrage across Gateway-supported chains, stable entry/exit loops, and other deterministic yield sleeves whose unwind cost is measured.
- Lane selection is evidence-driven. If the Gateway route/arb lane has no positive measured edge, it moves to infrastructure/reevaluation mode and the highest evidence-backed strategy lane becomes primary.
- Ethereum L1 trading is allowed when fee analysis shows positive expected value after gas and slippage.
- **All 11 BOB Gateway official destinations are in scope** (Ethereum, BOB L2, Base, BNB, Avalanche, Unichain, Berachain, Optimism, Soneium, Sei, Sonic). Arbitrum and Polygon are NOT Gateway destinations as of 2026-04 — treat them as post-Gateway manual bridge only. See `docs/research/bob-ecosystem.md`.

## Objective Review

- Do not say a route is profitable until measured quote, fee, latency, and execution data support it.
- Do not treat a transport route as the product goal. A route can be technically proven while still not being a profitable strategy.
- Treat all profit claims as hypotheses until replay/shadow/live receipt data confirms them.
- If data says no trade, no trade.
- If route alpha is exhausted, stop route brute-force and switch the primary review lane to receipt-backed strategy evidence.
- Overfitting guards: no strategy goes live solely on a single-period or single-pair backtest. At minimum, Walk-Forward purged/embargoed CV + at least one regime change in the sample window. Detail in `docs/research/ops-costs.md`.

## Execution Safety

- This system is designed for unattended, multichain, fully-automated execution. There is no manual promotion step and no tiered phase gate. A strategy runs the moment its config declares `autoExecute: true` with valid caps committed to the repo; it halts the moment the kill-switch file exists, the drawdown limit trips, or its caps are breached.
- Private keys live only inside the signer daemon process, loaded from OS keystore files via env-referenced paths: `BURNER_EVM_KEY_PATH` for all EVM chains, `BURNER_BTC_KEY_PATH` for native BTC signing. (`BURNER_PRIVATE_KEY_PATH` is a backwards-compat alias pointing to the EVM key.) Keys must never appear in: LLM context (Claude / Codex / Copilot chat transcripts), dashboards, Telegram handlers, the repo, tool call arguments, logs, or audit files. Code written by any LLM may reference the key only via the env/path indirection — never the value.
- No LLM in the trade execution decision path. LLMs propose strategies, write code, and edit configs via committed diffs; a deterministic policy engine validates every intent; the signer signs only after policy approval. "Vibe coding" does not cross this line — code may be written by an LLM, but the runtime decision to sign is always policy code, not an LLM. **This rule applies identically to the payback engine**: payback amount, timing, and offramp-trigger decisions are deterministic rule-engine output, never LLM output.
- Emergency stop is a file. The signer checks `$KILL_SWITCH_PATH` before every broadcast on every chain. `touch` it and everything halts; remove it to resume. The payback scheduler checks the same kill-switch and will not trigger offramps while it is set.
- No unlimited approvals. Approvals are either per-tx (Permit2 where supported) or time-boxed and auto-revoked when a strategy goes idle.
- Leverage strategies (lending loops, perps) declare `healthFactorMin`, `liquidationBufferPct`, and an emergency-unwind path in their config. A breach triggers automatic unwind, not a wait.
- Auto-escalation of position size based on recent wins (martingale) is banned. Sizing comes from the strategy's declared caps, not from a streak counter.
- **Payback never escalates sizing**. Accumulated BTC on the operator's L1 wallet is out of the operating perimeter. It does not loop back into the strategy float unless an explicit committed diff deposits it.

## Risk Limits

- Caps are code, not env vars. Per-strategy per-tx USD, per-day USD, per-chain USD, and `maxDailyLossUsd` live in config files under `src/config/` (or the strategy's own config module). Raising a cap requires a committed diff — an LLM, dashboard, or Telegram handler cannot raise a cap at runtime.
- A strategy without a declared per-tx cap, per-day cap, and `maxDailyLossUsd` must not run. The signer rejects intents from capless strategies.
- Minimum net profit: positive after measured gas + slippage. Reject when estimated edge is at or below the measured gas+slippage variance floor.
- For leverage strategies: configured `healthFactorMin` and `liquidationBufferPct` must hold pre- and post-trade; either breach blocks the trade and triggers unwind.
- Max consecutive failures per strategy: 3 → auto-pause that strategy until the operator resumes it via a committed config flip.
- Failed-gas budget guard (`maxFailedGasCost24hUsd`) is enforced by the daemon — a route burning gas without fills auto-pauses.
- Drawdown kill-switch: if a strategy's realized 24h PnL drops below its `maxDailyLossUsd`, the daemon halts that strategy for the remainder of the day.
- Stale quotes rejected.
- **Payback-specific caps (declared in `src/config/payback.mjs`):**
  - `baseRatio` — default payback fraction of realized harvest profit, BTC units. Default 0.20. Config-only change.
  - `minPaybackBtc` — below this, accrue instead of offramp. Default 0.0005 BTC.
  - `maxOfframpCostPctOfPayback` — if round-trip cost exceeds this fraction of the payback amount, defer to next period. Default 0.10.
  - `perPeriodMaxBtc` — hard upper bound on a single payback disbursement.
  - `annualMaxPaybackBtc` — rolling 12-month cap; prevents a runaway rule from draining operating capital.
  - `regimeMultipliers` — {bear: ≤1.5, neutral: 1.0, bull_peak: ≥0.5} — applied deterministically from a whitelisted oracle (Mayer Multiple from a pinned data source), never from an LLM judgment.
  - `emergencyPause` triggers: protocol exploit on any touched protocol, measured Gateway offramp slippage >2%, operating-capital drawdown >30%. On trigger, payback scheduler halts until committed diff resumes it.
- On-chain note: `src/contracts/BalancerFlashArb.sol` ships with `minProfitUsdc = 300000` (USD 0.30, 6 decimals) in the constructor. Off-chain policy may permit any positive-EV trade, but the deployed contract still rejects flash-arb profits below USD 0.30 until it is redeployed or made owner-settable. Non-flash strategies are unaffected.

## Unattended Execution Architecture

Every executor, capital mover, strategy module, and the payback engine fit this architecture. Same architecture for dev burner and real capital — only the key-custody backend and the cap numbers change.

**Components**

1. **Proposer** — strategy modules under `src/strategy/` plus any LLM while coding. Emits trade intents as typed JSON. No keys.
2. **Policy Engine** — `src/executor/policy/` — pure functions. Validates intents against caps, HF floors, slippage, kill-switch, drawdown, stale-quote, approval hygiene, consecutive-failure counter, **and payback-specific caps**. Fully unit-testable. No keys.
3. **Signer Daemon** — `src/executor/signer/` — a long-running separate process. Holds keys for all chains. Signs only intents approved by Policy. Exposes a local socket. Two backends in tandem:
   - `EvmLocalKeySigner` — reads `BURNER_EVM_KEY_PATH`, signs for every EVM chain in `src/config/chains.mjs`, per-chain nonce manager (ethers v6).
   - `BtcLocalKeySigner` — reads `BURNER_BTC_KEY_PATH` (WIF or hex), UTXO selection, fee estimation, PSBT construction, RBF support. Used for Gateway onramp and native BTC sends.
   Both share the same `Signer` interface so they can be swapped later for `HardwareSigner` / `MpcSigner` with a one-line change.
4. **Capital Manager** — `src/executor/capital/` — maintains per-chain target balances declared in config. Auto-rebalances by enqueuing swap/bridge intents through the Signer. Replaces the human being told "swap this, hold that."
5. **Gas Float Keeper** — sub-policy of Capital Manager. Per-chain minimum native-token balance. Below threshold → auto-top-up from a configured source chain/asset.
6. **Receipt Ingestor** — every broadcast result (tx hash, revert reason, HF path, liquidation-buffer path, realized cost, realized carry) is appended to audit log and fed into the existing `ingest:*` pipelines automatically. No manual `npm run ingest:...`.
7. **Kill-switch + Watchdog** — file-based hard stop checked per-tx. Watchdog heartbeats the daemon; missed heartbeats → Telegram alert + auto-halt.
8. **Alerter** — Telegram. Reports cap utilization, pauses, kill events, daily PnL, **payback disbursements**. Read-only; no command-side signing from Telegram.
9. **Payback Scheduler** — `src/executor/payback/scheduler.mjs` — cron-driven (default weekly). On tick: computes `plannedPaybackBtc` from the BTC Accumulator snapshot and `src/config/payback.mjs` policy, then emits a payback intent for Policy Engine validation. The intent is a composite: destination-chain profit-reserve → wrapped BTC swap (CoW/Uniswap v3) → LayerZero Composer to BOB L2 → Gateway `OfframpRegistry.createOrder()` → Bitcoin L1 destination address. No keys; intent only.
10. **BTC Accumulator** — `src/executor/payback/accumulator.mjs` — pure function over the audit log + receipt store. Maintains a BTC-denominated rolling ledger: (a) harvest-period realized profit in BTC units, (b) lifetime paid-back BTC, (c) pending deferred payback, (d) per-KPI series for `BYR`, `CG`, `TBR`, `roundTripEfficiency`, `daysToBreakeven`. Writes a dashboard JSON slice but never mutates the audit log.

**Multichain is the default.** Every chain has its own RPC config, nonce manager, signer sub-account (or chain-indexed child key), and cap sub-budget. Strategies declare the chain set they touch. The payback engine MUST succeed end-to-end on at least Base → BOB L2 → Bitcoin L1 before any other chain is used as an intermediate profit-reserve location.

**LLM permissions matrix** (applies to Claude, Copilot, Codex, and any future coding agent):

| May | May not |
|---|---|
| Write or edit strategy code under `src/strategy/` | Embed or log a private key, even briefly |
| Write or edit policy functions under `src/executor/policy/` | Call the signer with raw tx bytes bypassing policy |
| Write or edit payback scheduler/accumulator under `src/executor/payback/` | Decide payback ratio, timing, or trigger at runtime |
| Propose cap changes via a committed diff | Raise caps (strategy or payback) at runtime through any side channel |
| Read audit logs | Delete, rotate in place, or rewrite audit logs |
| Configure a new chain by editing config | Move funds outside the Capital Manager |
| Trigger a manual dev-mode run | Decide when to sign — that's policy code's call |

**Audit log** — every sign attempt (approved, rejected, errored) and every payback disbursement appends to `logs/signer-audit.jsonl` with timestamp, strategy id (or `payback:<periodId>`), chain, intent hash, policy verdict, and (on broadcast) tx hash + receipt. On payback completion, also records Gateway order id and destination Bitcoin txid as a three-way receipt. Append-only. Never deleted. Never rotated in place.

## Payback Model

This is the system's product shape; all other rules here either support it or constrain it.

**Definition.** On a fixed schedule (default weekly), the Payback Scheduler harvests a configured fraction of realized BTC-denominated profit from the previous period and sends it as native BTC to the operator's Bitcoin L1 address. The remainder (default 75–80%) compounds inside the destination-chain operating float.

**Accounting unit.** BTC, satoshis internally. Every PnL field, every cap, every KPI in the payback engine is sats-first. USD is a display-layer projection, derived from a pinned oracle (`src/config/oracles.mjs`, whitelisted providers only) at render time. A strategy whose harvest produces only stablecoins must convert to BTC for accounting purposes before the accumulator records it — the conversion route and the pre/post sats are both logged.

**Default policy (stored in `src/config/payback.mjs`, not in code literals).** `baseRatio=0.20`, `minPaybackBtc=0.0005`, `maxOfframpCostPctOfPayback=0.10`, `regimeMultipliers={bear:1.2, neutral:1.0, bull_peak:0.7}` (bear/bull determined by Mayer Multiple vs 200d MA from a pinned source), volatility adjustment `volMultiplier=min(1.0, 0.5 / realizedVol60d)`, rolling 30-day realized volatility >100% halves the ratio. Each value justified in `docs/research/payback-rationale.md` — changing any of them requires citing the new rationale in the PR.

**Deterministic payback formula** (pseudocode, actual implementation in `.mjs`):

```
plannedPayback_sats =
    max(0,
        floor(
            profit_sats_in_period
          × baseRatio
          × regimeMultiplier(now)
          × volMultiplier(now)
        )
      − estimatedOfframpCost_sats
    )

if plannedPayback_sats < minPaybackBtc_sats:
    carry to next period, do not emit intent
if estimatedOfframpCost_sats > plannedPayback_sats × maxOfframpCostPctOfPayback:
    defer, do not emit intent
if anyEmergencyPauseTrigger():
    halt scheduler, log reason, notify Alerter
```

**KPI surface (BTC-denominated).** Stored in the dashboard JSON slice produced by the accumulator:

| KPI | Definition | Target band |
|---|---|---|
| BYR (BTC Yield Ratio) | paid-back BTC over trailing 12 months ÷ operating-capital BTC at period start | 5–15% |
| CG (Compound Growth) | operating-capital BTC growth over trailing 12 months | 10–25% |
| TBR (Total BTC Return) | (paid-back BTC + end operating BTC) ÷ start operating BTC − 1 | 15–40% |
| Round-trip efficiency | (gross realized profit BTC − Gateway round-trip cost BTC) ÷ gross realized profit BTC | >90% |
| Days to breakeven | periods until paid-back BTC covers initial round-trip entry cost | <60d |

The accumulator writes these to the dashboard status slice; the dashboard may display them but must not compute them.

**Settlement proof.** A payback period is only "delivered" when the Receipt Ingestor sees a Bitcoin L1 balance delta on the destination address matching the Gateway order. Source-side tx alone does not count. This is the same objective delivery-proof rule used for cross-chain wrapped-BTC routes (see Operator Memory).

## Build / Validation Order

This is a lane-aware build order, not a runtime phase gate. Runtime execution is still controlled only by committed config, caps, policy checks, signer approval, kill-switch, and receipt evidence.

1. Native BTC transport and settlement proof: Gateway quote/onramp/offramp, destination delivery proof, and Base → BOB L2 → Bitcoin L1 payback path.
2. Strategy evidence: destination-chain yield, lending loops, wrapper-BTC spreads, stable loops, LP/reserve sleeves, and any new deterministic strategy candidate.
3. Shadow/replay harness for the selected primary lane. The selected lane may be a strategy lane even when route alpha is exhausted.
4. Testnet/fork/mechanical execution harness for the selected lane, with strategy-specific receipt and unwind evidence where relevant.
5. Tiny live canary only when committed strategy config declares caps and `autoExecute: true`, and policy validates the intent.
6. Live operation with per-strategy caps, per-strategy unwind paths, watchdog, and receipt ingestor.
7. Payback engine: Scheduler + Accumulator + policy config. Base → BOB L2 → Bitcoin L1 is the first required settlement path; other profit-reserve chains expand only after round-trip efficiency on Base exceeds 90% on at least 8 consecutive periods.

## Dashboard Context

- Before changing dashboard UI, read `docs/dashboard-context.md`.
- The dashboard is a mobile-first BTC -> BOB -> chains flow map, not a table-first operator page.
- The browser may only read `dashboard/public/dashboard-status.json`; do not publish raw JSONL data.
- Dashboard copy must stay user-facing and visual. Avoid internal schema, signer, executor, or strategy jargon.
- `liveTrading` reflects whether the daemon's policy gate currently passes. `ALLOWED` is a normal state, not an exceptional one. The dashboard still must not hold keys, sign, or decide whether to trade — it only reports the gate state.
- The dashboard surfaces payback state as (a) last settled payback BTC and date, (b) pending/accruing BTC for next period, (c) KPI values from the accumulator. It does NOT show the payback formula, ratios, or triggers — those live in config only.

## Reporting

- Every result must distinguish paper PnL, estimated PnL, and realized PnL.
- **Every report must display BTC-denominated PnL first and USD projection second.** A report that shows only USD is incomplete and must be extended before being cited in a strategy decision.
- Every route report must include sample count, quote success rate, latency, fees, and rejection reasons.
- Every payback period writes a disbursement record to the audit log containing: period id, harvest window bounds, gross profit BTC, applied ratio/multipliers, planned payback BTC, estimated round-trip cost BTC, realized round-trip cost BTC, Gateway order id, Bitcoin txid, settled balance delta.

## Operator Memory

- When the user asks about the current strategies, answer in simple Korean first and keep the first explanation short.
- When freshness matters, prefer `npm run report:strategy-catalog -- --json` before giving the strategy snapshot.
- Latest known strategy snapshot:
  - BTC Gateway loops: `measured_below_policy` / transport infrastructure lane. Current route alpha has no confirmed positive edge.
  - BTC proxy spreads: `measured_below_policy` with thin/noisy coverage; keep as reevaluation lane, not primary alpha.
  - BTC stable entry/exit loops: `measured_below_policy`
  - BTC triangular/flash: `measured_below_policy`
  - Direct ETH-family Gateway: `unobserved`
  - ETH/stable mixed loops: `unobserved`
  - ETH mixed triangle: `analysis_only`
  - ETH mixed flash: `analysis_only`
  - Lending-protocol looping: `dry_run_evidence_recorded` for `recursive_wrapped_btc_lending_loop`; repo auto-build support is present, but signer-backed observed receipts and measured post-fee loop economics are still missing.
  - Wrapped BTC lending loop: signer-backed OOS/live roundtrip evidence is recorded for the Base / Moonwell lane; keep it as current strategy-primary review lane until recursive observed receipts supersede it.
  - **Payback engine: `scaffolded_active_carry`** — scheduler/accumulator/config exist and are reporting BTC-denominated pending carry. Current blocker is `planned_payback_below_minimum`, not missing payback code.
- If the user asks why ETH was "not validated", clarify that ETH was investigated and measured; the current outcome is "no confirmed edge," not "skipped work."
- Use this ETH explanation:
  - no measured multichain ETH-family Gateway surface yet
  - no measured mixed ETH/stable closed loop yet
  - ETH mixed triangle and flash paths are still analysis-only because the contract path is not generalized
  - therefore ETH lanes stay observe-only until a measured edge appears, even though `liveTrading` itself is no longer hard-blocked
- Latest Gateway funding-memory for the live signer:
  - Sonic `wBTC.OFT -> Base wBTC.OFT` and Avalanche `wBTC.OFT -> Base wBTC.OFT` were executed successfully through BOB Gateway and consolidated onto Base signer `0x96262bE63AA687563789225c2fE898c27a3b0AE4`.
  - Both routes initially reverted because signer fallback gas was too low; retries succeeded only after using chain RPC `estimateGas` plus buffer.
  - Post-consolidation Base balances were still `cbBTC=0`, `USDC=0`, `wBTC.OFT=0.00039244`, `ETH=0.005268731623361094`, so wrapped-loop live receipt collection remained blocked by insufficient collateral and missing unwind USDC inventory.
  - Native Avalanche `AVAX` and Sonic `S` were investigated for further consolidation, but the current repo-safe Odos path did not produce a deterministic native->`wBTC.OFT` route suitable for unattended live use.
  - Strategy catalog dispatch is now implemented and was executed once in strongest-safe-mode form: 8/8 catalog lanes ran successfully, with `liveEligible=0`, so the batch fell back to shadow/analysis/dry-run rather than forcing live.
  - Native BTC onramp execution is now wired as `quote -> create-order -> Gateway PSBT -> BTC signer -> register-tx`; current live preview for signer address `bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546` stops at Gateway `INSUFFICIENT_CONFIRMED_FUNDS`, so the blocker is confirmed BTC inventory, not missing executor code.
  - Reusable EVM Gateway BTC-family consolidation is now implemented as `executor:gateway-btc-consolidation`: `quote -> estimateGas -> explicit gasLimit buffer -> signer intent`. Current Avalanche `wBTC.OFT -> Base wBTC.OFT` preview reaches live quote successfully and then blocks at gas preflight with `execution_reverted`, which is the correct real-world signal when the source wallet no longer has a valid executable transfer path.
  - Objective delivery-proof rule: source-chain receipt alone is not enough to call a Gateway funding route fully successful. End-to-end success now requires destination-side proof such as wallet balance delta or destination receive evidence.
  - First end-to-end minimal live proof now exists: Base `wBTC.OFT -> BOB wBTC.OFT` for `1000` sats executed successfully with source tx `0x47357ec6143433a97414a2d4d923d6fbe3204338fd8b61fcc6923d8fa00ddcc9` and destination proof `erc20_balance_delta` on BOB (`initialBalance=0`, `settledBalance=1000`, `observedDelta=1000`, `requiredDelta=1000`).
  - Native-asset DEX live proofs now exist on Base / Avalanche / Sonic using `native -> wrapped native -> USDC` via Odos. Full tx set preserved in prior audit log entries.
  - Bob outbound and extended native-BTC settlement proofs now exist across Base/Avalanche/Sonic for `wBTC.OFT -> native BTC` and Base/Bera/Soneium/Unichain for `wBTC.OFT -> wBTC.OFT` destination-chain delivery. (Full tx list retained in prior audit log entries.)
  - Native BTC off-ramp is now proven live from Base, Avalanche, and Sonic through `executor:gateway-btc-offramp`. **This is the prerequisite the payback engine consumes — the Base → BOB → BTC L1 path is end-to-end live-proven as of this document's timestamp.**
  - Extra Gateway expansion chains (`bera`, `bsc`, `soneium`, `unichain`) have preview-ready Base `wBTC.OFT` funding routes; treasury/refill planning now emits explicit gas bootstrap jobs instead of silently stopping.
  - Strategy execution surfaces now report `missingExecutorCount = 0` for stablecoin entry/exit loops and mixed ETH/stable loops; these lanes run through dedicated analysis probes (`report:lane-reclassification`, `report:secondary-strategy-scaffolds`, `analyze:ethereum-routes`) and are no longer blocked by "no runner at all", though still not live-ready.

## graphify

지식 그래프: `src/graphify-out/` (앱 코드, 기본) + `graphify-out/` (레포 전체, 보조).
post-commit / post-checkout git 훅이 자동으로 그래프를 갱신한다. 수동 `graphify update`는 훅 실패 시에만.

### 사용 판단 (토큰 절감 목적, 객관 트리거)

**graphify 먼저 쓸 것** — 벤치 3~10x 절감:
- 기본 진입은 `npm run graph:focus -- explain <심볼>` / `path <A> <B>` / `query <질문>` 으로 시작한다. 이 래퍼는 앱 그래프를 기본값으로 쓰고 `query` budget을 낮게 잡아 출력 과다를 줄인다.
- "X가 무엇에 연결?"·"이 함수의 호출자"·"이 모듈의 이웃" → `python3 -m graphify query "질문" --graph src/graphify-out/graph.json`
- 단일 심볼 관계 설명 → `python3 -m graphify explain "심볼명" --graph src/graphify-out/graph.json`
- 두 개념 간 경로 추적 → `python3 -m graphify path "A" "B" --graph src/graphify-out/graph.json`
- 아키텍처 전반 훑기 → `src/graphify-out/GRAPH_REPORT.md`
- 루트 스크립트·vendored 코드 → `graphify-out/GRAPH_REPORT.md`
- **3개 이상 파일 읽을 것 같으면 먼저 `graphify query`로 관련 노드만 추려 읽을 파일 수를 줄인다**

**graphify 쓰지 말 것** — 요약으로 정확성 손실:
- 정확 수치·인용·버전 문자열 추출
- `docs/research/*` 및 .md 문서 질문 (그래프는 .mjs/.js AST만, 문서 노드 없음)
- 버그 원인·로직 분석·주석 의도 파악
- 수정 대상 파일은 반드시 원문 읽기

### 운영
- 기본 그래프: `src/graphify-out/graph.json` (연결성 99.5%). 루트 그래프는 테스트/vendored 섬 포함으로 92% — 보조용.
- 허브에 제네릭 이름(`slice()`, `sort()`, `main()`) 있음 → 질의 시 파일 경로 필터 권장.
- 훅 상태: `python3 -m graphify hook status`.

## Reporting Style

- 매 작업이 끝날 때마다 **항상 짧은 종료 요약**을 남긴다. 길게 늘어놓지 말고, 지금 어디까지 왔는지 먼저 보이게 쓴다.
- 종료 요약의 첫 줄은 반드시 `현재 단계: L0/L1/L2/...` 형식으로 쓴다.
- 그 다음에는 아래 3가지를 쉬운 말로 짧게 정리한다:
  - `이번에 한 일`: 실제로 바뀐 것만 1~3문장
  - `왜 아직 그 단계인지`: blocker를 사실 기반으로 짧게
  - `다음 체크리스트`: 바로 이어서 할 수 있는 작업을 체크리스트로
- `다음 체크리스트`는 가능하면 3개 이하로 유지하고, 각 항목은 실행 단위로 쪼갠다.
- 사용자가 이해하기 쉽게 쓰는 것이 우선이다. 내부 모듈명은 꼭 필요할 때만 쓰고, 쓰면 한 줄로 의미를 풀어쓴다.
- 단계가 안 올라갔으면 숨기지 말고 그대로 말한다. 대신 “무엇이 정리됐는지”를 짧게 같이 적는다.
- 추정이나 희망 섞인 표현 대신, 방금 확인한 파일/로그/명령 결과를 기준으로만 설명한다.

## Workspace Hygiene

- `data/`, `docs/current-status.md`, `dashboard/public/dashboard-status.json` 같은 상태 산출물은 실행 때마다 다시 생성되므로 기본적으로 로컬 운영 artifact로 취급한다.
- 자동 실행 후 워크트리가 다시 더러워졌다면, 먼저 "생성 산출물"인지 "실제 코드 변경"인지 구분해서 설명한다.
- 생성 산출물은 가능하면 git 추적 대상에 다시 섞지 않는다. 코드 변경과 운영 산출물을 한 커밋에 섞지 않는다.
- 코드 변경이 `의미 있는 실행 단위`까지 쌓였으면 사용자 지시를 기다리지 말고 **알아서 커밋**한다. 기준은 예를 들어 새 CLI 1개 + 테스트, 운영 규칙 1묶음 + 회귀 테스트, 또는 동일한 목적의 파일 변경이 3개 이상일 때다.
- 자동 커밋 전에는 반드시 관련 테스트/검증을 먼저 돌리고, 커밋 후에는 `현재 단계`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트` 형식으로 짧게 보고한다.
- 자동 커밋은 `작은 기능 단위`로 자주 한다. unrelated 변경이 섞여 있으면 나눠 커밋하고, push는 사용자가 막지 않는 한 같은 흐름에서 이어서 진행한다.
