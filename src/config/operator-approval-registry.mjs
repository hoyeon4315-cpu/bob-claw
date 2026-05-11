/**
 * Scoped operator approval registry.
 *
 * Operator may append entries via committed diffs to indicate that a
 * specific scope has been reviewed and approved for automated execution.
 * Approvals are advisory only: they downgrade `manual_operator_review_required`
 * from a hard blocker to a filter or remove it entirely, but they do not
 * bypass safety policy, caps, kill-switch, or signer approval.
 */

export const OPERATOR_APPROVAL_REGISTRY = Object.freeze([
  // Example entry (committed diff required to add):
  // { scopeType: "merkl_protocol", scopeId: "aave-v3:base", approvedAt: "2026-05-11T00:00:00Z", reason: "binding verified" }
]);

/**
 * Check whether a scope has operator approval.
 * Supports exact match and wildcard family prefix match.
 */
export function isOperatorApproved(scopeType, scopeId) {
  if (!scopeType || !scopeId) return false;
  return OPERATOR_APPROVAL_REGISTRY.some((entry) => {
    if (entry.scopeType !== scopeType) return false;
    if (entry.scopeId === scopeId) return true;
    if (entry.scopeId === "*") return true;
    return false;
  });
}

/**
 * Match an approval entry against a descriptor object.
 * Descriptor may include scopeType, scopeId, family, strategyId, chain, protocolId.
 */
export function matchOperatorApproval(descriptor = {}) {
  const { scopeType, scopeId } = descriptor;
  if (scopeType && scopeId && isOperatorApproved(scopeType, scopeId)) return true;

  // Fallback: try family-scoped approvals
  if (descriptor.family) {
    if (isOperatorApproved("radar_family", descriptor.family)) return true;
    if (isOperatorApproved("strategy_family", descriptor.family)) return true;
  }

  // Fallback: try chain+protocol scoped approval for Merkl-like entries
  if (descriptor.chain && descriptor.protocolId) {
    if (isOperatorApproved("merkl_protocol", `${descriptor.protocolId}:${descriptor.chain}`)) return true;
    if (isOperatorApproved("protocol_chain", `${descriptor.protocolId}:${descriptor.chain}`)) return true;
  }

  return false;
}
