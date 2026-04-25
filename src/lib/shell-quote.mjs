export function shellQuote(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/(["\\$`])/g, "\\$1")}"`;
}
