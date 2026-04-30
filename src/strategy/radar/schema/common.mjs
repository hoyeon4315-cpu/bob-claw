export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

export function validationResult({ value = null, blockers = [] } = {}) {
  return deepFreeze({
    ok: blockers.length === 0,
    blockers,
    value: blockers.length === 0 ? deepFreeze(value) : null,
  });
}

export function missingFieldBlockers(input = {}, required = []) {
  return required
    .filter((field) => !Object.hasOwn(input, field) || input[field] === undefined)
    .map((field) => `missing_${field}`);
}

export function enumBlocker(input = {}, field, allowed = []) {
  if (input[field] === undefined || input[field] === null) return null;
  return allowed.includes(input[field]) ? null : `invalid_${field}`;
}

export function arrayBlocker(input = {}, field) {
  if (input[field] === undefined || input[field] === null) return null;
  return Array.isArray(input[field]) ? null : `invalid_${field}`;
}

export function compactBlockers(values = []) {
  return values.filter(Boolean);
}
