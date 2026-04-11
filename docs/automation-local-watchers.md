# Local Watchers

Last updated: 2026-04-10

## Principle

The Mac mini is responsible for automated monitoring.

Cloudflare remains dashboard-only. It does not decide, sign, or watch for protocol updates independently.

## Watchers

### Gateway Update Watcher

Command:

```bash
npm run watch:gateway-updates
```

Detects:

- route count changes
- chain additions/removals
- token additions/removals
- route additions/removals
- representative quote schema changes on routes that still answer successfully
- representative quote probe health changes, such as a route moving from OK to API failure or back to OK

Writes:

- `data/gateway-update-snapshots.jsonl`
- `data/gateway-update-alerts.jsonl` when changes are detected

Recommended early schedule:

- hourly during initial shadow mode
- every 6 hours after route behavior is stable

### Gas Snapshot Watcher

Command:

```bash
npm run gas:snapshot
```

Recommended schedule:

- every 5-15 minutes during active shadow scanning
- immediately before any future live execution

### Overfit Audit Watcher

Command:

```bash
npm run audit:overfit
```

Recommended schedule:

- daily summary
- immediately after any Gateway update alert
- immediately before canary review

### Dashboard Status Builder

Dashboard design and data-contract context:

- `docs/dashboard-context.md`

Command:

```bash
npm run status:dashboard
```

Writes:

- `data/dashboard-status.json`
- `dashboard/public/dashboard-status.json`

This is the read-only artifact for the mobile dashboard. It includes Gateway health, gas freshness, audit blockers, update alerts, and the USD 300 risk rule. It does not contain private keys, signer permissions, wallet seed material, or live execution permission.

The status separates stale gas data from missing gas data. If Gateway supports an EVM chain but no gas snapshot exists for that chain, the dashboard must show `missing_gateway_gas_snapshots` as a blocker.

Local preview:

```bash
npm run dashboard:serve
```

Open `http://localhost:8787`.

## Telegram Integration

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, `npm run watch:gateway-updates` sends a Telegram message when an update alert is written.

Telegram should alert on:

- `updateDetected=true`
- added or removed chains
- added or removed BOB-neighbor routes
- quote schema hash changes
- probe health changes, separated from true schema changes
- repeated Cloudflare or upstream dependency failures
- gas snapshot failure on candidate chains
- audit decision changing from blocked to canary-review possible

The current watcher sends Gateway update alerts. Gas and audit alert routing still need to be wired after their output formats settle.

## Update Handling

When an update alert appears:

1. Keep live trading disabled for new routes or changed quote schemas.
2. Classify the alert as `route_inventory`, `quote_schema`, or `probe_health`.
3. Run inventory, quote verification, gas snapshot, and overfit audit for route/schema alerts.
4. Treat probe health alerts as reliability evidence unless the same failure repeats or blocks a candidate route.
5. Start a new shadow baseline for changed routes or changed schemas.
6. Require objective gates before canary.
