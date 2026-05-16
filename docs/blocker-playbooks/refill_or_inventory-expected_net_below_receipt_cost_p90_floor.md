# Playbook: expected_net_below_receipt_cost_p90_floor

## When this blocker appears
- The EV gate rejects a candidate because its expected net profit after p90 round-trip cost is not positive.
- Very common on base for wBTC.OFT capital rebalance when using higher-cost methods (LiFi, certain same-chain swaps).

## Root Causes (in order of likelihood)
1. Target amount is too small relative to movement cost on that route.
2. p90 cost assumption for the chain/method is outdated or too conservative.
3. The candidate method itself has genuinely poor economics for the current market conditions.

## Resolution Steps (Quality-first order)

1. **Check if this is capital_rebalance**
   - If `executionReason === "capital_rebalance"`, we already apply very lenient economics (0.05 floor + reduced p90 on base).
   - If still blocked, the method is extremely expensive — consider dropping it from the candidate list for rebalance.

2. **For strategy trades / canaries**
   - Re-evaluate whether this route/method is worth pursuing at current notional.
   - Consider waiting for better market conditions or larger target size.

3. **Long-term fix**
   - Improve p90 cost measurement for the specific method/chain (run more samples via autopilot).
   - Consider maintaining separate cost models for "capital movement" vs "alpha-seeking" intents.

## Related Recipes
- `refill_tighten_ev_or_reduce_target`
- Capital rebalance special handling in `ev-gate.mjs`

## When to Escalate
If this blocker appears repeatedly on the same route despite reasonable targets, it usually means the route is not economically viable for the current capital size → move to "routing_exhausted" thinking or drop the route.