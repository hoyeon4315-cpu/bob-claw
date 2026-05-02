export function jsonSafeReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function safeJsonStringify(value, space = 0) {
  return JSON.stringify(value, jsonSafeReplacer, space);
}
