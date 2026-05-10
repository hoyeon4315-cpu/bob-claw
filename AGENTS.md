# BOB Claw Rules

## Engineering Map

- Before feature, policy, dashboard, cleanup, commit, or push work, read
  `docs/system-map.md` and `docs/harness-engineering.md` after this file.
  They are implementation maps only; this `AGENTS.md` remains the operating
  law if any document conflicts.
- The engineering confidence standard is **evidence-complete confidence**, not
  literal certainty about future markets: every repo-visible caller is
  accounted for, no known operating-law loophole remains, targeted and full
  checks pass, docs match code, and final diff review confirms no live-path
  regression.

## Diagnostic Entry Points

진단 / 평가 / 분석 답을 만들기 전에 다음 명령을 먼저 호출한다. 이미
측정된 사실을 추측으로 다시 만드는 일을 막기 위함이다. 새 진단 모듈을
신설하기 전에도 같은 명령을 먼저 호출하고 *부족한 부분만* 보강한다.

| 질문 종류 | 먼저 호출할 entry point |
|---|---|
| NAV 변동 / gas burn / slippage / payback 누적 | `npm run report:capital-audit -- --json` |
| 완전 자동 readiness blocker / 무엇이 막혀있나 | `node src/cli/check-full-automation-readiness.mjs --json` |
| refill 거부 사유 / capital plan decision | `node src/cli/plan-capital-manager-refill-jobs.mjs --json` |
| payback 상태 / 누적 sats / carry 사유 | `npm run report:payback-status -- --json` |
| dashboard 표면 상태 (배포된 truth) | `dashboard/public/dashboard-status.json` 조회 |
| autopilot 가장 최근 run | `data/all-chain-autopilot-latest.json` |
| 코드 호출 그래프 / 심볼 관계 | `python3 -m graphify query/explain/path` (graphify 섹션 참조) |

규칙:
- 위 entry point 가 답할 수 있는 사실은 추측 / 가설 / "아마" 로 메우지 않는다.
- 새 모듈 / 새 CLI 제안 전에 `ls src/cli | grep <키워드>` 로 동명/유사
  도구가 있는지 확인한다.
- 명령 결과는 자기 답에 *그대로 인용* 한다. 요약 / 재작성 금지.
- 명령이 실패하거나 데이터 없음으로 응답하면 그 사실을 그대로 보고하고
  "데이터 부족" 으로 답한다. 추측으로 빈칸 채우지 않는다.

## Core Context

- **Product model: payback**. The system takes native BTC from the operator's Bitcoin L1 wallet, routes it through BOB Gateway into destination-chain DeFi positions, and returns a configured share of the realized profit back to a native BTC wallet on a fixed schedule. All PnL, caps, and KPIs are **BTC-denominated first**; USD values are display-only.
- **Operator = user**. Single-account mode. Multi-depositor vaulting (ERC-4626 shares, per-user cost basis) is out of scope until explicitly unlocked by a committed diff to this document.
- Approved operator BTC address for the 2026-05-10 funding/watch/payback lane:
  `bc1p809tstru8s6x7accmac2xl3rczcfzzh96myh09gy68d883y4uzushkyww0`. Confirmed deposits to this address may be classified as operating capital only through committed config/policy, Gateway/capital-manager routing, deterministic policy checks, signer approval, and append-only audit evidence. This address is declared in `src/config/operator-btc-addresses.mjs`; it is not a runtime cap override and does not bypass payback rules.
- Capital sizing is operator-controlled per strategy. There is no project-wide ring-fenced wallet — the operator decides which wallet a given strategy uses and what cap that wallet runs at, declared in the strategy's config.
- Primary product objective: a native-BTC payback agent. Gateway / Instant Swap quote verification is the **transport and settlement lane**, not the alpha source by itself.
- Active strategy lanes: destination-chain BTC yield and lending loops, wrapper-BTC arbitrage across Gateway-supported chains, stable entry/exit loops, ETH-family deployment, tokenized reserve / gold sleeves, and other deterministic yield sleeves whose unwind cost is measured.
- Intermediate operating inventory may include ETH, stablecoins, tokenized gold, tokenized reserve assets, and other approved bluechips when deterministic unwind rules, explicit risk caps, and a measured BTC return path exist. The product still settles PnL and payback in BTC first.
- Lane selection is evidence-driven. If the Gateway route/arb lane has no positive measured edge, it moves to infrastructure/reevaluation mode and the highest evidence-backed strategy lane becomes primary.
- Ethereum L1 trading is allowed when fee analysis shows positive expected value after gas and slippage.
- **All 11 BOB Gateway official destinations are in scope** (Ethereum, BOB L2, Base, BNB, Avalanche, Unichain, Berachain, Optimism, Soneium, Sei, Sonic). Arbitrum and Polygon are NOT Gateway destinations as of 2026-04 — treat them as post-Gateway manual bridge only. See `docs/research/bob-ecosystem.md`.
- **Small-capital operating mode is active while operating capital is below $1,000.** In this mode, the primary alpha source is campaign-aware destination-chain yield, not route/transport spread. The system runs an evidence-led primary-chain two-lane model: Anchor yield/CL surfaces plus an Opportunistic campaign/micro-test sleeve. Base is the current committed primary-chain profile because of current receipts, cost, inventory, and executor support; any official Gateway destination may become primary through a committed evidence-profile diff.
- **Displayed APR is not strategy evidence.** Campaign, Merkl, Aerodrome, DefiLlama, or protocol UI APR must be converted into expected realized net PnL after reward-token haircut, IL, gas, bridge cost, claim/swap cost, and exit cost before it can drive sizing. BTC-first accounting still applies to reporting and payback conversion: a configured share of realized positive PnL is converted into native BTC as the payback leg.
- **Outlier campaign wins are evidence of a lane, not a baseline.** A single BOB Rise-style payout can justify building detection and execution support, but it must not be annualized into monthly targets or cap increases.

## Objective Review

