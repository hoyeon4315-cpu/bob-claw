function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function protocolClassConfidence(record = {}) {
  const ageDays = Number(record.protocol_age_days || 0);
  const ageScore = ageDays >= 365 ? 1 : ageDays >= 90 ? 0.75 : ageDays >= 30 ? 0.55 : 0.35;
  const auditScore = record.audit_status === "audited" ? 1 : record.audit_status === "review" ? 0.72 : 0.45;
  return clamp01(ageScore * auditScore);
}

export function instanceConfidence(record = {}) {
  const total = Number(record.receipts_total_count || 0);
  const positive = Number(record.receipts_positive_count || 0);
  if (!Number.isFinite(total) || total <= 0) return 0.42;
  return clamp01((positive + 1) / (total + 2));
}

export function combinedConfidence(record = {}) {
  return clamp01(protocolClassConfidence(record) * instanceConfidence(record));
}
