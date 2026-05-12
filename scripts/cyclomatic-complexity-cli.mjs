export function parsePositiveIntegerOption(rawValue, flagName) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${flagName} value: ${rawValue}`);
  }
  return parsed;
}
