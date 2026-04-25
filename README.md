# BOB Claw

Start with [docs/README.md](docs/README.md).

BOB Claw is a native-BTC payback agent: native BTC enters through BOB Gateway, destination-chain strategies harvest BTC-denominated profit, and the payback engine settles configured profit share back to Bitcoin L1. Runtime execution is controlled by committed caps, deterministic policy, signer approval, the kill-switch, and receipt proof.

Useful commands:

- `npm run graph:focus -- status`
- `npm run report:strategy-catalog -- --json`
- `npm run report:payback-status -- --json`
- `npm run executor:merkl-portfolio-orchestrator`
- `npm run advance:canary`
- `npm run ai:claude:kimi`
