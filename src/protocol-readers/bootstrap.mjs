// Auto-registration bootstrap. Import this once at runtime entry to register all
// in-tree readers with the central registry.

import { registerReader } from "./registry.mjs";
import { erc4626ReaderRegistration } from "./readers/erc4626.mjs";
import { aaveV3ReaderRegistration } from "./readers/aave-v3.mjs";
import { beefyReaderRegistration } from "./readers/beefy.mjs";
import { pendleReaderRegistration } from "./readers/pendle.mjs";

let _bootstrapped = false;

export function bootstrapReaders() {
  if (_bootstrapped) return;
  registerReader(erc4626ReaderRegistration);
  registerReader(aaveV3ReaderRegistration);
  registerReader(beefyReaderRegistration);
  registerReader(pendleReaderRegistration);
  _bootstrapped = true;
}

export function _resetBootstrap() {
  _bootstrapped = false;
}
