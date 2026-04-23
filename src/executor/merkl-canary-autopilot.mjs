import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tokenAsset } from "../assets/tokens.mjs";
import { config } from "../config/env.mjs";
import { getStrategyCaps, validateStrategyCapsConfig } from "../config/strategy-caps.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import {
  buildAaveProtocolCanaryPlan,
  executeAaveProtocolCanaryPlan,
} from "./helpers/aave-protocol-canary.mjs";
import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
} from "./helpers/erc4626-protocol-canary.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import {
  applyMerklCanaryExecutionReadiness,
  latestTreasuryInventoryForAddress,
} from "../strategy/merkl-canary-execution-readiness.mjs";

const SUPPORTED_BINDING_KINDS = new Set([
  "erc4626_vault_supply_withdraw",
  "euler_evault_deposit_withdraw",
  "aave_v3_pool_supply_withdraw",
]);

const DEFAULT_MIN_ETHEREUM_NOTIONAL_USD = 25;

function finite(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function decimalsForQueueItem(queueItem = {}) {
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  if (Number.isInteger(binding.assetDecimals)) return binding.assetDecimals;
  const assetAddress = binding.assetAddress;
  if (!assetAddress) return 6;
  return tokenAsset(queueItem.chain, assetAddress).decimals;
}

function decimalUsdToMicros(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
  return BigInt(Math.floor(parsed * 1_000_000));
}

function unitsFromUsdByInventory({ balanceUnits, balanceUsd, targetUsd }) {
  const balance = BigInt(balanceUnits || 0);
  if (balance <= 0n) return 0n;
  const targetMicros = decimalUsdToMicros(targetUsd);
  const balanceMicros = decimalUsdToMicros(balanceUsd);
  if (targetMicros <= 0n) return 0n;
  if (balanceMicros <= 0n) return balance;
  const amount = (balance * targetMicros) / balanceMicros;
  if (amount <= 0n) return 0n;
  return amount > balance ? balance : amount;
}

function usdFromUnitsByInventory({ amountUnits, balanceUnits, balanceUsd }) {
  const amount = BigInt(amountUnits || 0);
  const balance = BigInt(balanceUnits || 0);
  const balanceMicros = decimalUsdToMicros(balanceUsd);
  if (amount <= 0n || balance <= 0n || balanceMicros <= 0n) return 0;
  return Number((amount * balanceMicros) / balance) / 1_000_000;
}

function bindingKind(queueItem = {}) {
  return queueItem.protocolBindingPlan?.bindingKind || null;
}

function perChainCapUsd(strategyCaps, chain) {
  const value = strategyCaps?.caps?.perChainUsd?.[chain];
  return Number.isFinite(value) ? Number(value) : Number.POSITIVE_INFINITY;
}

export function sizeMerklCanaryAmount(queueItem = {}, {
  maxUsd = null,
  minEthereumNotionalUsd = DEFAULT_MIN_ETHEREUM_NOTIONAL_USD,
  allowInefficientEthereum = false,
} = {}) {
  const readiness = queueItem.executionReadiness || {};
  const matchedToken = readiness.matchedToken || null;
  const strategyId = queueItem.mappedStrategyId;
  const strategyCaps = getStrategyCaps(strategyId);
  const validation = strategyCaps ? validateStrategyCapsConfig(strategyCaps) : { ok: false, errors: ["missing_strategy_caps"] };
  if (!strategyCaps || !validation.ok) {
    return {
      status: "blocked",
      blockers: !strategyCaps ? ["missing_strategy_caps"] : validation.errors,
      strategyId,
      capUsd: null,
      amount: null,
      amountUsd: null,
      decimals: decimalsForQueueItem(queueItem),
    };
  }
  const hardCapUsd = Math.min(
    finite(strategyCaps.caps.tinyLivePerTxUsd) ?? strategyCaps.caps.perTxUsd,
    perChainCapUsd(strategyCaps, queueItem.chain),
    finite(maxUsd) ?? Number.POSITIVE_INFINITY,
    finite(matchedToken?.estimatedUsd) ?? Number.POSITIVE_INFINITY,
  );

  const blockers = [];
  if (!SUPPORTED_BINDING_KINDS.has(bindingKind(queueItem))) blockers.push("unsupported_binding_kind");
  if (readiness.status !== "inventory_ready") blockers.push(readiness.status || "inventory_not_ready");
  if (!matchedToken?.actual) blockers.push("matched_token_missing");
  if (!Number.isFinite(hardCapUsd) || hardCapUsd <= 0) blockers.push("no_positive_cap_or_inventory_usd");
  if (
    queueItem.chain === "ethereum" &&
    !allowInefficientEthereum &&
    hardCapUsd < minEthereumNotionalUsd
  ) {
    blockers.push("cap_too_low_for_ethereum_gas_efficiency");
  }

  if (blockers.length) {
    return {
      status: "blocked",
      blockers,
      strategyId,
      capUsd: Number.isFinite(hardCapUsd) ? hardCapUsd : null,
      amount: null,
      amountUsd: null,
      decimals: decimalsForQueueItem(queueItem),
    };
  }

  const amountUnits = unitsFromUsdByInventory({
    balanceUnits: matchedToken.actual,
    balanceUsd: matchedToken.estimatedUsd,
    targetUsd: hardCapUsd,
  });
  if (amountUnits <= 0n) {
    return {
      status: "blocked",
      blockers: ["amount_too_small_after_sizing"],
      strategyId,
      capUsd: hardCapUsd,
      amount: null,
      amountUsd: null,
      decimals: decimalsForQueueItem(queueItem),
    };
  }

  return {
    status: "ready",
    blockers: [],
    strategyId,
    capUsd: hardCapUsd,
    amount: amountUnits.toString(),
    amountUsd: usdFromUnitsByInventory({
      amountUnits,
      balanceUnits: matchedToken.actual,
      balanceUsd: matchedToken.estimatedUsd,
    }),
    decimals: decimalsForQueueItem(queueItem),
  };
}

export function selectMerklCanaryAutopilotCandidate(queue = {}, options = {}) {
  const candidates = (queue.queue || [])
    .map((queueItem) => {
      const refreshedItem = options.inventorySnapshot || options.canaryExecutions
        ? applyMerklCanaryExecutionReadiness(queueItem, {
            inventorySnapshot: options.inventorySnapshot,
            canaryExecutions: options.canaryExecutions,
            now: options.now || new Date().toISOString(),
          })
        : queueItem;
      return {
        queueItem: refreshedItem,
        sizing: sizeMerklCanaryAmount(refreshedItem, options),
      };
    });
  const ready = candidates
    .filter((item) => item.sizing.status === "ready")
    .sort((left, right) => {
      if (left.queueItem.chain !== right.queueItem.chain) {
        if (left.queueItem.chain === "ethereum") return 1;
        if (right.queueItem.chain === "ethereum") return -1;
      }
      if ((right.queueItem.priorityScore ?? 0) !== (left.queueItem.priorityScore ?? 0)) {
        return (right.queueItem.priorityScore ?? 0) - (left.queueItem.priorityScore ?? 0);
      }
      return (right.sizing.amountUsd ?? 0) - (left.sizing.amountUsd ?? 0);
    });
  return {
    selected: ready[0] || null,
    readyCount: ready.length,
    candidates,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function compactCandidate(item) {
  return {
    opportunityId: item.queueItem?.opportunityId || null,
    chain: item.queueItem?.chain || null,
    protocolId: item.queueItem?.protocolId || null,
    bindingKind: bindingKind(item.queueItem),
    readiness: item.queueItem?.executionReadiness?.status || null,
    sizingStatus: item.sizing?.status || null,
    amount: item.sizing?.amount || null,
    amountUsd: item.sizing?.amountUsd ?? null,
    blockers: item.sizing?.blockers || [],
  };
}

export async function runMerklCanaryAutopilot({
  execute = false,
  write = false,
  queuePath = join(config.dataDir, "merkl-canary-queue.json"),
  socketPath,
  timeoutMs,
  maxUsd = null,
  minEthereumNotionalUsd = DEFAULT_MIN_ETHEREUM_NOTIONAL_USD,
  allowInefficientEthereum = false,
} = {}) {
  const preflight = await preflightLiveCanarySweep({ socketPath, timeoutMs });
  if (preflight.status !== "ready") {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: preflight.blockedReason || "live_canary_preflight_not_ready",
      preflight,
    };
    if (write) await writeAutopilotReport(report);
    return report;
  }

  const queue = await readJson(queuePath);
  const [inventoryRecords, protocolCanaryExecutions, autopilotExecutions] = await Promise.all([
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "erc4626-protocol-canaries"),
    readJsonl(config.dataDir, "merkl-canary-autopilot-runs").catch(() => []),
  ]);
  const canaryExecutions = [...protocolCanaryExecutions, ...autopilotExecutions];
  const inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, preflight.senderAddress);
  const selection = selectMerklCanaryAutopilotCandidate(queue, {
    maxUsd,
    minEthereumNotionalUsd,
    allowInefficientEthereum,
    inventorySnapshot,
    canaryExecutions,
  });
  if (!selection.selected) {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: "no_autopilot_candidate_ready",
      preflight: {
        status: preflight.status,
        senderAddress: preflight.senderAddress,
        liveBaseline: preflight.liveBaseline,
        killSwitchPath: preflight.killSwitchPath,
      },
      summary: {
        queueCount: queue.queue?.length || 0,
        readyCount: 0,
      },
      candidates: selection.candidates.map(compactCandidate).slice(0, 20),
    };
    if (write) await writeAutopilotReport(report);
    return report;
  }

  const { queueItem, sizing } = selection.selected;
  const buildPlan =
    bindingKind(queueItem) === "aave_v3_pool_supply_withdraw"
      ? buildAaveProtocolCanaryPlan
      : buildErc4626ProtocolCanaryPlan;
  const executePlan =
    bindingKind(queueItem) === "aave_v3_pool_supply_withdraw"
      ? executeAaveProtocolCanaryPlan
      : executeErc4626ProtocolCanaryPlan;
  const plan = await buildPlan({
    queueItem,
    senderAddress: preflight.senderAddress,
    amount: sizing.amount,
  });
  const execution = execute
    ? await executePlan({
        plan,
        socketPath,
        timeoutMs,
      })
    : null;
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: execution?.settlementStatus || "preview_ready",
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      liveBaseline: preflight.liveBaseline,
      killSwitchPath: preflight.killSwitchPath,
    },
    summary: {
      queueCount: queue.queue?.length || 0,
      readyCount: selection.readyCount,
      selectedOpportunityId: queueItem.opportunityId,
      selectedChain: queueItem.chain,
      selectedProtocolId: queueItem.protocolId,
      selectedBindingKind: bindingKind(queueItem),
      selectedAmount: sizing.amount,
      selectedAmountUsd: sizing.amountUsd,
    },
    queueItem,
    sizing,
    plan,
    execution,
  };
  if (write) await writeAutopilotReport(report);
  return report;
}

async function writeAutopilotReport(report) {
  await writeTextIfChanged(join(config.dataDir, "merkl-canary-autopilot-latest.json"), `${safeJsonStringify(report, 2)}\n`);
  await new JsonlStore(config.dataDir).append("merkl-canary-autopilot-runs", JSON.parse(safeJsonStringify(report)));
}

export { DEFAULT_MIN_ETHEREUM_NOTIONAL_USD, SUPPORTED_BINDING_KINDS };