- Do not say a route is profitable until measured quote, fee, latency, and execution data support it.
- Do not treat a transport route as the product goal. A route can be technically proven while still not being a profitable strategy.
- Treat all profit claims as hypotheses until replay/shadow/live receipt data confirms them.
- If data says no trade, no trade.
- **Operator override (2026-04-24):** Merkl portfolio monetization is now in live-capital validation mode. Do not add more paper-only phase gates before execution. If the Merkl allocator/exit/refill path has committed caps, supported executor binding, inventory, required receipt proof, clear kill-switch, and deterministic policy approval, run it live within cap. The capital at risk is the validation sample.
- **Operator override (2026-04-25):** `wrapped-btc-loop-base-moonwell` and the broader wrapped-BTC lending-loop lane are reopened for live-capital validation. They may run only through committed caps, health-factor/liquidation-buffer policy, automatic unwind, receipt proof, and the same kill-switch path as every other live strategy.
- **Operator override (2026-05-01):** Radar-driven aggressive live tiny-canary lane is unlocked as an operator-risk-defined v1, not as a claim of completed statistical calibration. A radar `Executable` candidate may emit a tiny canary intent into the existing proposer -> policy -> signer pipeline iff: (a) `RADAR_POLICY.calibrationStatus === "calibrated_aggressive_v1"`, (b) candidate's `executionPath` is one of `gateway_destination`, `base_native_evm`, or `gateway_to_evm_bridged`, (c) the bound strategy declares `tinyLivePerTxUsd` and that cap is the cap path, (d) realized-net-PnL expectation after measured haircut and p90 realized cost is positive, (e) reward-token exit liquidity proof exists at canary notional, (f) all standard auto-kill triggers are green. Caps, kill-switch, signer isolation, audit-log, and no-LLM-signing rules are unchanged.
- **Tiny-canary EV standard (2026-05-02):** Radar preview, Merkl queue sync, and executor policy must share the same tiny-canary EV helper in `src/config/sizing.mjs`. Campaign candidates use explicit `expectedHoldDays`, then `campaignRemainingHours`, then `campaignEndsAt`; the 7-day fallback is only for unknown-duration candidates. Same-chain tiny canaries use measured/chain-specific p90 round-trip cost defaults, not a universal `$0.12` floor; unknown chains still fall back to `$0.12`. Entry inventory is not reward-token proof: claim/swap costs and exit-liquidity proof apply only when an explicit reward token exists, while share-price/native-yield canaries account for deposit/withdraw gas and receipt-backed unwind. This aligns optimistic evidence-primary chain validation with pessimistic Ethereum/gas-risk blocking without weakening cap, signer, kill-switch, receipt, or reward-exit rules.
- Operator override paths (Merkl live-capital validation, wrapped-BTC loop reopen, calibrated_aggressive_v1 radar) bypass the commit-time auto-promotion gate. In those paths the safety layer is still enforced by the policy engine alone before any signer broadcast.
- If route alpha is exhausted, stop route brute-force and switch the primary review lane to receipt-backed strategy evidence.
- Overfitting guards: no strategy goes live solely on a single-period or single-pair backtest. At minimum, Walk-Forward purged/embargoed CV + at least one regime change in the sample window. Detail in `docs/research/ops-costs.md`.
- Do not create new live strategy lanes when an existing orchestrator can express the behavior as a policy hook. Campaign hunting, micro-tests, yield rotation, and local-chain opportunities should first be implemented as Merkl/Capital Manager scoring and exit policies.
- Campaign opportunities may be run live within cap only after the candidate has: current campaign data, supported executor binding, deterministic entry/exit path, reward-token valuation haircut, gas/claim/swap estimate, max loss, and receipt proof path.
- For new or thin reward tokens, a micro-canary itself may be the exit-liquidity proof only at the committed canary notional. Failure immediately locks the strategy path; only accumulated positive receipts can later surface a cap-raise candidate.
- Do not call a campaign "successful" until reward accrual, claimability, token conversion, and realized net PnL are measured. Track paper, pending, estimated, and realized separately.

## Execution Safety

- This system is designed for unattended, multichain, fully-automated execution. There is no manual promotion step and no tiered phase gate. A strategy runs the moment its config declares `autoExecute: true` with valid caps committed to the repo; it halts the moment the kill-switch file exists, the drawdown limit trips, or its caps are breached.
- Stage, readiness, admission, promotion, destination, and dashboard labels are advisory/reporting metadata only. They may help rank work or explain evidence gaps, but they must not block a cap-valid `autoExecute: true` strategy outside the deterministic proposer -> policy -> signer path.
- Private keys live only inside the signer daemon process, loaded from OS keystore files via env-referenced paths: `BURNER_EVM_KEY_PATH` for all EVM chains, `BURNER_BTC_KEY_PATH` for native BTC signing. (`BURNER_PRIVATE_KEY_PATH` is a backwards-compat alias pointing to the EVM key.) Keys must never appear in: LLM context (Claude / Codex / Copilot chat transcripts), dashboards, Telegram handlers, the repo, tool call arguments, logs, or audit files. Code written by any LLM may reference the key only via the env/path indirection — never the value.
- No LLM in the trade execution decision path. LLMs propose strategies, write code, and edit configs via committed diffs; a deterministic policy engine validates every intent; the signer signs only after policy approval. "Vibe coding" does not cross this line — code may be written by an LLM, but the runtime decision to sign is always policy code, not an LLM. **This rule applies identically to the payback engine**: payback amount, timing, and offramp-trigger decisions are deterministic rule-engine output, never LLM output.
- **There is no embedded runtime LLM in this system.** The only LLMs that touch the repo are coding agents (Claude Code / Codex / Copilot) operating during a coding session under explicit operator instruction. A coding-session LLM **may**, on explicit operator request, (a) toggle the kill-switch on/off via `npm run kill:on|kill:off|kill:status` and (b) launch or restart deterministic execution daemons (`executor:daemon`, `executor:watchdog`, autopilot loops, payback scheduler). Every kill-switch toggle is appended to `logs/kill-switch-audit.jsonl` with timestamp, action, reason, and actor. The coding LLM still **must not** raise caps, flip `autoExecute` at runtime through any side channel, sign transactions outside of policy approval, or make payback ratio/timing decisions — those still require committed config diffs and deterministic rule-engine output.
- **Codex LLM harness boundary (2026-05-03).** The merged `src/llm/*`, `src/cli/codex-*`, and `src/cli/auto-research-*` lane is a dev/report/scaffold harness only, not an embedded runtime trader. It may call Codex through `OPENAI_API_KEY_PATH` and `OPENAI_CODEX_MODEL_TRIAGE|CODER|REPORT`, but every context pack must be masked, every call must append to `logs/codex-audit.jsonl`, and budget lock state must stay in `data/codex/budget-lock.json` plus `logs/codex-budget-lock-audit.jsonl`. Missing key/model defaults to dry-run; dry-run output must not be treated as evidence of a working adapter or profitable strategy.
- Codex scaffold output is advisory until validated by `src/llm/output-validator.mjs`, family/template allowlists, tests, and committed review. The Codex harness must never auto-merge, auto-raise caps, toggle `$DEV_LOCK_PATH` or `$KILL_SWITCH_PATH` autonomously, sign transactions, or promote a strategy around `evaluateAutoPromotion`.
- Emergency stop is a file. The signer checks `$KILL_SWITCH_PATH` before every broadcast on every chain. `touch` it (or `npm run kill:on -- --reason="..."`) and everything halts; remove it (or `npm run kill:off -- --reason="..."`) to resume. The payback scheduler checks the same kill-switch and will not trigger offramps while it is set.
- No unlimited approvals. Approvals are either per-tx (Permit2 where supported) or time-boxed and auto-revoked when a strategy goes idle.
- Leverage strategies (lending loops, perps) declare `healthFactorMin`, `liquidationBufferPct`, and an emergency-unwind path in their config. A breach triggers automatic unwind, not a wait.
- Auto-escalation of position size based on recent wins (martingale) is banned. Sizing comes from the strategy's declared caps, not from a streak counter.
- **Payback never escalates sizing**. Accumulated BTC on the operator's L1 wallet is out of the operating perimeter. It does not loop back into the strategy float unless an explicit committed diff deposits it.
- Inbound inventory automation may detect deposits and classify known assets, but it must not whitelist new tokens automatically. Unknown or governance tokens go only to `data/treasury/pending-whitelist.jsonl` until a committed token/config diff approves them.

