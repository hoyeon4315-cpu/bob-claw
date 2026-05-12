/**
 * @param {unknown} value
 */
export function shellQuote(value) {
  return JSON.stringify(String(value));
}
