export function scoreBriberyRevenue({
  validator,
  blockBuilder,
  chain,
  mockSource = null,
  profile,
}) {
  const source = mockSource || { estimatedRevenueBps: 0, confidence: 0, source: "mock" }

  const result = {
    estimatedRevenueBps: source.estimatedRevenueBps,
    source: source.source || "mock",
    confidence: source.confidence,
  }

  if (profile && !featureEnabled(profile)) return result

  if (result.estimatedRevenueBps > 5 && result.confidence > 0.7) {
    result.action = {
      type: "review",
      reason: "high bribery revenue detected",
      context: { validator, blockBuilder, chain },
    }
  }

  return result
}

export function featureEnabled(profile) {
  return profile?.briberySourceEnabled === true
}
