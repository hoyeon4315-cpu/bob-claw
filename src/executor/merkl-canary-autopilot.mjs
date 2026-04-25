import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tokenAsset, ZERO_TOKEN } from "../assets/tokens.mjs";
import { evaluateMerklAutoEntry } from "../config/merkl-auto-entry.mjs";
import { config } from "../config/env.mjs";
import { getStrategyCaps, validateStrategyCapsConfig } from "../config/strategy-caps.mjs";
import { evaluateCapCheck } from "./policy/cap-check.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import { readErc20Balance, readNativeBalance } from "../evm/account-state.mjs";
import {
  applyMerklCanaryExecutionReadiness,
  latestTreasuryInventoryForAddress,
} from "../strategy/merkl-canary-execution-readiness.mjs";
import {
  isSupportedBindingKind,
  resolveIntentType,
  resolvePlanBuilder,
  resolvePlanExecutor,
} from "./protocol-binding-registry.mjs";


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
  useTinyLiveCap = true,
  auditRecords = [],
  now = new Date().toISOString(),
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
    useTinyLiveCap ? (finite(strategyCaps.caps.tinyLivePerTxUsd) ?? strategyCaps.caps.perTxUsd) : strategyCaps.caps.perTxUsd,
    perChainCapUsd(strategyCaps, queueItem.chain),
    finite(maxUsd) ?? Number.POSITIVE_INFINITY,
    finite(matchedToken?.estimatedUsd) ?? Number.POSITIVE_INFINITY,
  );

  const blockers = [];
  if (!isSupportedBindingKind(bindingKind(queueItem))) blockers.push("unsupported_binding_kind");
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
  if (strategyCaps && validation.ok && Number.isFinite(hardCapUsd) && hardCapUsd > 0) {
    const capCheck = evaluateCapCheck({
      intent: {
        strategyId,
        chain: queueItem.chain,
        intentType: resolveIntentType(bindingKind(queueItem)) || "erc4626_deposit",
        amountUsd: hardCapUsd,
        mode: "live",
        executionReason: "strategy_execution",
        metadata: {
          capCheckAmountUsd: hardCapUsd,
        },
      },
      strategyCaps,
      auditRecords,
      now,
    });
    blockers.push(...capCheck.blockers);
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
      const autoEntry = evaluateMerklAutoEntry(refreshedItem, {
        bindingSupported: isSupportedBindingKind(bindingKind(refreshedItem)),
      });
      if (!autoEntry.autoExecute) {
        return {
          queueItem: { ...refreshedItem, autoEntry },
          sizing: {
            status: "blocked",
            blockers: autoEntry.blockers,
            strategyId: refreshedItem.mappedStrategyId,
            capUsd: null,
            amount: null,
            amountUsd: null,
            decimals: decimalsForQueueItem(refreshedItem),
          },
        };
      }
      return {
        queueItem: { ...refreshedItem, autoEntry },
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

function compactRepresentativeCoverage(queue = {}) {
  return queue.representativeCoverage?.summary || queue.summary?.representativeCoverage || null;
}

function scaledUsdEstimate({ priorUnits, priorUsd, liveUnits }) {
  const priorAmount = BigInt(priorUnits || 0);
  const liveAmount = BigInt(liveUnits || 0);
  const priorEstimate = Number(priorUsd);
  if (liveAmount <= 0n || priorAmount <= 0n || !Number.isFinite(priorEstimate) || priorEstimate <= 0) return 0;
  return Number((liveAmount * decimalUsdToMicros(priorEstimate)) / priorAmount) / 1_000_000;
}

export async function buildLiveMerklInventorySnapshot({
  queueItem,
  senderAddress,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
} = {}) {
  if (!queueItem) throw new Error("queueItem is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  const tokenBalance = await readErc20BalanceImpl(queueItem.chain, binding.assetAddress, senderAddress);
  const nativeBalance = await readNativeBalanceImpl(queueItem.chain, senderAddress);
  const priorToken = queueItem.executionReadiness?.matchedToken || null;
  const priorNative = queueItem.executionReadiness?.matchedNative || null;
  return {
    address: senderAddress,
    observedAt: new Date().toISOString(),
    native: [
      {
        chain: queueItem.chain,
        asset: priorNative?.asset || tokenAsset(queueItem.chain, ZERO_TOKEN).ticker,
        token: ZERO_TOKEN,
        actual: nativeBalance.balanceWei.toString(),
        actualDecimal: priorNative?.actualDecimal ?? null,
        estimatedUsd: scaledUsdEstimate({
          priorUnits: priorNative?.actual,
          priorUsd: priorNative?.estimatedUsd,
          liveUnits: nativeBalance.balanceWei.toString(),
        }),
        rpcUrl: nativeBalance.rpcUrl || null,
      },
    ],
    tokens: [
      {
        chain: queueItem.chain,
        token: binding.assetAddress,
        ticker: priorToken?.ticker || tokenAsset(queueItem.chain, binding.assetAddress).ticker,
        actual: tokenBalance.balance.toString(),
        actualDecimal: priorToken?.actualDecimal ?? null,
        estimatedUsd: scaledUsdEstimate({
          priorUnits: priorToken?.actual,
          priorUsd: priorToken?.estimatedUsd,
          liveUnits: tokenBalance.balance.toString(),
        }),
        rpcUrl: tokenBalance.rpcUrl || null,
      },
    ],
  };
}

export async function refreshMerklAutopilotSelectionForExecute({
  selected,
  senderAddress,
  canaryExecutions = [],
  now = new Date().toISOString(),
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
  sizingOptions = {},
} = {}) {
  if (!selected?.queueItem) throw new Error("selected queue item is required");
  const inventorySnapshot = await buildLiveMerklInventorySnapshot({
    queueItem: selected.queueItem,
    senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const queueItem = applyMerklCanaryExecutionReadiness(selected.queueItem, {
    inventorySnapshot,
    canaryExecutions,
    now,
  });
  const sizing = sizeMerklCanaryAmount(queueItem, {
    ...sizingOptions,
    now,
  });
  return {
    queueItem,
    sizing,
    inventorySnapshot,
  };
}

function merklExecutionErrorReport({
  error,
  execute,
  preflight,
  queue,
  queueItem,
  sizing,
  readyCount,
  representativeCoverage,
} = {}) {
  const message = error?.message || String(error);
  let blockedReason = null;
  if (/Insufficient asset balance:/iu.test(message)) blockedReason = "insufficient_live_asset_balance";
  if (/All RPC endpoints failed for chain:/iu.test(message)) blockedReason = "live_inventory_refresh_failed";
  if (!blockedReason) throw error;
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: "blocked",
    blockedReason,
    error: {
      name: error?.name || "Error",
      message,
    },
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      liveBaseline: preflight.liveBaseline,
      killSwitchPath: preflight.killSwitchPath,
    },
    summary: {
      queueCount: queue.queue?.length || 0,
      readyCount,
      representativeCoverage,
      selectedOpportunityId: queueItem?.opportunityId || null,
      selectedChain: queueItem?.chain || null,
      selectedProtocolId: queueItem?.protocolId || null,
      selectedBindingKind: bindingKind(queueItem),
      selectedAmount: sizing?.amount || null,
      selectedAmountUsd: sizing?.amountUsd ?? null,
    },
    queueItem,
    sizing,
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
  const preflight = await preflightLiveCanarySweep({
    socketPath,
    timeoutMs,
    requireLiveBaseline: false,
  });
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
  const auditRecords = await readJsonl("logs", "signer-audit").catch(() => []);
  const inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, preflight.senderAddress);
  const selection = selectMerklCanaryAutopilotCandidate(queue, {
    maxUsd,
    minEthereumNotionalUsd,
    allowInefficientEthereum,
    inventorySnapshot,
    canaryExecutions,
    auditRecords,
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
        representativeCoverage: compactRepresentativeCoverage(queue),
      },
      candidates: selection.candidates.map(compactCandidate).slice(0, 20),
    };
    if (write) await writeAutopilotReport(report);
    return report;
  }

  let { queueItem, sizing } = selection.selected;
  const representativeCoverage = compactRepresentativeCoverage(queue);
  if (execute) {
    try {
      const refreshed = await refreshMerklAutopilotSelectionForExecute({
        selected: selection.selected,
        senderAddress: preflight.senderAddress,
        canaryExecutions,
        now: new Date().toISOString(),
        sizingOptions: {
          maxUsd,
          minEthereumNotionalUsd,
          allowInefficientEthereum,
          auditRecords,
        },
      });
      queueItem = refreshed.queueItem;
      sizing = refreshed.sizing;
    } catch (error) {
      const report = merklExecutionErrorReport({
        error,
        execute,
        preflight,
        queue,
        queueItem,
        sizing,
        readyCount: selection.readyCount,
        representativeCoverage,
      });
      if (write) await writeAutopilotReport(report);
      return report;
    }
    if (sizing.status !== "ready") {
      const report = {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        mode: "execute",
        status: "blocked",
        blockedReason: sizing.blockers?.[0] || "no_autopilot_candidate_ready",
        preflight: {
          status: preflight.status,
          senderAddress: preflight.senderAddress,
          liveBaseline: preflight.liveBaseline,
          killSwitchPath: preflight.killSwitchPath,
        },
        summary: {
          queueCount: queue.queue?.length || 0,
          readyCount: selection.readyCount,
          representativeCoverage,
          selectedOpportunityId: queueItem.opportunityId,
          selectedChain: queueItem.chain,
          selectedProtocolId: queueItem.protocolId,
          selectedBindingKind: bindingKind(queueItem),
          selectedAmount: null,
          selectedAmountUsd: null,
        },
        queueItem,
        sizing,
      };
      if (write) await writeAutopilotReport(report);
      return report;
    }
  }
  const buildPlan = resolvePlanBuilder(bindingKind(queueItem));
  const executePlan = resolvePlanExecutor(bindingKind(queueItem));
  if (!buildPlan || !executePlan) {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      mode: execute ? "execute" : "preview",
        status: "blocked",
        blockedReason: "unsupported_binding_kind",
        summary: {
          queueCount: queue.queue?.length || 0,
          readyCount: 1,
          representativeCoverage,
        },
      };
      if (write) await writeAutopilotReport(report);
      return report;
    }
  let plan;
  let execution = null;
  try {
    plan = await buildPlan({
      queueItem,
      senderAddress: preflight.senderAddress,
      amount: sizing.amount,
    });
    execution = execute
      ? await executePlan({
          plan,
          socketPath,
          timeoutMs,
        })
      : null;
  } catch (error) {
    const report = merklExecutionErrorReport({
      error,
      execute,
      preflight,
      queue,
      queueItem,
      sizing,
      readyCount: selection.readyCount,
      representativeCoverage,
    });
    if (write) await writeAutopilotReport(report);
    return report;
  }
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
      representativeCoverage,
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

export { DEFAULT_MIN_ETHEREUM_NOTIONAL_USD };
