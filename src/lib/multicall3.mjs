import { Interface } from "ethers";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const MULTICALL3_ABI = Object.freeze([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

const MULTICALL3 = new Interface(MULTICALL3_ABI);

function assertAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/iu.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function assertHexData(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeCalls(calls, allowFailure) {
  return calls.map((call, index) => ({
    index,
    target: assertAddress(call.target, "multicall3_call_target"),
    allowFailure: call.allowFailure ?? allowFailure,
    callData: assertHexData(call.callData || call.data, "multicall3_call_data"),
  }));
}

export async function multicall3Read({
  provider,
  calls = [],
  batchSize = 100,
  allowFailure = true,
  contractAddress = MULTICALL3_ADDRESS,
  blockTag = "latest",
} = {}) {
  if (!provider || typeof provider.call !== "function") throw new Error("multicall3_provider_required");
  assertAddress(contractAddress, "multicall3_contract_address");
  const normalized = normalizeCalls(calls, allowFailure);
  if (normalized.length === 0) {
    return {
      schemaVersion: 1,
      address: contractAddress,
      batchCount: 0,
      results: [],
    };
  }

  const batches = chunk(normalized, Math.max(1, Number(batchSize) || 1));
  const results = [];
  for (const batch of batches) {
    const data = MULTICALL3.encodeFunctionData("aggregate3", [
      batch.map((call) => ({
        target: call.target,
        allowFailure: call.allowFailure,
        callData: call.callData,
      })),
    ]);
    let raw;
    try {
      raw = await provider.call({ to: contractAddress, data }, blockTag);
    } catch (error) {
      throw new Error(`multicall3_provider_call_failed: ${error.message}`);
    }
    const decoded = MULTICALL3.decodeFunctionResult("aggregate3", raw);
    decoded[0].forEach((row, offset) => {
      const original = batch[offset];
      results.push({
        index: original.index,
        target: original.target,
        success: Boolean(row.success),
        returnData: row.returnData || "0x",
      });
    });
  }

  results.sort((left, right) => left.index - right.index);
  return {
    schemaVersion: 1,
    address: contractAddress,
    batchCount: batches.length,
    results,
  };
}
