# BOB Update Response Policy

Last updated: 2026-04-10

## Goal

BOB Claw must adapt to BOB Gateway / Instant Swap / route updates without treating changed behavior as instant profit.

Every BOB technology update is handled as a new experiment until revalidated.

## Update Triggers

Trigger this policy when any of these change:

- BOB Gateway API endpoints
- Instant Swap official launch status
- fee policy or subsidy campaigns
- supported chains or tokens
- quote response schema
- signed quote format
- settlement flow
- LayerZero or messaging behavior
- BOB RPC endpoints
- token contract addresses or decimals
- dashboard / frontend app behavior that exposes new route data

## Response Workflow

1. Freeze live expansion
   - Existing shadow collection may continue.
   - No new live route is enabled automatically.

2. Capture before/after route inventory
   - Run `npm run inventory:gateway`.
   - Save route count, chain set, token set, and BOB-touching routes.
   - Diff against the previous inventory.

3. Probe schema changes
   - Run `npm run verify:gateway:once`.
   - Inspect top-level quote keys.
   - Add parser support only after the new response shape is understood.

4. Rebuild cost model
   - Re-measure `fees`, `feeBreakdown`, `tx.value`, settlement ETA, and latency.
   - If a route claims zero fee, verify all-in cost instead of trusting the label.

5. Reset affected shadow baselines
   - New fee policy means old samples are not comparable.
   - Store new samples with a new `schemaVersion` or `runId`.

6. Run anti-overfit audit
   - Require the audit to pass before canary review.
   - Official announcements do not bypass the audit.

7. Canary only after shadow proof
   - Start with USD 20-50.
   - One route only.
   - Receipt-based realized PnL is the source of truth.

## Fee-Free Instant Swap Handling

If BOB officially launches fee-free Instant Swap:

- Treat it as a route-cost regime change.
- Do not lower thresholds immediately.
- Measure whether protocol fee, solver fee, execution fee, LayerZero fee, and quote spread actually disappear.
- Keep source gas, destination gas, failed transaction expectation, and price impact in the model.
- Reset route rankings after collecting new shadow data.

## Compatibility Design

Adapters should be versioned:

- Gateway route adapter
- Gateway quote parser
- fee model
- token registry
- chain registry
- scoring model

If a parser sees an unknown quote type, it must mark the quote as `unknown_quote_type` and block trading.

## Operational Rule

BOB updates are opportunities, not permissions.

The bot may observe them immediately, but it may not trade them until the same objective gates pass again.

## Automation

Update detection is automated locally on the Mac mini.

Current command:

```bash
npm run watch:gateway-updates
```

The watcher stores route/schema/probe-health snapshots and writes update alerts when route inventory, representative quote schema, or probe health changes.

Alert classes:

- `route_inventory`: chain, token, or route set changed
- `quote_schema`: a successfully answered representative quote changed shape
- `probe_health`: a representative route moved between OK and failed states, or its failure class changed

Recommended schedule:

- hourly during shadow mode
- every 6 hours after stable operation
- immediately after any official BOB release window, if known

Next automation step:

- wire gas and audit alerts into Telegram
- display update status on the mobile dashboard
