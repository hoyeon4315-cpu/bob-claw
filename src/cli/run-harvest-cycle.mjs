import { scheduleHarvests, featureEnabled as harvestEnabled } from "../executor/harvest/auto-harvest-scheduler.mjs";
import { buildConvertIntent } from "../executor/harvest/auto-convert-helper.mjs";
import { buildCompoundIntent } from "../executor/harvest/auto-compound.mjs";

export async function runHarvestCycle({
  positions = [],
  dryRun = false,
  now = new Date().toISOString(),
  enqueueImpl = null,
  profile = {},
} = {}) {
  const intents = [];
  const harvestResult = scheduleHarvests({ positions, policy: { profile }, now });

  for (const harvestIntent of harvestResult.intents) {
    intents.push(harvestIntent);

    const pos = positions.find((p) => p.positionId === harvestIntent.positionId);
    if (pos && pos.rewardToken && pos.baseToken) {
      const convertIntent = await buildConvertIntent(
        {
          fromToken: pos.rewardToken,
          toToken: pos.baseToken,
          amount: harvestIntent.amountUsd,
          chain: harvestIntent.chain,
          strategyId: harvestIntent.strategyId,
          now,
        },
        { profile },
      );
      if (convertIntent) {
        intents.push(convertIntent);
      }
    }

    const compoundIntent = buildCompoundIntent(
      {
        strategyId: harvestIntent.strategyId,
        chain: harvestIntent.chain,
        protocol: harvestIntent.protocol,
        harvestedAmountUsd: harvestIntent.amountUsd,
        now,
      },
      { profile },
    );
    if (compoundIntent) {
      intents.push(compoundIntent);
    }
  }

  if (!dryRun && typeof enqueueImpl === "function") {
    for (const intent of intents) {
      await enqueueImpl(intent);
    }
  }

  return {
    dryRun,
    intents,
    summary: {
      harvestCount: harvestResult.intents.length,
      totalIntents: intents.length,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const once = args.includes("--once");
  const intervalArg = args.find((a) => a.startsWith("--interval="));
  const intervalMs = intervalArg ? Number(intervalArg.split("=")[1]) * 1000 : null;

  if (dryRun) {
    const result = await runHarvestCycle({ dryRun: true });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (once) {
    const result = await runHarvestCycle({ dryRun: false });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (intervalMs && intervalMs > 0) {
    while (true) {
      const result = await runHarvestCycle({ dryRun: false });
      console.log(JSON.stringify(result, null, 2));
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const result = await runHarvestCycle({ dryRun: false });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
