import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { sendSignerCommand, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { runMasterAutopilot } from "./master-auto-plan.mjs";

async function executeApprovedIntents() {
  console.log("Auto-executor: Fetching approved intents from master autopilot...");
  
  const tick = await runMasterAutopilot({ dryRun: false });
  
  if (tick.status !== "active") {
    console.log("Autopilot status:", tick.status, tick.reason);
    return;
  }
  
  const approved = tick.approved || [];
  console.log("Approved intents:", approved.length);
  
  for (const item of approved) {
    const intent = item.intent;
    console.log("Executing:", intent.strategyId, intent.intentType, "$" + intent.amountUsd);
    
    try {
      const result = await sendSignerCommand({
        message: {
          command: "sign_and_broadcast",
          intent,
          awaitConfirmation: true,
          confirmations: 1,
          timeoutMs: 120_000,
        },
        socketPath: signerSocketPath(),
        timeoutMs: signerClientTimeoutMs(),
      });
      
      console.log("Result:", result.status);
      if (result.policy) {
        console.log("Policy decision:", result.policy.decision);
        console.log("Policy blockers:", result.policy.blockers);
      }
      if (result.broadcast?.txHash) {
        console.log("Tx:", result.broadcast.txHash);
      }
      if (result.error) {
        console.error("Error:", result.error.message);
      }
      if (result.rejection) {
        console.error("Rejection:", result.rejection);
      }
    } catch (err) {
      console.error("Execution failed:", err.message);
    }
  }
  
  console.log("Auto-executor tick complete.");
}

executeApprovedIntents().catch((err) => {
  console.error(err);
  process.exit(1);
});
