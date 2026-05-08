export const SCALE_BANDS = Object.freeze([
  Object.freeze({ maxCapitalUsd: 500, bandId: "tiny", multiplier: 0.6 }),
  Object.freeze({ maxCapitalUsd: 1000, bandId: "small", multiplier: 1.0 }),
  Object.freeze({ maxCapitalUsd: 5000, bandId: "moderate", multiplier: 2.0 }),
  Object.freeze({ maxCapitalUsd: 25000, bandId: "operating", multiplier: 4.0 }),
  Object.freeze({ maxCapitalUsd: null, bandId: "scaling", multiplier: 8.0 }),
]);

function finiteNonNegative(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

export function operatingCapitalScaleBand(operatingCapitalUsd = 0) {
  const capitalUsd = finiteNonNegative(operatingCapitalUsd);
  return SCALE_BANDS.find((band) =>
    band.maxCapitalUsd === null || capitalUsd <= band.maxCapitalUsd
  ) || SCALE_BANDS[SCALE_BANDS.length - 1];
}

export function effectiveBudgetUsd(baselineUsd, operatingCapitalUsd) {
  const baseline = Number(baselineUsd);
  if (!Number.isFinite(baseline)) return null;
  const band = operatingCapitalScaleBand(operatingCapitalUsd);
  return roundUsd(baseline * band.multiplier);
}

export function effectiveBudgetMapUsd(baselineMap = {}, operatingCapitalUsd) {
  return Object.freeze(Object.fromEntries(
    Object.entries(baselineMap || {}).map(([key, value]) => [
      key,
      effectiveBudgetUsd(value, operatingCapitalUsd),
    ]),
  ));
}
