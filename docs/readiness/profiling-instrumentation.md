# Profiling Instrumentation

This repository now includes real development-safe CPU profiling via `0x` for
read-only readiness checks, dashboard build work, and unit-test diagnostics.
The tooling is intended for local performance diagnosis only. It does not grant
live execution authority, change policy behavior, or start runtime daemons.

## What is configured

- `0x` is installed as a local dev dependency for Node flamegraph generation.
- `scripts/run-profile-target.mjs` is the single profiling entrypoint.
- `scripts/profile-targets.mjs` defines the fixed allowlist of safe targets.
- `npm run profile:smoke` performs a real smoke run and verifies that a
  flamegraph artifact is produced.

Allowed profiling targets:

- `check:dead-code`
- `check:tech-debt`
- `check:duplicate-code`
- `check:architecture`
- `dashboard:build`
- `test:unit`

List them locally with:

```bash
npm run profile:list
```

## Usage

Run one of the committed profiling entrypoints:

```bash
npm run profile:check:tech-debt
npm run profile:dashboard:build
npm run profile:test:unit
```

Run the smoke verification:

```bash
npm run profile:smoke
```

Each profile run executes the real command under `0x` and writes a local
flamegraph bundle under `artifacts/profiling/`.

## Safety boundaries

- Production and continuous profiling remain off by default.
- No profiling run sends data to Datadog, New Relic, Pyroscope, Parca, or any
  other external service.
- Profiling runs use a sanitized environment that strips sensitive variables
  such as API keys, Telegram tokens, private-key paths, and wallet-signing
  secrets before invoking `0x`.
- The allowlist is fixed in source. Arbitrary commands cannot be profiled
  through the committed scripts.

These commands are intentionally out of scope and must not be wrapped by the
profiling scripts:

- `executor:daemon`
- `executor:watchdog`
- `executor:all-chain-autopilot`
- `executor:payback-scheduler`
- `executor:merkl-canary-autopilot`
- `executor:merkl-portfolio-orchestrator`
- `deploy`
- `deploy:dashboard:cloudflare`
- any signer, broadcast, bridge, or capital-mover execution command

## Generated artifacts

Profiling output is generated locally and gitignored:

- `artifacts/profiling/**`

Do not commit profiling HTML, stack captures, runtime JSON, dashboard public
JSON, logs, data snapshots, coverage, or dependency/cache directories as part
of profiling work.
