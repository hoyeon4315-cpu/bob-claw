// Shared risk-daemon types and helpers.
// All risk modules are pure functions: (state) => RiskVerdict.
// Data fetching is the caller's concern; modules do no I/O, no LLM.

export const SEVERITY = Object.freeze({
  INFO: "info",
  WARN: "warn",
  HALT_STRATEGY: "halt_strategy",
  HALT_PROTOCOL: "halt_protocol",
  UNWIND_ALL: "unwind_all",
  KILL_SWITCH: "kill_switch",
});

export function makeVerdict({
  moduleId,
  ok = true,
  severity = SEVERITY.INFO,
  action = "none",
  violations = [],
  details = {},
}) {
  return Object.freeze({
    schemaVersion: 1,
    moduleId,
    ok,
    severity,
    action,
    violations: Object.freeze([...violations]),
    details: Object.freeze({ ...details }),
  });
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function requireNonNegativeNumber(value, label) {
  if (!isFiniteNumber(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

// Exponentially-weighted moving average with half-life in samples.
export function ewma(samples, halfLifeSamples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (!isFiniteNumber(halfLifeSamples) || halfLifeSamples <= 0) {
    throw new TypeError("halfLifeSamples must be positive finite number");
  }
  const lambda = Math.log(2) / halfLifeSamples;
  const alpha = 1 - Math.exp(-lambda);
  let s = samples[0];
  for (let i = 1; i < samples.length; i += 1) {
    if (!isFiniteNumber(samples[i])) continue;
    s = alpha * samples[i] + (1 - alpha) * s;
  }
  return s;
}
