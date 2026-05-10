import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
} from "../../../../executor/helpers/erc4626-protocol-canary.mjs";
import {
  executeErc4626PortfolioExit,
} from "../../../../executor/helpers/merkl-portfolio-exit-executors.mjs";
import { registerBinding } from "../../../../executor/protocol-binding-registry.mjs";

export function registerPendleBinding() {
  registerBinding({
    bindingKind: "pendle_yt_buy_sell_redeem",
    planBuilder: buildErc4626ProtocolCanaryPlan,
    planExecutor: executeErc4626ProtocolCanaryPlan,
    exitExecutor: executeErc4626PortfolioExit,
    intentType: "pendle_yt_entry",
    family: "pendle_yt",
  });
}
