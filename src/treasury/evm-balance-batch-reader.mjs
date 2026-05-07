import { Interface } from "ethers";
import { multicall3Read } from "../lib/multicall3.mjs";

const ERC20 = new Interface(["function balanceOf(address owner) view returns (uint256)"]);

function assertAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/iu.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function normalizeTokenList(tokens = []) {
  return [...new Set(tokens.map((token) => assertAddress(token, "erc20_token")))];
}

function okRow({ token, balance, source }) {
  return {
    token,
    status: "ok",
    balanceRaw: BigInt(balance).toString(),
    source,
    error: null,
  };
}

function errorRow({ token, source, error }) {
  return {
    token,
    status: "error",
    balanceRaw: null,
    source,
    error: error.message || String(error),
  };
}

export async function readErc20BalancesBatch({
  owner,
  tokens = [],
  multicallAvailable = false,
  multicall3ReadImpl = multicall3Read,
  directBalanceOfImpl,
} = {}) {
  const normalizedOwner = assertAddress(owner, "erc20_owner");
  const normalizedTokens = normalizeTokenList(tokens);
  if (normalizedTokens.length === 0) return [];

  if (multicallAvailable) {
    const response = await multicall3ReadImpl({
      calls: normalizedTokens.map((token) => ({
        target: token,
        callData: ERC20.encodeFunctionData("balanceOf", [normalizedOwner]),
      })),
    });
    return normalizedTokens.map((token, index) => {
      const row = response.results.find((item) => item.index === index);
      if (!row?.success) {
        return errorRow({ token, source: "multicall3_balanceOf", error: new Error("multicall_balanceOf_failed") });
      }
      const decoded = ERC20.decodeFunctionResult("balanceOf", row.returnData);
      return okRow({ token, balance: decoded[0], source: "multicall3_balanceOf" });
    });
  }

  if (typeof directBalanceOfImpl !== "function") throw new Error("direct_balanceOf_required");
  const rows = [];
  for (const token of normalizedTokens) {
    try {
      rows.push(okRow({
        token,
        balance: await directBalanceOfImpl({ owner: normalizedOwner, token }),
        source: "direct_balanceOf",
      }));
    } catch (error) {
      rows.push(errorRow({ token, source: "direct_balanceOf", error }));
    }
  }
  return rows;
}
