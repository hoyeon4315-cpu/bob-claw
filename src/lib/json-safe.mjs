export function safeJsonStringify(value, space) {
  const seen = new WeakSet();
  const replacer = (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Map) return Object.fromEntries(val);
    if (val instanceof Set) return Array.from(val);
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }
    if (val && typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  };
  return JSON.stringify(value, replacer, space);
}
