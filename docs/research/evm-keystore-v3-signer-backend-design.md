# EVM Keystore V3 Signer Backend Design

Status: research only
Date: 2026-05-07

## Decision

Do not replace `BURNER_EVM_KEY_PATH` private-key file loading in this diff. Keystore V3 can be evaluated as an optional signer backend only after password source, OS keychain behavior, file permissions, and daemon restart behavior are specified and tested.

## Why This Is Not A BNBAgent Runtime Adoption

BNBAgent SDK's wallet provider keeps app-level encrypted keystore convenience near its agent runtime. BOB Claw keeps private keys inside signer daemon boundaries. A Keystore V3 backend must preserve that boundary.

## Required Properties

- Key material is still read only by `src/executor/signer/*`.
- Keystore JSON path is supplied by env path indirection.
- Password is supplied by OS keychain command or a file path with `0600` permissions.
- No password value appears in CLI args, logs, audit rows, dashboard JSON, data artifacts, or LLM context.
- Unit tests use fixture keystores and fixture passwords only.
- The default live backend remains unchanged until explicit operator approval.

## Proposed Backend Shape

```js
export class EvmKeystoreV3SignerBackend {
  constructor({ keystorePath, passwordReader, walletFactory }) {}
  async privateKey() {}
}
```

## Confidence Loop

| Loophole | Fix |
| --- | --- |
| App-level wallet import breaks signer boundary | Backend lives only under `src/executor/signer/*`. |
| Password leaks through CLI args | Password source must be file path or OS keychain, never raw arg. |
| Decrypted private key appears in errors | Tests assert thrown messages omit secret values. |
| Keystore becomes default accidentally | Source diff must keep current backend default unchanged. |
| BNBAgent SDK becomes dependency | Use `ethers` local keystore support or a local parser; no BNBAgent import. |

## Verification Commands For A Source Diff

```bash
node --test test/evm-keystore-v3-signer-backend.test.mjs test/evm-local-signer.test.mjs
npm run ops:runtime-readiness:json
rg -n "bnbagent|password|privateKey" src/executor/signer test/evm-keystore-v3-signer-backend.test.mjs
```

## Rejection Conditions

- Password passed in command-line args.
- Password or decrypted private key included in thrown error messages.
- Keystore backend imported outside signer modules.
- Dashboard/data/report surface includes raw keystore contents.
