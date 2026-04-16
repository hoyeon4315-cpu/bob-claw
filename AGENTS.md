# BOB Claw Rules

## Core Context

- Capital sizing is operator-controlled per strategy. There is no project-wide ring-fenced wallet anymore — the operator decides which wallet a given strategy uses and what cap that wallet runs at, declared in the strategy's config.
- Primary strategy: BOB Gateway / Instant Swap quote verification.
- Secondary strategies (active scope): wrapper-BTC arbitrage across Gateway-supported chains, and lending-protocol looping (recursive supply/borrow yield) on chains where unwind cost is measured.
- Ethereum L1 trading is allowed when fee analysis shows positive expected value after gas and slippage. The previous "L1 disabled for the USD 300 phase" rule no longer applies.

## Objective Review

- Do not say a route is profitable until measured quote, fee, latency, and execution data support it.
- Treat all profit claims as hypotheses until replay/shadow/live receipt data confirms them.
- If data says no trade, no trade.

## Execution Safety

- This system is designed for unattended, multichain, fully-automated execution. There is no manual promotion step and no tiered phase gate. A strategy runs the moment its config declares `autoExecute: true` with valid caps committed to the repo; it halts the moment the kill-switch file exists, the drawdown limit trips, or its caps are breached.
- Private keys live only inside the signer daemon process, loaded from OS keystore files via env-referenced paths: `BURNER_EVM_KEY_PATH` for all EVM chains, `BURNER_BTC_KEY_PATH` for native BTC signing. (`BURNER_PRIVATE_KEY_PATH` is a backwards-compat alias pointing to the EVM key.) Keys must never appear in: LLM context (Claude / Codex / Copilot chat transcripts), dashboards, Telegram handlers, the repo, tool call arguments, logs, or audit files. Code written by any LLM may reference the key only via the env/path indirection — never the value.
- No LLM in the trade execution decision path. LLMs propose strategies, write code, and edit configs via committed diffs; a deterministic policy engine validates every intent; the signer signs only after policy approval. "Vibe coding" does not cross this line — code may be written by an LLM, but the runtime decision to sign is always policy code, not an LLM.
- Emergency stop is a file. The signer checks `$KILL_SWITCH_PATH` before every broadcast on every chain. `touch` it and everything halts; remove it to resume.
- No unlimited approvals. Approvals are either per-tx (Permit2 where supported) or time-boxed and auto-revoked when a strategy goes idle.
- Leverage strategies (lending loops, perps) declare `healthFactorMin`, `liquidationBufferPct`, and an emergency-unwind path in their config. A breach triggers automatic unwind, not a wait.
- Auto-escalation of position size based on recent wins (martingale) is banned. Sizing comes from the strategy's declared caps, not from a streak counter.

## Risk Limits

