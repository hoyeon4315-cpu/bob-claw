export const PRIMARY_OPERATOR_BTC_ADDRESS = "bc1p809tstru8s6x7accmac2xl3rczcfzzh96myh09gy68d883y4uzushkyww0";

export const OPERATOR_BTC_ADDRESSES = Object.freeze([
  Object.freeze({
    address: PRIMARY_OPERATOR_BTC_ADDRESS,
    role: "operator_funding_and_payback",
    status: "approved",
    declaredAt: "2026-05-10",
    approvedFor: Object.freeze([
      "deposit_watch",
      "operating_capital_ingress",
      "native_btc_onramp",
      "payback_destination",
      "settlement_observation",
    ]),
    scope:
      "Operator-controlled native BTC address. Confirmed deposits may become operating capital only through committed policy, Gateway/capital-manager routing, policy checks, signer approval, and append-only audit evidence.",
  }),
  Object.freeze({
    address: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
    role: "legacy_signer_funding_observation",
    status: "approved_observation_only",
    declaredAt: "2026-05-10",
    approvedFor: Object.freeze([
      "deposit_watch",
      "settlement_observation",
      "historical_gateway_onramp_preview",
    ]),
    scope:
      "Historical signer BTC address kept for read-only settlement and funding traceability. It is not a hidden cap or payback override.",
  }),
]);

export function listApprovedOperatorBtcAddresses({ purpose = null, includeObservationOnly = true } = {}) {
  return OPERATOR_BTC_ADDRESSES
    .filter((entry) => includeObservationOnly || entry.status === "approved")
    .filter((entry) => !purpose || entry.approvedFor.includes(purpose))
    .map((entry) => entry.address);
}

export function resolveOperatorBtcAddress(address = PRIMARY_OPERATOR_BTC_ADDRESS) {
  const normalized = String(address || "").trim();
  return OPERATOR_BTC_ADDRESSES.find((entry) => entry.address === normalized) || null;
}

export function isApprovedOperatorBtcAddress(address, { purpose = null } = {}) {
  const entry = resolveOperatorBtcAddress(address);
  if (!entry) return false;
  if (entry.status !== "approved" && entry.status !== "approved_observation_only") return false;
  if (!purpose) return true;
  return entry.approvedFor.includes(purpose);
}
