// Auto-Gas Manager
// Automatically monitors and refills native gas across all chains
// Prevents "insufficient gas" execution failures
// 
// Architecture:
// 1. Poll all chains for native balance every 5 minutes
// 2. If balance < minThreshold, trigger refill from surplus chain
// 3. Use cheapest bridge route (Across > Gas.Zip > Li.FI)
// 4. Never drain source chain below its own min threshold

import { fetchRealtimePortfolio } from "../executor/realtime-portfolio.mjs";
import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { checkKillSwitch } from "../executor/policy/kill-switch.mjs";

const GAS_CONFIG = Object.freeze({
  pollIntervalMinutes: 5,
  minGasUsd: {
    ethereum: 5,    // ETH expensive, need buffer
    base: 2,        // ETH cheap but need some
    bera: 2,
    avalanche: 2,
    bsc: 2,
    optimism: 2,
    arbitrum: 2,
    sonic: 2,
    unichain: 2,
    soneium: 2,
    sei: 2,
    bob: 2,
  },
  refillAmountUsd: {
    ethereum: 5,    // $5 = ~0.002 ETH at $2300
    base: 3,
    others: 3,
  },
  // Source chain priority for refills (cheapest first)
  sourceChainPriority: ["base", "bob", "optimism", "arbitrum", "ethereum"],
});

async function checkAllChainGas(walletAddress) {
  const portfolio = await fetchRealtimePortfolio(walletAddress, { useCache: true });
  const gasStatus = {};
  
  for (const [chain, data] of Object.entries(portfolio.chainBalances || {})) {
    const native = data.native || {};
    const balanceUsd = native.estimatedUsd || 0;
    const minRequired = GAS_CONFIG.minGasUsd[chain] || GAS_CONFIG.minGasUsd.others;
    const needsRefill = balanceUsd < minRequired;
    
    gasStatus[chain] = {
      balanceUsd,
      minRequired,
      needsRefill,
      shortfallUsd: Math.max(0, minRequired - balanceUsd),
      nativeAmount: native.actual || 0,
    };
  }
  
  return gasStatus;
}

function findBestRefillSource(targetChain, gasStatus) {
  for (const sourceChain of GAS_CONFIG.sourceChainPriority) {
    if (sourceChain === targetChain) continue;
    const source = gasStatus[sourceChain];
    if (!source) continue;
    
    // Source must have surplus after refill
    const refillAmount = GAS_CONFIG.refillAmountUsd[targetChain] || GAS_CONFIG.refillAmountUsd.others;
    const sourceRemaining = source.balanceUsd - refillAmount;
    const sourceMin = GAS_CONFIG.minGasUsd[sourceChain] || GAS_CONFIG.minGasUsd.others;
    
    if (sourceRemaining >= sourceMin) {
      return {
        sourceChain,
        refillAmountUsd: refillAmount,
        sourceRemainingUsd: sourceRemaining,
      };
    }
  }
  return null;
}

async function buildRefillIntent({ targetChain, sourceChain, amountUsd, walletAddress }) {
  // This would integrate with Across/Gas.Zip/Li.FI
  // For now, return intent structure for policy validation
  return {
    intentType: "refill",
    action: "refill",
    strategyId: "auto-gas-manager",
    chain: sourceChain,
    dstChain: targetChain,
    amountUsd,
    walletAddress,
    quote: { observedAt: new Date().toISOString() },
  };
}

export async function runAutoGasManagerTick({
  walletAddress = "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  dryRun = true,
} = {}) {
  // 1. Kill-switch check
  const ks = await checkKillSwitch({});
  if (ks.decision === "BLOCK") {
    return { status: "halted", reason: "kill_switch" };
  }
  
  // 2. Check all chain gas
  const gasStatus = await checkAllChainGas(walletAddress);
  
  // 3. Find chains needing refill
  const needsRefill = Object.entries(gasStatus)
    .filter(([, status]) => status.needsRefill)
    .map(([chain, status]) => ({ chain, ...status }));
  
  if (needsRefill.length === 0) {
    return {
      status: "ok",
      gasStatus,
      refills: [],
      timestamp: new Date().toISOString(),
    };
  }
  
  // 4. Build refill intents
  const refills = [];
  for (const need of needsRefill) {
    const source = findBestRefillSource(need.chain, gasStatus);
    if (!source) {
      refills.push({
        targetChain: need.chain,
        status: "blocked",
        reason: "no_suitable_source_chain",
        shortfallUsd: need.shortfallUsd,
      });
      continue;
    }
    
    const intent = await buildRefillIntent({
      targetChain: need.chain,
      sourceChain: source.sourceChain,
      amountUsd: source.refillAmountUsd,
      walletAddress,
    });
    
    // Policy check
    const policy = await evaluateOpportunityPolicy({
      intent,
      capitalState: { totalDeployableCapital: 520 }, // TODO: real capital
    });
    
    refills.push({
      targetChain: need.chain,
      sourceChain: source.sourceChain,
      amountUsd: source.refillAmountUsd,
      status: policy.decision === "ALLOW" ? "approved" : "blocked",
      policy,
      intent: dryRun ? null : intent,
    });
    
    // Update gas status for next iteration (simulate refill)
    if (!dryRun && policy.decision === "ALLOW") {
      gasStatus[need.chain].balanceUsd += source.refillAmountUsd;
      gasStatus[source.sourceChain].balanceUsd -= source.refillAmountUsd;
    }
  }
  
  return {
    status: "refill_needed",
    gasStatus,
    refills,
    timestamp: new Date().toISOString(),
    dryRun,
  };
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runAutoGasManagerTick({ dryRun: true }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
