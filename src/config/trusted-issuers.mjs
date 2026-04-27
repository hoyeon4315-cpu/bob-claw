export const TRUSTED_ISSUERS = Object.freeze([
  "circle",
  "tether",
  "makerdao",
  "aave",
  "compound",
  "lido",
  "rocket_pool",
  "frax",
  "paxos",
  "bitgo",
]);

export function isTrustedIssuer(issuer) {
  return TRUSTED_ISSUERS.includes(String(issuer || "").toLowerCase());
}
