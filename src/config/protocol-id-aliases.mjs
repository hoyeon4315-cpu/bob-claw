const PROTOCOL_ALIASES = Object.freeze({
  morpho: Object.freeze(["morpho", "morpho-blue", "metamorpho"]),
  "aave-v3": Object.freeze(["aave", "aave-v3", "aave_v3", "aave v3"]),
  "compound-v3": Object.freeze(["compound", "compound-v3", "compound_v3", "compound v3"]),
  euler: Object.freeze(["euler", "euler-v2", "euler_v2", "euler v2"]),
  moonwell: Object.freeze(["moonwell"]),
  pendle: Object.freeze(["pendle"]),
});

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
}

export function canonicalProtocolId(value) {
  const normalized = normalize(value);
  for (const [canonical, aliases] of Object.entries(PROTOCOL_ALIASES)) {
    if (aliases.some((alias) => normalize(alias) === normalized)) return canonical;
  }
  return normalized;
}

export function protocolAliasesFor(value) {
  const canonical = canonicalProtocolId(value);
  return Object.freeze([canonical, ...(PROTOCOL_ALIASES[canonical] || [])].map(normalize));
}

export function protocolsMatch(left, right) {
  const leftAliases = protocolAliasesFor(left);
  const rightAliases = protocolAliasesFor(right);
  return leftAliases.some((leftAlias) => (
    rightAliases.some((rightAlias) => (
      leftAlias === rightAlias ||
      leftAlias.includes(rightAlias) ||
      rightAlias.includes(leftAlias)
    ))
  ));
}

export const PROTOCOL_ID_ALIASES = PROTOCOL_ALIASES;
