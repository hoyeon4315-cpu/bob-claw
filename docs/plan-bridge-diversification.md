# Bridge Diversification Plan

## Context

Live soak test (2026-04-24) surfaced the following defect: while the BOB
Gateway team had paused routes, the funding-source planner continued to
emit Gateway-backed `cross_chain_swap_via_btc_intermediate` intents. At
runtime Gateway rejected the quote, the executor fell back to Gas.Zip
(native-gas only), and strategy capital cross-chain movement stalled
silently. The automation path kept retrying the dead lane.

Root cause: two gaps.

1. No availability signal for BOB Gateway. The planner and policy engine
   had no way to know the Gateway provider was paused, so the cross-chain
   Gateway method stayed "supported".
2. No alternate bridge provider in the repo. Gas.Zip is native-gas only
   (policy-capped at USD 10/job, USD 50 vendor limit). Odos only covers
   same-chain swaps. There was no second cross-chain lane to fall back to.

## Deterministic Automation Requirements

All fallback must be deterministic code. The LLM permissions matrix in
`AGENTS.md` forbids any runtime LLM decision on which lane to use. The
policy engine must block any Gateway-backed intent while Gateway is
paused, even if the planner was run with stale state.

## Step 1 — Gateway Kill-Switch (shipped in this commit)

- `src/config/gateway.mjs`
  - `GATEWAY_POLICY.enabled` committed flag.
  - `state/gateway.disabled` runtime file (created/removed by the health
    probe; operator can also `touch` / `rm` manually).
  - `resolveGatewayAvailability()` returns `{ available, reason }`.
- `src/executor/policy/gateway-availability.mjs`
  - `checkGatewayAvailability({ intent })` → BLOCK for any Gateway-method
    intent when unavailable; ALLOW otherwise.
- `src/treasury/funding-source-planner.mjs`
  - Accepts `gatewayAvailability`. When `available === false`, Gateway
    cross-chain candidates become `manual_only` with the pause reason
    in `missingInputs`.
  - Emits `alternateBridgeCandidates()` from the bridge registry in the
    same call so the plan still carries at least a conditional fallback
    surface for the dashboard and reports.

Tests: `test/gateway-availability.test.mjs`,
`test/funding-source-planner-gateway-paused.test.mjs`.

## Step 2 — Health Probe (shipped in this commit)

- `src/cli/probe-gateway-health.mjs`
  - `GET /v1/get-routes` with short timeout.
  - On N consecutive failures (default 2), writes
    `state/gateway.disabled` with JSON context.
  - On first success after pause, removes the file.
  - `--watch` flag for unattended cron-style operation.
- `npm run probe:gateway-health` wired into `package.json`.

Operational contract:

1. An unattended cron runs `npm run probe:gateway-health --watch` with
   a 5-minute interval.
2. When Gateway pauses, the probe writes `state/gateway.disabled`
   within two probe windows.
3. Every subsequent planner run picks up the flag via
   `resolveGatewayAvailability()`, so Gateway candidates become
   `manual_only`, and every policy check blocks Gateway intents.
4. When Gateway resumes, the next successful probe removes the file;
   automation returns to Gateway without a committed diff.

## Step 3 — Bridge Provider Registry (shipped in this commit)

- `src/config/bridge-providers.mjs` catalogs BOB Gateway (live) plus
  Across, LiFi, Relay, Stargate (design_scaffold). Each entry declares
  supported chains, asset families, estimated fees/latency, and a live
  status.
- `fallbackProvidersWhenGatewayPaused()` returns the non-Gateway
  subset that supports a given pair, used by the planner.
- `METHOD_PROFILES` in `funding-source-planner.mjs` gained four new
  method ids (`cross_chain_bridge_across|lifi|relay|stargate`) so
  conditional candidates have cost/latency estimates.

## Step 4 — Across Runtime Executor (next commit)

Across v3 is the first fallback to implement fully. Rationale:

- Lowest fee profile (~0.15 USD fixed + ~25 bps) of the surveyed set.
- Permissionless HTTP API (`/suggested-fees`) + on-chain `SpokePool.deposit`.
- Covers Base/Optimism/Unichain/Ethereum/Arbitrum where the current
  wallet float sits.
- Supports USDC, WETH, wBTC — the three assets the treasury planner
  actually moves cross-chain.

Planned deliverables:

1. `src/bridge/across/client.mjs` — quote client wrapping `/suggested-fees`.
2. `src/bridge/across/quote.mjs` — deterministic adapter that resolves
   SpokePool address, deposit calldata, fee breakdown, destination
   settlement window.
3. `src/executor/helpers/across-bridge.mjs` — signer intent builder
   mirroring `gateway-btc-consolidation.mjs` pattern: quote → gas
   estimate → explicit gasLimit buffer → signer intent → receipt
   reconciliation with destination delta proof.
4. Flip `BRIDGE_PROVIDERS.across.status` from `design_scaffold` to `live`
   in the same PR that ships the executor and passing receipt tests.
5. Planner: when Gateway paused and action targets
   USDC/WETH/wBTC on an Across-supported pair, emit an Across
   candidate with `preferred: true` instead of `manual_only` for that
   specific candidate.

## Step 5 — LiFi or Relay (next-next commit)

Adds coverage for Avalanche, BSC, Berachain, Sei, Sonic, Soneium —
chains Across does not support. Same executor pattern. Order depends on
which has the simpler settlement-proof path; Relay currently looks
lighter and has lowest latency for small rotations.

## Step 6 — Auto-fallback Chain in Executor (next-next-next commit)

Policy already blocks Gateway intents; planner already emits alternates.
The remaining piece is runtime: when the first provider's executor
fails 3 consecutive times on the same action, the executor should
auto-advance to the next-ranked provider without a new planner call.
Implementation: extend the refill-job runner to consume the full
candidate list rather than only `selectedMethod`, and write a
`bridge_fallback_triggered` audit record for each advance.

## Non-Goals

- Supporting Gas.Zip for strategy capital. Kept gas-only per committed
  policy in `src/config/gas-zip.mjs`.
- Raising bridge-provider caps at runtime. Any cap for a new provider
  will live in `src/config/strategy-caps.mjs` and require a committed
  diff.
- Implementing every provider. Only Across + one of {LiFi, Relay, Stargate}
  need to be live for the automation to survive a Gateway pause across
  every chain the operator currently holds float on.
