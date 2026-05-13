const DEFAULT_REDACTION = "[REDACTED]";

const SAFE_KEY_NAMES = new Set([
  "address",
  "blockHash",
  "chain",
  "chainId",
  "event",
  "from",
  "intentHash",
  "policyVerdict",
  "routeKey",
  "status",
  "strategyId",
  "to",
  "txHash",
  "transactionHash",
  "type",
]);

const SECRET_KEY_PATTERN =
  /(^|[_-])(access[_-]?token|api[_-]?key|auth|auth[_-]?token|authorization|bearer|cookie|id[_-]?token|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|telegram[_-]?token|webhook|webhook[_-]?token|wif)([_-]|$)/i;
const SIGNED_TX_KEY_PATTERN =
  /(^|[_-])(raw[_-]?)?(signed[_-]?tx|transaction[_-]?payload|raw[_-]?tx|serialized[_-]?tx)([_-]|$)/i;
const KEY_PATH_PATTERN = /(^|[_-])(burner[_-]?)?(btc[_-]?|evm[_-]?)?(key|wallet|keystore)[_-]?path$/i;

const RAW_LONG_HEX_PATTERN = /\b0x[a-fA-F0-9]{130,}\b/g;
const PRIVATE_KEY_HEX_PATTERN = /\b0x[a-fA-F0-9]{64}\b/g;
const WIF_PATTERN = /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi;
const TELEGRAM_TOKEN_PATTERN = /\b\d{6,12}:[A-Za-z0-9_-]{24,}\b/g;
const API_TOKEN_PATTERN = /\b(?:sk|ghp|github_pat|xox[baprs])-[A-Za-z0-9_=-]{16,}\b/g;
const SEED_PHRASE_PATTERN = /\b(?:seed phrase|mnemonic)\s*[:=]\s*(?:[a-z]+[\s,]+){11,23}[a-z]+\b/gi;
const CUSTODY_PATH_PATTERN =
  /(^|[\s"'=])((?:~|\/Users\/[^/\s"']+|\/var\/[^/\s"']+|\/private\/[^/\s"']+|\/tmp\/[^/\s"']+)?\/[^\s"']*(?:\.bob-claw|keystore|keys|wallet|signer|burner)[^\s"']*)/gi;

function marker(reason) {
  return `${DEFAULT_REDACTION.slice(0, -1)}:${reason}]`;
}

function keyName(path) {
  return String(path.at(-1) ?? "");
}

function isSafeKey(key) {
  return SAFE_KEY_NAMES.has(key);
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key) || KEY_PATH_PATTERN.test(key);
}

function isSignedTxKey(key) {
  return SIGNED_TX_KEY_PATTERN.test(key);
}

function secretMarkerForKey(key) {
  if (/private[_-]?key|wif/i.test(key)) return marker("private_key");
  if (/seed|mnemonic/i.test(key)) return marker("seed_phrase");
  return marker("secret");
}

function redactString(value, { key = "" } = {}) {
  if (!value) return value;
  if (isSafeKey(key)) return value;

  let output = value;
  output = output.replace(SEED_PHRASE_PATTERN, marker("seed_phrase"));
  output = output.replace(BEARER_PATTERN, marker("secret"));
  output = output.replace(TELEGRAM_TOKEN_PATTERN, marker("secret"));
  output = output.replace(API_TOKEN_PATTERN, marker("secret"));
  output = output.replace(WIF_PATTERN, marker("private_key"));
  output = output.replace(RAW_LONG_HEX_PATTERN, marker("signed_tx"));
  output = output.replace(CUSTODY_PATH_PATTERN, `$1${marker("key_path")}`);

  if (isSecretKey(key)) {
    output = output.replace(PRIVATE_KEY_HEX_PATTERN, marker("private_key"));
  }

  return output;
}

function redactPlainObject(value, path, seen) {
  const redacted = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (isSignedTxKey(entryKey)) {
      redacted[entryKey] = marker("signed_tx");
    } else if (KEY_PATH_PATTERN.test(entryKey)) {
      redacted[entryKey] = marker("key_path");
    } else if (isSecretKey(entryKey)) {
      redacted[entryKey] = secretMarkerForKey(entryKey);
    } else {
      redacted[entryKey] = redactValue(entryValue, [...path, entryKey], seen);
    }
  }
  return redacted;
}

function redactValue(value, path, seen) {
  const key = keyName(path);

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (isSignedTxKey(key)) return marker("signed_tx");
    if (KEY_PATH_PATTERN.test(key)) return marker("key_path");
    if (isSecretKey(key)) return secretMarkerForKey(key);
    return redactString(value, { key });
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const redacted = value.map((item, index) => redactValue(item, [...path, index], seen));
    seen.delete(value);
    return redacted;
  }

  if (value instanceof Error) {
    const errorRecord = {
      name: value.name,
      message: redactString(value.message || "", { key: "message" }),
    };
    if (value.code) errorRecord.code = value.code;
    return errorRecord;
  }

  const redacted = redactPlainObject(value, path, seen);
  seen.delete(value);
  return redacted;
}

export function redactLogValue(value) {
  return redactValue(value, [], new WeakSet());
}

export function sanitizeLogRecord(record) {
  return redactLogValue(record);
}

export function safeJsonStringifyForLog(value, space) {
  return JSON.stringify(redactLogValue(value), null, space);
}
