import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../config/gateway-destinations.mjs";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

function byteLengthOfCode(code) {
  if (typeof code !== "string" || !code.startsWith("0x")) return null;
  return Math.max(0, Math.floor((code.length - 2) / 2));
}

export function classifyContractCode(code) {
  if (typeof code !== "string") return "rpc_error";
  if (!code || code === "0x") return "missing";
  if (!/^0x[0-9a-f]*$/iu.test(code)) return "rpc_error";
  return "available";
}

export async function observeMulticall3Destination({
  chain,
  address = MULTICALL3_ADDRESS,
  readCode,
  now = new Date().toISOString(),
} = {}) {
  if (!chain) throw new Error("multicall3_chain_required");
  if (typeof readCode !== "function") throw new Error("multicall3_read_code_required");
  try {
    const observation = await readCode({ chain, address });
    const code = typeof observation === "string" ? observation : observation?.code;
    const status = classifyContractCode(code);
    return {
      chain,
      address,
      status,
      observedAt: now,
      rpcUrl: typeof observation === "object" ? observation?.rpcUrl || null : null,
      codeByteLength: byteLengthOfCode(code),
      error: status === "rpc_error" ? "invalid_contract_code_response" : null,
    };
  } catch (error) {
    return {
      chain,
      address,
      status: "rpc_error",
      observedAt: now,
      rpcUrl: null,
      codeByteLength: null,
      error: error.message,
    };
  }
}

export function summarizeGatewayMulticall3Matrix(items = []) {
  const availableCount = items.filter((item) => item.status === "available").length;
  const missingCount = items.filter((item) => item.status === "missing").length;
  const rpcErrorCount = items.filter((item) => item.status === "rpc_error").length;
  return {
    chainCount: items.length,
    availableCount,
    missingCount,
    rpcErrorCount,
    blockers: items
      .filter((item) => item.status !== "available")
      .map((item) => `multicall3_unavailable_on_${item.chain}`),
  };
}

export async function buildGatewayMulticall3Matrix({
  chains = OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  address = MULTICALL3_ADDRESS,
  readCode,
  now = new Date().toISOString(),
} = {}) {
  const uniqueChains = [...new Set(chains)];
  const items = [];
  for (const chain of uniqueChains) {
    items.push(await observeMulticall3Destination({ chain, address, readCode, now }));
  }
  return {
    schemaVersion: 1,
    kind: "gateway_multicall3_matrix",
    observedAt: now,
    address,
    items,
    summary: summarizeGatewayMulticall3Matrix(items),
  };
}
