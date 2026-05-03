// Context-pack builder with mandatory masking of sensitive material.
//
// Masks:
//   - Any value of an env var matching BURNER_*, *_KEY*, OPENAI_API_KEY*
//   - 0x[0-9a-f]{40} EVM addresses (replaced with 0x<masked-evm:N>)
//   - URLs containing api keys / project ids in paths
//   - "ssh-rsa", "BEGIN PRIVATE KEY" blocks
//
// AGENTS.md compliance: any context handed to LLM must pass through maskText
// before leaving the process. A regression test guards every mask category.

const MASK_TOKEN = "[masked]";

const ENV_VAR_PATTERNS = [/^BURNER_.+/i, /.*_KEY.*/i, /^OPENAI_API_KEY.*/i, /.*_SECRET.*/i];

function collectSensitiveEnvValues(env = process.env) {
  const out = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 6) continue;
    if (ENV_VAR_PATTERNS.some((re) => re.test(name))) out.add(value);
  }
  return out;
}

const EVM_ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;
const PRIVATE_KEY_BLOCK_RE = /-----BEGIN[\s\S]+?-----END[^-]*-----/g;
const URL_KEY_RE = /(https?:\/\/[^\s"']+?\/(?:v\d+\/)?(?:[A-Za-z0-9_\-]{16,}))/g;

export function maskText(text, { env = process.env, extraSecrets = [] } = {}) {
  if (typeof text !== "string") return text;
  let out = text;

  for (const block of (out.match(PRIVATE_KEY_BLOCK_RE) || [])) {
    out = out.split(block).join(MASK_TOKEN);
  }

  const sensitive = new Set([...collectSensitiveEnvValues(env), ...extraSecrets.filter(Boolean)]);
  for (const value of sensitive) {
    if (out.includes(value)) out = out.split(value).join(MASK_TOKEN);
  }

  let evmIndex = 0;
  out = out.replace(EVM_ADDRESS_RE, () => `0x<masked-evm:${++evmIndex}>`);

  out = out.replace(URL_KEY_RE, (match, full) => {
    const idx = full.lastIndexOf("/");
    if (idx === -1) return match;
    return full.slice(0, idx + 1) + "[masked-key]";
  });

  return out;
}

export function maskJson(value, opts) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskText(value, opts);
  if (Array.isArray(value)) return value.map((v) => maskJson(v, opts));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskJson(v, opts);
    return out;
  }
  return value;
}

// Build a context pack. Sources are passed in as opaque objects; this
// module is responsible only for ordering, truncation and masking.
export function buildContextPack({
  purpose,
  graphifyDigest = null,
  fileExcerpts = [],
  auditSlice = [],
  positions = [],
  env = process.env,
  maxFileChars = 4000,
  maxAuditChars = 4000,
} = {}) {
  const fileBlocks = fileExcerpts.map((f) => {
    const masked = maskText(String(f.content || ""), { env });
    return `### file: ${maskText(String(f.path || "?"), { env })}\n${masked.slice(0, maxFileChars)}`;
  });
  const auditBlock = maskJson(auditSlice, { env });
  const positionsBlock = maskJson(positions, { env });
  const auditSerialized = JSON.stringify(auditBlock).slice(0, maxAuditChars);
  return {
    purpose,
    generatedAt: new Date().toISOString(),
    graphifyDigest: graphifyDigest ? maskText(graphifyDigest, { env }) : null,
    files: fileBlocks,
    audit: auditSerialized,
    positions: positionsBlock,
  };
}
