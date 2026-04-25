const OFT_SEND_SELECTOR = "0xc7c7f5b3";

function normalizedAddress(value) {
  return String(value || "").toLowerCase();
}

export function requiresAllowanceForQuote(quote) {
  const srcToken = normalizedAddress(quote?.route?.srcToken);
  const txTo = normalizedAddress(quote?.txTo);
  const selector = String(quote?.txData || "").slice(0, 10).toLowerCase();

  // LayerZero OFT sends are invoked on the token contract by the token holder directly.
  if (srcToken && txTo && txTo === srcToken && selector === OFT_SEND_SELECTOR) {
    return false;
  }

  return true;
}
