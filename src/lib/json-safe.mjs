/**
 * @param {string} _key
 * @param {unknown} value
 */
export function jsonSafeReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * @param {unknown} value
 * @param {number | string} [space]
 * @returns {string | undefined}
 */
export function safeJsonStringify(value, space = 0) {
  return JSON.stringify(value, jsonSafeReplacer, space);
}