- Caps are code, not env vars. Per-strategy per-tx USD, per-day USD, per-chain USD, and `maxDailyLossUsd` live in config files under `src/config/` (or the strategy's own config module). Raising a cap requires a committed diff — an LLM, dashboard, or Telegram handler cannot raise a cap at runtime.
- A strategy without a declared per-tx cap, per-day cap, and `maxDailyLossUsd` must not run. The signer rejects intents from capless strategies.
- Minimum net profit: positive after measured gas + slippage. Reject when estimated edge is at or below the measured gas+slippage variance floor.
- For leverage strategies: configured `healthFactorMin` and `liquidationBufferPct` must hold pre- and post-trade; either breach blocks the trade and triggers unwind.
- Max consecutive failures per strategy: 3 → auto-pause that strategy until the operator resumes it via a committed config flip.
- Failed-gas budget guard (`maxFailedGasCost24hUsd`) is enforced by the daemon — a route burning gas without fills auto-pauses.
- Drawdown kill-switch: if a strategy's realized 24h PnL drops below its `maxDailyLossUsd`, the daemon halts that strategy for the remainder of the day.
- Stale quotes rejected.
- On-chain note: `src/contracts/BalancerFlashArb.sol` ships with `minProfitUsdc = 300000` (USD 0.30, 6 decimals) in the constructor. Off-chain policy may permit any positive-EV trade, but the deployed contract still rejects flash-arb profits below USD 0.30 until it is redeployed or made owner-settable. Non-flash strategies are unaffected.

## Unattended Execution Architecture

Every executor, capital mover, and strategy module fits this architecture. Same architecture for dev burner and real capital — only the key-custody backend and the cap numbers change.

**Components**

1. **Proposer** — strategy modules under `src/strategy/` plus any LLM while coding. Emits trade intents as typed JSON. No keys.
2. **Policy Engine** — `src/executor/policy/` — pure functions. Validates intents against caps, HF floors, slippage, kill-switch, drawdown, stale-quote, approval hygiene, consecutive-failure counter. Fully unit-testable. No keys.
3. **Signer Daemon** — `src/executor/signer/` — a long-running separate process. Holds keys for all chains. Signs only intents approved by Policy. Exposes a local socket. Two backends in tandem:
   - `EvmLocalKeySigner` — reads `BURNER_EVM_KEY_PATH`, signs for every EVM chain in `src/config/chains.mjs`, per-chain nonce manager (ethers v6).
   - `BtcLocalKeySigner` — reads `BURNER_BTC_KEY_PATH` (WIF or hex), UTXO selection, fee estimation, PSBT construction, RBF support. Used for Gateway onramp and native BTC sends.
   Both share the same `Signer` interface so they can be swapped later for `HardwareSigner` / `MpcSigner` with a one-line change.
4. **Capital Manager** — `src/executor/capital/` — maintains per-chain target balances declared in config. Auto-rebalances by enqueuing swap/bridge intents through the Signer. Replaces the human being told "swap this, hold that."
5. **Gas Float Keeper** — sub-policy of Capital Manager. Per-chain minimum native-token balance. Below threshold → auto-top-up from a configured source chain/asset.
6. **Receipt Ingestor** — every broadcast result (tx hash, revert reason, HF path, liquidation-buffer path, realized cost, realized carry) is appended to audit log and fed into the existing `ingest:*` pipelines automatically. No manual `npm run ingest:...`.
7. **Kill-switch + Watchdog** — file-based hard stop checked per-tx. Watchdog heartbeats the daemon; missed heartbeats → Telegram alert + auto-halt.
8. **Alerter** — Telegram. Reports cap utilization, pauses, kill events, daily PnL. Read-only; no command-side signing from Telegram.

**Multichain is the default.** Every chain has its own RPC config, nonce manager, signer sub-account (or chain-indexed child key), and cap sub-budget. Strategies declare the chain set they touch.

**LLM permissions matrix** (applies to Claude, Copilot, Codex, and any future coding agent):

| May | May not |
|---|---|
| Write or edit strategy code under `src/strategy/` | Embed or log a private key, even briefly |
| Write or edit policy functions under `src/executor/policy/` | Call the signer with raw tx bytes bypassing policy |
| Propose cap changes via a committed diff | Raise caps at runtime through any side channel |
| Read audit logs | Delete, rotate in place, or rewrite audit logs |
| Configure a new chain by editing config | Move funds outside the Capital Manager |
| Trigger a manual dev-mode run | Decide when to sign — that's policy code's call |

**Audit log** — every sign attempt (approved, rejected, errored) appends to `logs/signer-audit.jsonl` with timestamp, strategy id, chain, intent hash, policy verdict, and (on broadcast) tx hash + receipt. Append-only. Never deleted. Never rotated in place.

## Build Order

1. Route and quote verification.
2. Shadow/replay harness.
3. Telegram and mobile dashboard.
4. Testnet/fork execution harness.
5. Tiny live canary.
6. Live operation with per-strategy caps and per-strategy unwind paths.

## Dashboard Context

- Before changing dashboard UI, read `docs/dashboard-context.md`.
- The dashboard is a mobile-first BTC -> BOB -> chains flow map, not a table-first operator page.
- The browser may only read `dashboard/public/dashboard-status.json`; do not publish raw JSONL data.
- Dashboard copy must stay user-facing and visual. Avoid internal schema, signer, executor, or strategy jargon.
- `liveTrading` reflects whether the daemon's policy gate currently passes. `ALLOWED` is a normal state, not an exceptional one. The dashboard still must not hold keys, sign, or decide whether to trade — it only reports the gate state.

## Reporting

- Every result must distinguish paper PnL, estimated PnL, and realized PnL.
- Every route report must include sample count, quote success rate, latency, fees, and rejection reasons.

## Operator Memory

- When the user asks about the current strategies, answer in simple Korean first and keep the first explanation short.
- When freshness matters, prefer `npm run report:strategy-catalog -- --json` before giving the strategy snapshot.
- Latest known strategy snapshot:
  - BTC Gateway loops: `candidate_for_validation`
  - BTC proxy spreads: `thin_coverage`
  - BTC stable entry/exit loops: `measured_below_policy`
  - BTC triangular/flash: `measured_below_policy`
  - Direct ETH-family Gateway: `unobserved`
  - ETH/stable mixed loops: `unobserved`
  - ETH mixed triangle: `analysis_only`
  - ETH mixed flash: `analysis_only`
  - Lending-protocol looping: `candidate_for_design` (scaffolding present, executor not built)
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