## Risk Limits

- Caps are code, not env vars. Per-strategy per-tx USD, per-day USD, per-chain USD, and `maxDailyLossUsd` live in config files under `src/config/` (or the strategy's own config module). Raising a cap requires a committed diff — an LLM, dashboard, or Telegram handler cannot raise a cap at runtime.
- A strategy without a declared per-tx cap, per-day cap, and `maxDailyLossUsd` must not run. The signer rejects intents from capless strategies.
- Minimum net profit: positive after measured gas + slippage. Reject when estimated edge is at or below the measured gas+slippage variance floor.
- For leverage strategies: configured `healthFactorMin` and `liquidationBufferPct` must hold pre- and post-trade; either breach blocks the trade and triggers unwind.
- Max consecutive failures per strategy: 3 → auto-pause that strategy until the operator resumes it via a committed config flip.
- Failed-gas budget guard (`maxFailedGasCost24hUsd`) is enforced by the daemon — a route burning gas without fills auto-pauses.
- Drawdown kill-switch: if a strategy's realized 24h PnL drops below its `maxDailyLossUsd`, the daemon halts that strategy for the remainder of the day.
- **Small-capital sleeve caps (<$1,000 operating capital):**
  - The USD values below are baseline values for a $1,000 operating-capital assumption. Actual effective values scale through `src/config/operating-capital-scale.mjs` band multipliers; for example, about $358 uses a 0.6x clamp and about $5,000 may use a 2x expansion where committed policy allows it.
  - Anchor lane: 55-70% target allocation, but any CL position requires live range/IL monitoring and an emergency exit path.
  - Opportunistic lane: 30% hard cap; default $125 max while capital is around $500.
  - Micro-test budget: 10% hard cap; default $50 max while capital is around $500.
  - Evidence-primary chain concentration may reach 70% of operating capital only when the chain has a committed primary profile and exposure is split across committed strategy/protocol caps, live unwind paths, and the standard kill/lock rules.
  - Per new/unproven protocol: $10 initial cap, $25 max after receipt-backed reward accrual and exit proof.
  - Per campaign: $35 initial cap for non-canary entries, $80 max unless a committed diff raises it after realized-positive evidence. This is a cap, not a minimum notional floor; the committed tiny-canary ladder may use smaller predeclared rungs when deterministic policy still shows positive expected realized net after costs.
  - Non-primary chain new entries require expected realized net profit greater than bridge+gas+claim+swap costs by at least $10 or 5% of position size, whichever is higher.
  - Transport / infrastructure strategies may keep high nominal registry ceilings for route compatibility, but while small-capital mode is active, `src/config/strategy-caps.mjs` returns effective lookup caps of `perDayUsd <= 200` and `maxDailyLossUsd <= 100` for the committed transport/infra strategy id set. The nominal registry values must stay unchanged; policy uses the effective lookup result.
  - Transport / infrastructure cap reporting must distinguish nominal registry ceilings from the effective small-cap lookup clamp so operators do not treat compatibility ceilings as usable daily risk.
- **Radar canary sleeve (operator override subset for aggressive validation).** Hard cap: $30 per single radar canary, $90 per day across all radar canaries, $200 cumulative open notional in radar-promoted positions, and 6 concurrent open canaries max. Per radar candidate, the bound strategy's `tinyLivePerTxUsd` clamps the intent; the router must never fall back to `perTxUsd` for radar sizing. Realized loss > $25 in 24h on the radar lane triggers a separate radar lock/review state; it does not replace the system kill-switch.
- **Committed live-canary ladder.** Within the committed `SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation` ladder, the Merkl/radar canary autopilot may automatically size the next canary rung from receipt evidence. This is not a runtime cap raise: every rung is predeclared in config, still clamped by `tinyLivePerTxUsd`, per-chain/day/strategy caps, inventory, and kill/lock rules, and never exceeds `maxAutoGraduatedUsd`. Generic minimum-position floors must not override this ladder for tiny canaries; cost, EV, concentration, cap, inventory, kill/lock, and receipt-proof gates still apply. No-tx policy rejections are neutral; on-chain reverts and realized losses pause the ladder.
- **Radar cap graduation beyond the ladder.** Cap increases above the committed ladder are never automatic. The system may surface a `capRaiseCandidate` only after at least two completed live canaries in the same family have positive realized net PnL after all measured costs, receipt-backed entry and exit/unwind, and at least two distinct campaign windows or opportunity ids. BTC-relative underperformance is reported, but it is not a hard blocker by itself when realized net PnL is positive and the payback conversion path is proven. Any cap raise above the committed ladder still requires a committed config diff.
- **Aggressive non-BTC allocation profile.** Non-BTC-denominated strategy exposure may rise to 80% of operating capital under committed policy when deterministic unwind and BTC payback conversion paths exist. A 20% BTC-denominated floor remains. This relaxes portfolio composition, not execution safety: per-strategy caps, protocol/chain concentration, kill-switch, receipt proof, and payback isolation still apply.
- **Protocol and venue concentration:** no single non-bluechip protocol may exceed 25% of operating capital without an explicit committed diff. CL venue exposure above 50% requires live position accounting, time-in-range monitoring, and a tested unwind.
- **Reward-token haircut:** non-stable reward tokens default to a 50% valuation haircut; pre-TGE/points default to 80-90% haircut; whitelisted liquid tokens may use a lower haircut only via config.
- **Auto kill-switch triggers (system-wide).** `src/risk/auto-kill-triggers.mjs` evaluates four conditions every all-chain autopilot tick (`auto_kill_check` step). Any trip writes the kill-switch file at `$KILL_SWITCH_PATH`, halting every signer broadcast and the payback offramp. Resume is manual — `rm` the file after operator review. Defaults live in `src/config/auto-kill.mjs`; overrides require a committed diff.
  - `cumulative_loss` — realized 24h net USD loss across the audit log breaches `thresholdUsd` (or `operatingCapitalFractionFloor` of operating capital, whichever is lower).
  - `failure_burst_per_strategy` and `failure_burst` — per-strategy or global rejected/reverted/error count inside `windowMs`.
  - `oracle_divergence` — multi-source price spread exceeds `maxDivergencePct`. Requires `$AUTO_KILL_ORACLES_PATH` to point at a JSON file with a `samples` array.
  - `heartbeat_stale` — signer heartbeat older than `maxAgeMs`. Requires `$EXECUTOR_HEARTBEAT_PATH`.
  - `relative_price_move` — trips when a configured pair used by a CL strategy moves beyond its window, e.g. ETH/BTC 7d move > 15% for WETH-cbBTC CL positions.
  - `cl_range_health` — trips or pauses the strategy when time-in-range falls below policy threshold or IL exceeds fees over the configured window.
  - `protocol_incident` — pauses affected strategies when a pinned exploit/incident feed or manually committed incident file names a touched protocol.
  - `campaign_decay` — exits or pauses an opportunistic position when realized APR falls below 50% of entry APR, campaign TVL drains by 30%, reward token drops by 25%, or campaign end is within the harvest window.
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
4. **Capital Manager** — `src/executor/capital/` — maintains per-chain target balances. Two target sources are supported and merge cleanly:
   - Static cap targets from `src/config/strategy-caps.mjs` (`buildTargetBalances`).
   - Score-weighted targets from `src/executor/capital/scored-target-balances.mjs`. Candidate set is every `autoExecute: true` strategy times its positive `caps.perChainUsd[chain]`, filtered to the 11 official Gateway destination chains. `destination-promotion-gate.json` is a score source only, not an execution gate: score lookup uses `strategyId`, `familyId`, and exposure-derived score families, then applies reduced weight to non-ready/no-gate candidates. Allocation water-fills by weight, clips by per-chain/per-strategy caps, and sums per-chain settlement targets.
   The rebalancer is **bidirectional**: it emits `capital_rebalance` for chains under target and `capital_drain` for chains over target, with `buildCapitalRebalanceMatchedTransfers` pairing surplus chains to shortfall chains so the same dispatch consolidates scattered inventory (e.g., USDC dumped on BSC, surplus wBTC.OFT on a chain with no target). Tolerance configurable via `policy.capital.rebalanceToleranceUsd` (default $5).
   The CLI `npm run executor:bootstrap-from-btc -- --total-capital-usd=<usd>` (or `--btc-balance-sats=<sats> --btc-price-usd=<usd>`) writes `data/bootstrap-from-btc.json` with the score-weighted target vector and the resulting refill plan; the all-chain autopilot accepts the same flags via `--bootstrap-btc-sats=...` etc. and runs it as the first step before the treasury refill plan. Auto-rebalances by enqueuing swap/bridge intents through the Signer. Replaces the human being told "swap this, hold that."
5. **Gas Float Keeper** — sub-policy of Capital Manager. Per-chain minimum native-token balance. Below threshold → auto-top-up from a configured source chain/asset.
6. **Receipt Ingestor** — every broadcast result (tx hash, revert reason, HF path, liquidation-buffer path, realized cost, realized carry) is appended to audit log and fed into the existing `ingest:*` pipelines automatically. No manual `npm run ingest:...`.
7. **Kill-switch + Watchdog** — file-based hard stop checked per-tx. Watchdog heartbeats the daemon; missed heartbeats → Telegram alert + auto-halt.
8. **Alerter** — Telegram. Reports cap utilization, pauses, kill events, daily PnL, **payback disbursements**. Read-only; no command-side signing from Telegram.
9. **Payback Scheduler** — `src/executor/payback/scheduler.mjs` — cron-driven (default weekly). On tick: computes `plannedPaybackBtc` from the BTC Accumulator snapshot and `src/config/payback.mjs` policy, then emits a payback intent for Policy Engine validation. The intent is a composite: destination-chain profit-reserve → wrapped BTC swap (CoW/Uniswap v3) → LayerZero Composer to BOB L2 → Gateway `OfframpRegistry.createOrder()` → Bitcoin L1 destination address. No keys; intent only.
10. **BTC Accumulator** — `src/executor/payback/accumulator.mjs` — pure function over the audit log + receipt store. Maintains a BTC-denominated rolling ledger: (a) harvest-period realized profit in BTC units, (b) lifetime paid-back BTC, (c) pending deferred payback, (d) per-KPI series for `BYR`, `CG`, `TBR`, `roundTripEfficiency`, `daysToBreakeven`. Writes a dashboard JSON slice but never mutates the audit log.
11. **Inbound Inventory Watcher** — `src/treasury/inventory-watcher.mjs` — diffs treasury snapshots, appends known deposit events to `data/treasury/inbound-events.jsonl`, sends approved assets into refill/routing jobs, and sends unknown assets to the pending whitelist queue. No keys; no token auto-whitelisting.
12. **Protocol/Position Visibility** — `src/protocol-readers/`, `src/treasury/protocol-position-*`, `src/config/token-registry.mjs`, and `src/status/protocol-position-marks-slice.mjs` provide the merged DeFi visibility surface. Readers return explicit ok/error envelopes and must not silently skip positions. Every accounted live position needs a stable `positionId`, `bindingKind`, `protocolId`, chain, family, timestamp, and confidence/freshness metadata before it can be cited as live coverage. Token registry additions are PR-only committed config changes, never auto-whitelisting.
13. **Position Health Monitor** — `src/executor/health/position-action-engine.mjs` and `src/executor/health/position-monitor-loop.mjs` are deterministic health surfaces. They may emit protective `exit`, `unwind`, `pause`, or `review` action descriptors from per-strategy `positionActionPolicy`, and append monitor audit rows. They must not issue rebalance intents, decide strategy sizing, call an LLM, or toggle kill/dev locks; capital rebalancing remains owned by Capital Manager.

**Multichain is the default.** Every chain has its own RPC config, nonce manager, signer sub-account (or chain-indexed child key), and cap sub-budget. Strategies declare the chain set they touch. The payback engine MUST succeed end-to-end on at least one committed official-destination profit-reserve chain → BOB L2 → Bitcoin L1 before that chain is used as an intermediate profit-reserve location. Base is the current proven reference path, not a permanent gate on other evidence-backed chains.

**LLM permissions matrix** (applies to Claude, Copilot, Codex, and any future coding agent):

| May | May not |
|---|---|
| Write or edit strategy code under `src/strategy/` | Embed or log a private key, even briefly |
| Write or edit policy functions under `src/executor/policy/` | Call the signer with raw tx bytes bypassing policy |
| Write or edit payback scheduler/accumulator under `src/executor/payback/` | Decide payback ratio, timing, or trigger at runtime |
| Propose cap changes via a committed diff | Raise caps (strategy or payback) at runtime through any side channel |
| Read audit logs | Delete, rotate in place, or rewrite audit logs |
| Configure a new chain by editing config | Move funds outside the Capital Manager |
| Write inbound classification/routing policy | Auto-whitelist an unknown token at runtime |
| Trigger a manual dev-mode run | Decide when to sign — that's policy code's call |
| Toggle kill-switch (`kill:on`/`kill:off`) on explicit operator request, with audit log | Toggle kill-switch autonomously without an operator request |
| Start, stop, or restart deterministic daemons (`executor:daemon`, `executor:watchdog`, autopilots, payback scheduler) on operator request | Bypass kill-switch, policy engine, or signer approval to launch a trade |
| Trigger an idle radar candidate router tick (`radar:promote --preview` or `--execute`) or radar cap review (`radar:cap-review`) on operator request | Mutate radar thresholds, executionPath enum, `tinyLivePerTxUsd`, or any cap at runtime |

**Audit log** — every sign attempt (approved, rejected, errored) and every payback disbursement appends to `logs/signer-audit.jsonl` with timestamp, strategy id (or `payback:<periodId>`), chain, intent hash, policy verdict, and (on broadcast) tx hash + receipt. On payback completion, also records Gateway order id and destination Bitcoin txid as a three-way receipt. Append-only. Never deleted. Never rotated in place.

Idle inventory consolidation planning uses signer-audit lifecycle stage `idle_consolidation_planned` when a tick emits a consolidation plan before policy/signer dispatch.

## Payback Model

This is the system's product shape; all other rules here either support it or constrain it.

**Definition.** On a fixed schedule (default weekly), the Payback Scheduler harvests a configured fraction of realized positive strategy PnL from the previous period, converts the payback share into native BTC, and sends it to the operator's Bitcoin L1 address. The remainder (default 75–80%) compounds inside the destination-chain operating float. In practical terms, payback is a deterministic BTC DCA leg funded only from realized positive PnL.

**Accounting unit.** BTC, satoshis internally for the payback engine, payback KPIs, and settlement proofs. Strategy admission and cap graduation may use realized net PnL in the strategy's accounting unit or USD/NAV projection after measured costs; BTC-relative PnL remains a required report field, not always a hard execution blocker. A strategy whose harvest produces only stablecoins must record the PnL and the BTC conversion route before the accumulator books the payback share — the conversion route and the pre/post sats are both logged.

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

1. Native BTC transport and settlement proof: Gateway quote/onramp/offramp, destination delivery proof, and at least one committed official-destination → BOB L2 → Bitcoin L1 payback path. Base is the current proven reference path.
2. Strategy evidence: destination-chain yield, lending loops, wrapper-BTC spreads, stable loops, LP/reserve sleeves, and any new deterministic strategy candidate.
3. Shadow/replay harness for the selected primary lane. The selected lane may be a strategy lane even when route alpha is exhausted.
4. Testnet/fork/mechanical execution harness for the selected lane, with strategy-specific receipt and unwind evidence where relevant.
5. Tiny live canary only when committed strategy config declares caps and `autoExecute: true`, and policy validates the intent.
6. Live operation with per-strategy caps, per-strategy unwind paths, watchdog, and receipt ingestor.
7. Payback engine: Scheduler + Accumulator + policy config. Each profit-reserve chain needs its own settlement proof and round-trip efficiency evidence before it is used for payback routing; Base → BOB L2 → Bitcoin L1 is the current proven reference path, not a required predecessor for every other chain.

## Dev Automation Lane

The dev-automation lane is the pipeline by which a coding-session LLM (or the operator) discovers new routes, scaffolds new strategy modules, validates them, and promotes the ones that clear deterministic thresholds. The goal is that **the coding-session LLM is not throttled by safety policy when doing dev work, while the live system is not weakened in any way**.

**Two independent file flags.** Live and dev are coordinated by separate file flags so they cannot interfere:

| Flag | Default path | Effect |
|---|---|---|
| `$KILL_SWITCH_PATH` | `~/.bob-claw/KILL_SWITCH` | Halts every signer broadcast and the payback offramp. Toggle via `npm run kill:on` / `kill:off` / `kill:status` (or the `live:start` / `live:stop` / `live:status` bundle). All toggles append to `logs/kill-switch-audit.jsonl`. |
| `$DEV_LOCK_PATH` | `~/.bob-claw/DEV_LOCK` | Pauses the dev-automation CLIs only (auto-validation, route discovery, auto-promotion runner). Live execution is **not** affected. Toggle via `npm run dev:lock` / `dev:unlock` / `dev:lock-status`. All toggles append to `logs/dev-lock-audit.jsonl`. |

The operator (or a coding-session LLM acting on operator request) holds the dev-lock while hand-coding so background automation does not race with in-progress edits. The kill-switch is for live trade safety and is independent.

**Auto-promotion gate (coding-session dev guard, deterministic, never an LLM judgment call).** `src/config/auto-promotion.mjs` declares the thresholds — walk-forward Sharpe, max drawdown, regime-change minimum, sample-period minimum, shadow consecutive-positive periods, shadow net-of-measured-cost positivity, quote success rate, oracle divergence, slippage, edge-above-cost-variance, OOS holdout, and regime-breakdown coverage. `src/executor/auto-promotion-gate.mjs` is a pure function that takes an evidence file and the config and returns `{ passed, blockers, evaluated, initialCanaryCaps }`. Coding-session LLMs must use it as a commit guard before proposing `autoExecute: true`; it is not a runtime phase gate, not a signer input, and not a manual promotion step. Threshold changes require a committed diff to `src/config/auto-promotion.mjs` with rationale.

**Auto-research loop bounds (2026-05-03).** `src/cli/auto-research-loop.mjs` and `src/cli/auto-research-pipeline.mjs` may iterate triage -> scaffold -> score only inside the committed loop limits: 20 iterations, 2 hours wall clock, $2 cumulative Codex spend per loop run, 3 repeated identical failures, 15 files, and 400 diff lines. The loop writes `logs/auto-research-audit.jsonl`; it never auto-merges, never raises caps, never toggles kill/dev locks, and never converts a dry-run Codex stub into evidence.

**What the coding-session LLM may do without policy obstruction:**

- Generate route candidates, scaffold strategy modules, edit dispatcher registries, run any number of dry-runs / shadow / replay / WF-purged CV harnesses, write/update tests, ingest receipts, regenerate dashboards.
- Run Codex triage, adapter scaffold, daily report, portfolio coverage, position-health, and auto-research CLIs as dev/reporting tools, subject to masking, budget lock, output validation, and append-only audit logs.
- Toggle `$DEV_LOCK_PATH` and `$KILL_SWITCH_PATH` on explicit operator request, with `--reason="..."` (audit-logged).
- Start, stop, and restart deterministic daemons (`executor:daemon`, `executor:watchdog`, autopilots, payback scheduler) on operator request.
- Commit `autoExecute: true` for a new strategy **iff** its evidence file passes `evaluateAutoPromotion` against the current `auto-promotion.mjs` config and the strategy module declares the `initialCanaryCaps` from that config (or smaller). The promotion commit must reference the evidence file path.

**What the coding-session LLM still may NOT do:**

- Raise caps at runtime through any side channel — `initialCanaryCaps` are mechanical, and graduation to operator caps requires a separate operator-committed diff.
- Bypass the policy engine, signer approval, or kill-switch.
- Decide payback ratio, timing, or trigger at runtime.
- Auto-whitelist an unknown token.
- Promote a strategy whose evidence file is missing, stale, or has any non-empty `blockers` array.
- Modify or delete `logs/signer-audit.jsonl`, `logs/kill-switch-audit.jsonl`, or `logs/dev-lock-audit.jsonl`.

**What the live system enforces independent of the dev lane:**

- Policy engine, per-strategy caps, HF/liquidation buffer, slippage guard, stale-quote rejection, consecutive-failure counter, drawdown kill-switch, and the configured auto-kill triggers all fire on auto-promoted strategies exactly the same as on operator-committed strategies. The auto-promotion gate is in addition to those guards, not a replacement for them.

## Dashboard Context

- Before changing dashboard UI, read `docs/dashboard-context.md`.
- The dashboard is a mobile-first BTC -> BOB -> chains flow map, not a table-first operator page.
- The browser may only read `dashboard/public/dashboard-status.json`; do not publish raw JSONL data.
- Dashboard copy must stay user-facing and visual. Avoid internal schema, signer, executor, or strategy jargon.
- `liveTrading` reflects whether the daemon's policy gate currently passes. `ALLOWED` is a normal state, not an exceptional one. The dashboard still must not hold keys, sign, or decide whether to trade — it only reports the gate state.
- Destination scoring artifacts, including `destination-promotion-gate.json`, are score sources for Capital Manager and reports only. They carry `scoreSourceOnly` / `runtimeAuthority: "none"` semantics and must not be treated as execution approval.
- The dashboard surfaces payback state as (a) last settled payback BTC and date, (b) pending/accruing BTC for next period, (c) KPI values from the accumulator. It does NOT show the payback formula, ratios, or triggers — those live in config only.

## Reporting

- Every result must distinguish paper PnL, estimated PnL, and realized PnL.
- **Every report must display BTC-denominated PnL first and USD projection second.** A report that shows only USD is incomplete and must be extended before being cited in a strategy decision.
- Every route report must include sample count, quote success rate, latency, fees, and rejection reasons.
- Every payback period writes a disbursement record to the audit log containing: period id, harvest window bounds, gross profit BTC, applied ratio/multipliers, planned payback BTC, estimated round-trip cost BTC, realized round-trip cost BTC, Gateway order id, Bitcoin txid, settled balance delta.

## Operator Memory

- When the user asks about the current strategies, answer in simple Korean first and keep the first explanation short.
- When freshness matters, prefer `npm run report:strategy-catalog -- --json` before giving the strategy snapshot.
- Current small-capital strategy posture: evidence-led primary-chain two-lane model.
  - Anchor lane: validated yield/CL candidates on the committed primary chain, currently Base examples such as YO and Aerodrome cbBTC/WETH, are allowed research/execution targets only with live position accounting, IL/range monitor, caps, and exit path.
  - Opportunistic lane: Merkl/campaign/micro-test opportunities are handled by Merkl Portfolio Orchestrator + Capital Manager policy hooks, not by five independent strategy daemons.
  - Route/transport lanes remain infrastructure unless measured positive edge returns.
  - Payback engine remains active carry; blocker is insufficient realized profit, not missing payback code.
- If the user asks why ETH was "not validated", clarify that ETH was investigated and measured; the current outcome is "no confirmed edge," not "skipped work."
- Use this ETH explanation:
  - no measured multichain ETH-family Gateway surface yet
  - no measured mixed ETH/stable closed loop yet
  - ETH mixed triangle and flash paths are still analysis-only because the contract path is not generalized
  - therefore ETH lanes stay evidence-gated until a measured edge appears; they are not blanket observe-only, but they still need positive-EV and unwind evidence before promotion
- W4–W7 status (2026-04-22):
  - W4: 9 strategy adapters in `run-strategy-tick.mjs` registry: beefy-folding-vault, pendle-pt-lbtc-base, aerodrome-cl-base, pendle-pt-solvbtc-bbn-bsc, berachain-bend-bex-bgt, gmx-v2-perp-basis-avax, stablecoin-spread-loop, proxy-spread-expansion, tokenized-reserve-sleeve.
  - W5: `destination-venues.mjs` + `stable-venues.mjs` registries wired into `allocator-core.mjs` as protocol fallback.
  - W6: optimism/sei are template-only until live route, quote, and executor evidence exists. The current Gateway API route universe is no longer limited to bitcoin↔bob; use fresh `GET /v1/get-routes` snapshots plus quote probes as the execution availability source. LayerZero quote paths are observed by verify/check surfaces, but they remain transport evidence, not strategy profitability evidence. Gateway quote callers attach `affiliateId` when `BOB_GATEWAY_AFFILIATE_ID` is configured; affiliate fee receipt routing is not yet wired (follow-up).
  - W7: `micro-canary-slice.mjs` + `strategy-stage-slice.mjs` feed into `dashboard/public/strategy-tick-status.json` (schema v2). Dashboard frontend renders tick mode, micro-canary status, blocker count, top blocker, projectedNetUsd per strategy in the DeFi tab.
  - Mindmap payback return path: added orange dashed curve from protocol chip back to Bitcoin L1 for `gateway-btc-offramp` type.
  - Known failures: `wrapped-btc-loop-live.test.mjs:152` is pre-existing (mock collateral-swap output insufficient for iteration 2 repay). Not caused by W4–W7 changes. Documented in `docs/known-failures-2026-04-22.md`.
  - v1-infra-drills fix: `per_tx_cap_exceeded` drill amount bumped to 2_000_000 after cap neutralization changed perTxUsd to 1_000_000.
- Live Broadcast Readiness Hard Guard (2026-05-09): dispatch `--execute` explicitly rejects with `process.exit(2)` when `readyForLiveBroadcast=false`. The policy-engine-only runtime authority formula is unchanged.
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
  - Native BTC off-ramp is now proven live from Base, Avalanche, and Sonic through `executor:gateway-btc-offramp`. **This is prerequisite evidence the payback engine consumes — Base → BOB → BTC L1 is end-to-end live-proven as of this document's timestamp, while other profit-reserve chains need their own proof before payback routing uses them.**
  - Extra Gateway expansion chains (`bera`, `bsc`, `soneium`, `unichain`) have preview-ready Base `wBTC.OFT` funding routes; treasury/refill planning now emits explicit gas bootstrap jobs instead of silently stopping.
  - Strategy execution surfaces now report `missingExecutorCount = 0` for stablecoin entry/exit loops and mixed ETH/stable loops; these lanes run through dedicated analysis probes (`report:lane-reclassification`, `report:secondary-strategy-scaffolds`, `analyze:ethereum-routes`) and are no longer blocked by "no runner at all", though still not live-ready.
  - Merkl portfolio live-capital validation is active and multi-position: Base YO is filled to about `75` USD, Ethereum Aave Horizon RLUSD is open at `25` USD, Ethereum Morpho Clearstar USDC Core V2 is open at `75` USD, and Ethereum Morpho Steakhouse Prime Instant V2 is open at `50` USD. Live funding/refill receipts exist for BSC USDT -> Base USDC and BSC USDT -> Ethereum USDC/USDT/RLUSD through LI.FI. Additional deployment is blocked by refill inventory, Ethereum gas, unsupported protocol bindings, or chain/per-day caps, not by lack of Merkl candidates.
  - **Protocol Binding Registry (2026-04-24):** `src/executor/protocol-binding-registry.mjs` now centralizes all protocol dispatch. `merkl-portfolio-allocator.mjs`, `merkl-portfolio-exit.mjs`, and `merkl-canary-autopilot.mjs` all query the registry instead of hard-coded `Set` checks and `if/else` dispatch. Adding a new ERC4626-compatible protocol requires zero code changes elsewhere — call `registerErc4626LikeBinding("new_protocol_deposit_withdraw")` and it auto-wires plan builder, executor, and exit handler. Custom interfaces (non-ERC4626) still need a new helper module + manual registry entry.
  - **Merkl Portfolio Orchestrator (2026-04-24):** `npm run executor:merkl-portfolio-orchestrator` runs a single tick: Phase 1 exit stale positions, Phase 2 refresh treasury inventory, Phase 3 allocate freed capital into the highest-scoring opportunity. Loop mode available via `:loop` script. This replaces the separate exit-then-manually-wait-then-allocator workflow.
  - **Real-time Portfolio Tracking (2026-04-27):** `src/executor/realtime-portfolio.mjs` replaces Zerion API dependency with direct RPC balance reading for all EVM chains. Zero gas cost, no API limits, 5-minute cache. Manually verified against live Base/Ethereum balances. Fallback to hardcoded protocol positions for DeFi positions not readable via RPC.
  - **Aerodrome CL Strategy Validated (2026-04-27):** `src/strategy/aerodrome-cl-manager.mjs` built and tested. WETH-cbBTC pair on Base verified with 90-day real ETH/BTC price data. ETH-BTC correlation 0.94, IL only 0.22%, time-in-range 99%. Net APY ~30% after gas/IL. Auto-rebalance at ±8%, emergency exit at ±15%.
  - **Ethereum Gas Cost Correction (2026-04-27):** Previous estimates of $15-25 for Ethereum→Base bridge were wrong. Actual cost at 2.11 gwei: $2.77 total for 3 withdraws + bridge. Blob (EIP-4844) reduced L2 costs 90%+ since March 2024.
  - **Master Auto-Plan v2.0 (2026-04-27, superseded sizing):** `src/strategy/master-auto-plan.mjs` implemented an earlier $520 mix. Current operating caps are the 2026-05-02 small-cap sleeve caps above: anchor 55-70%, opportunistic 30% / $125, micro-test 10% / $50, with no runtime auto cap raise.
  - **Micro-Test Policy Gate (2026-05-02):** `src/executor/policy/opportunity-policy.mjs` allows high-risk micro-tests up to the committed small-cap config budget, currently $50 and 10% of capital. Auto-exit if >50% loss. Enables small-capital validation of new strategies without risking principal.
  - **Kill-switch Status (2026-04-27):** OFF (resumed for testing). Last toggle: halt → resume by operator-via-llm for real-time tracking verification. Audit: `logs/kill-switch-audit.jsonl`.
  - **Current Capital (2026-04-27, RPC-verified):** Total $520.33. Protocol-locked $358.57 (YO $80, Moonwell $128.57, Morpho $125, Aave $25). Wallet-scattered $161.76 (Base $22.61, Ethereum $14.48, Bera $78.66, Avalanche $25.24, others $20.98). Immediate deployment target: consolidate all to Base via official bridge.
  - **Current Capital (2026-05-06, RPC-verified):** Total $373.62 (down ~$147 vs 2026-04-27). Protocol-locked $66.74 (YO yoUSD on Base only — Moonwell/Morpho/Aave positions all exited; onchain `balanceOf` zero on every share token). Wallet-scattered $306.88 across 13 chains: Ethereum stables/RWAs $86 (RLUSD $36.82, alphaForexV2 $25.04, steakUSDT $24.70, plus ETH/USDC/USDT dust); Base $48 (wBTC.OFT $23.34, cbBTC $17.89, ETH $6.99, WETH $0.08); BTC family across 9 Gateway destinations $66 (wBTC.OFT 0.0001 each on bsc/avalanche/sonic/sei/bera/soneium/unichain plus bob $19.56, ethereum WBTC $8.13); native gas tokens (ETH/BERA/BNB/AVAX/S/SEI/BTC) $36; stablecoin floats (USDC across optimism/avalanche/sonic/soneium/bera/unichain/ethereum) $19. assetUniverse `closed` (10 ERC4626/aToken share tokens whitelisted via `feat(treasury): whitelist 10 ERC4626/aToken shares` commit). scanErrorCount 0, walletCoverage `full_rpc`.
  - **Concentration Guard Backstop Restored (2026-05-08):** daemon, all-chain autopilot, and overfit-review use the same runtime risk-context helper so concentration policy sees wallet-derived chain/protocol allocations even when an intent omits `metadata.riskContext`. Explicit intent metadata still wins over runtime defaults.
  - **Transport Cap Lookup Clamp (2026-05-08):** transport/infrastructure nominal registry ceilings, including `1_000_000`, stay unchanged for route compatibility and auditability. While small-capital mode is active, the lookup layer clamps effective policy caps to `perDayUsd=200` and `maxDailyLossUsd=100`.
  - **Idle Inventory Dispatch Live (2026-05-08):** each all-chain autopilot tick can plan idle `wBTC.OFT` dust consolidation from eight official-destination chains back to Base when fragments are at least `$5` and `72h` idle. The same kill-switch blocks dispatch, `--dry-run-idle` previews the plan, and signer audit records planning as `idle_consolidation_planned`.
  - **BSC alpha diversity (2026-05-08):** Venus is covered through the existing protocol binding and reader path, and the Merkl canary queue preserves at least one BSC quota slot. This diversifies sourcing inside the Merkl/catalog surfaces without adding a new strategy lane.
  - **Aerodrome NFT auto-discovery (2026-05-08):** Aerodrome NonfungiblePositionManager tokenId enumeration now fills realtime-portfolio defaults when explicit `aerodromeTokenIds` are absent, so opened CL NFT positions are not silently invisible.
  - **Surface Admission Reporting-Only (2026-05-09):** strategy execution surfaces now expose `reportingOnly: true` and `runtimeGateAuthority: "policy_engine_only"`. Surface admission, readiness, and auto-promotion evidence are commit-time/reporting inputs only; policy engine checks are the sole runtime authority before signer dispatch.

## Protocol Binding Registry

Detailed Merkl binding and orchestrator instructions live in `docs/merkl-protocol-bindings.md`. Keep this section as a pointer so `AGENTS.md` stays focused on operating rules and current memory.

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
- **사용자가 "verified" 라고 명시한 항목은 사실로 취급한다.** 같은 항목을 retest / 의심 / 재검증하지 않는다. 데이터 조회만 허용. 예: 사용자가 "Verified final commit SHA = X" 라고 적었으면 git log 로 *조회* 는 가능하지만, "정말 X인지 다시 검증" 식의 도전은 금지. 사용자 신호와 코드 사실이 충돌하면 그 사실만 짧게 인용해 보고하고 사용자가 판단하게 한다.
- **모름 답을 허용한다.** timeline / 완료 시점 / "언제쯤" 류 질문에 데이터 근거가 없으면 "모름. 다음 측정 후 답 가능" 으로 답한다. 그럴듯한 숫자로 빈칸 채우지 않는다.
- **추측에 표시한다.** 답에 데이터 근거 없는 추정이 들어가면 해당 줄 끝에 `[추측]` 으로 명시한다. 사용자가 한눈에 거를 수 있게.

## Workspace Hygiene

- `data/`, `docs/current-status.md`, `dashboard/public/dashboard-status.json` 같은 상태 산출물은 실행 때마다 다시 생성되므로 기본적으로 로컬 운영 artifact로 취급한다.
- 자동 실행 후 워크트리가 다시 더러워졌다면, 먼저 "생성 산출물"인지 "실제 코드 변경"인지 구분해서 설명한다.
- 생성 산출물은 가능하면 git 추적 대상에 다시 섞지 않는다. 코드 변경과 운영 산출물을 한 커밋에 섞지 않는다.
- 코드 변경이 `의미 있는 실행 단위`까지 쌓였으면 사용자 지시를 기다리지 말고 **알아서 커밋**한다. 기준은 예를 들어 새 CLI 1개 + 테스트, 운영 규칙 1묶음 + 회귀 테스트, 또는 동일한 목적의 파일 변경이 3개 이상일 때다.
- 자동 커밋 전에는 반드시 관련 테스트/검증을 먼저 돌리고, 커밋 후에는 `현재 단계`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트` 형식으로 짧게 보고한다.
- 자동 커밋은 `작은 기능 단위`로 자주 한다. unrelated 변경이 섞여 있으면 나눠 커밋하고, push는 사용자가 막지 않는 한 같은 흐름에서 이어서 진행한다.
