import { readFile } from "node:fs/promises";
import { getAddress, Interface, JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { getChainRpcUrls } from "../../config/env.mjs";
import { getEvmChainConfig, listEvmChains } from "../../config/chains.mjs";
import { createSignedTransactionEnvelope, SignerInterface } from "./signer-interface.mjs";

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "bigint" ? value : BigInt(value);
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "bigint" ? value.toString() : String(value);
}

function applyBps(value, bps) {
  if (!Number.isFinite(bps) || bps <= 10_000) return value;
  return (value * BigInt(Math.floor(bps))) / 10_000n;
}

function maxBigInt(...values) {
  return values
    .filter((value) => value !== null && value !== undefined)
    .reduce((left, right) => (left > right ? left : right), 0n);
}

function undefinedIfZero(value) {
  return value === 0n ? undefined : value;
}

function transactionNativeDebit(request) {
  const gasLimit = toBigIntOrNull(request?.gasLimit) ?? 0n;
  const gasPrice =
    toBigIntOrNull(request?.gasPrice) ??
    toBigIntOrNull(request?.maxFeePerGas) ??
    0n;
  return (toBigIntOrNull(request?.value) ?? 0n) + gasLimit * gasPrice;
}

const MAX_REASONABLE_EVM_NONCE = 10_000_000;
const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

function assertReasonableNonce(nonce, label = "nonce") {
  if (!Number.isInteger(nonce) || nonce < 0 || nonce > MAX_REASONABLE_EVM_NONCE) {
    throw new Error(`${label} outside reasonable EVM account range: ${nonce}`);
  }
  return nonce;
}

function bufferedEip1559Fees({ feeData, chainConfig, explicitMaxFeePerGas = null, explicitMaxPriorityFeePerGas = null }) {
  const feePriority = toBigIntOrNull(feeData?.maxPriorityFeePerGas);
  const feeMax = toBigIntOrNull(feeData?.maxFeePerGas);
  const fallbackGasPrice = toBigIntOrNull(feeData?.gasPrice);
  const minPriority = toBigIntOrNull(chainConfig.minPriorityFeePerGasWei);

  const maxPriorityFeePerGas =
    explicitMaxPriorityFeePerGas ??
    undefinedIfZero(maxBigInt(feePriority, minPriority));
  const baseComponent =
    feeMax !== null && feePriority !== null && feeMax > feePriority
      ? feeMax - feePriority
      : 0n;
  const impliedMax =
    maxPriorityFeePerGas !== undefined
      ? baseComponent + maxPriorityFeePerGas
      : undefined;
  const maxFeePerGas =
    explicitMaxFeePerGas ??
    undefinedIfZero(
      applyBps(
        maxBigInt(feeMax, fallbackGasPrice, impliedMax, maxPriorityFeePerGas),
        chainConfig.maxFeePerGasBufferBps,
      ),
    );

  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

function bufferedLegacyGasPrice({ feeData, chainConfig, explicitGasPrice = null }) {
  const gasPrice = explicitGasPrice ?? toBigIntOrNull(feeData?.gasPrice);
  if (gasPrice === null || gasPrice === undefined) return undefined;
  return applyBps(gasPrice, chainConfig.gasPriceBufferBps);
}

async function readSigningKey(path) {
  if (!path) {
    throw new Error("BURNER_EVM_KEY_PATH (or BURNER_PRIVATE_KEY_PATH) is required");
  }
  const raw = (await readFile(path, "utf8")).trim();
  if (!raw) {
    throw new Error(`Empty EVM key file: ${path}`);
  }
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

class SequentialNonceManager {
  constructor(provider, address) {
    this.provider = provider;
    this.address = address;
    this.nextNonce = null;
  }

  async reserve(explicitNonce = null) {
    if (Number.isInteger(explicitNonce)) {
      const nonce = assertReasonableNonce(explicitNonce, "explicit nonce");
      this.nextNonce = nonce + 1;
      return nonce;
    }
    const pendingNonce = assertReasonableNonce(
      await this.provider.getTransactionCount(this.address, "pending"),
      "pending nonce",
    );
    if (!Number.isInteger(this.nextNonce) || pendingNonce > this.nextNonce) {
      this.nextNonce = pendingNonce;
    }
    const nonce = this.nextNonce;
    this.nextNonce += 1;
    return nonce;
  }

  reset() {
    this.nextNonce = null;
  }
}

function resolveRpcUrls(chain) {
  const config = getEvmChainConfig(chain);
  if (!config) throw new Error(`Unsupported EVM chain: ${chain}`);
  return getChainRpcUrls(chain, config.rpcUrls || [config.rpcUrl].filter(Boolean));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeAddressOrNull(value) {
  if (!value) return null;
  try {
    return getAddress(String(value));
  } catch {
    return null;
  }
}

function assertEvmAddress(value, label) {
  const normalized = normalizeAddressOrNull(value);
  if (!normalized) throw new Error(`${label}_invalid`);
  return normalized;
}

function isHexData(value) {
  return typeof value === "string" && /^0x(?:[a-fA-F0-9]{2})*$/u.test(value);
}

function hasCallData(value) {
  return isHexData(value) && value.length > 2;
}

function expectedTargetCandidates(intent = {}) {
  return [
    intent.metadata?.expectedTxTo,
    intent.quote?.txTo,
    intent.quote?.tx?.to,
  ].filter(Boolean);
}

function assertMatchingTargets(intent, txTo) {
  const candidates = expectedTargetCandidates(intent).map((value) => assertEvmAddress(value, "evm_expected_tx_to"));
  if (candidates.length === 0) {
    if (hasCallData(intent.tx?.data)) {
      throw new Error("evm_tx_expected_target_missing");
    }
    return;
  }
  const [first] = candidates;
  if (!candidates.every((candidate) => candidate === first)) {
    throw new Error("evm_tx_expected_target_conflict");
  }
  if (txTo !== first) {
    throw new Error("evm_tx_target_mismatch");
  }
}

function assertApprovalCalldata(intent, txTo) {
  const approval = intent.approval || {};
  const token = assertEvmAddress(approval.token, "approval_token");
  const spender = assertEvmAddress(approval.spender, "approval_spender");
  if (txTo !== token) throw new Error("approval_target_mismatch");
  let decoded = null;
  try {
    decoded = ERC20_INTERFACE.decodeFunctionData("approve", intent.tx.data);
  } catch {
    throw new Error("approval_calldata_mismatch");
  }
  const decodedSpender = assertEvmAddress(decoded[0], "approval_decoded_spender");
  const decodedAmount = toBigIntOrNull(decoded[1]);
  const expectedAmount = toBigIntOrNull(approval.amount);
  if (decodedSpender !== spender || decodedAmount === null || expectedAmount === null || decodedAmount !== expectedAmount) {
    throw new Error("approval_calldata_mismatch");
  }
  const quoteTarget = normalizeAddressOrNull(intent.quote?.txTo);
  if (quoteTarget && quoteTarget !== spender) {
    throw new Error("approval_quote_spender_mismatch");
  }
}

export function validateEvmTransactionSemantics(intent = {}) {
  if (!intent.tx || typeof intent.tx !== "object") throw new Error("evm_tx_missing");
  const txTo = assertEvmAddress(intent.tx.to, "evm_tx_to");
  if (!isHexData(intent.tx.data)) throw new Error("evm_tx_data_invalid");
  if (intent.approval || intent.intentType === "approve_exact") {
    assertApprovalCalldata(intent, txTo);
    return true;
  }
  assertMatchingTargets(intent, txTo);
  return true;
}

function isLikelyAlreadyBroadcast(error) {
  return /already known|already imported|known transaction|nonce too low|replacement transaction underpriced/iu.test(errorMessage(error));
}

function isNonRetryableLocalError(error) {
  return /insufficient_native_balance_for_gas/iu.test(errorMessage(error));
}

export class EvmLocalKeySigner extends SignerInterface {
  constructor({
    env = process.env,
    providerFactory = (url, chainId) => new JsonRpcProvider(url, chainId, { staticNetwork: true }),
    keyReader = readSigningKey,
  } = {}) {
    super();
    this.env = env;
    this.providerFactory = providerFactory;
    this.keyReader = keyReader;
    this.privateKeyPromise = null;
    this.providers = new Map();
    this.activeProviderIndexes = new Map();
    this.wallets = new Map();
    this.nonceManagers = new Map();
  }

  async privateKey() {
    if (!this.privateKeyPromise) {
      this.privateKeyPromise = this.keyReader(this.env.BURNER_EVM_KEY_PATH || this.env.BURNER_PRIVATE_KEY_PATH || null);
    }
    return this.privateKeyPromise;
  }

  providerEntries(chain) {
    if (!listEvmChains().includes(chain)) {
      throw new Error(`Unsupported EVM chain: ${chain}`);
    }
    if (!this.providers.has(chain)) {
      const config = getEvmChainConfig(chain);
      const entries = resolveRpcUrls(chain).map((url) => ({
        url,
        provider: this.providerFactory(url, config.chainId),
      }));
      this.providers.set(chain, entries);
    }
    return this.providers.get(chain);
  }

  providerOrder(chain) {
    const entries = this.providerEntries(chain);
    const activeIndex = this.activeProviderIndexes.get(chain) ?? 0;
    return [
      activeIndex,
      ...entries.map((_, index) => index).filter((index) => index !== activeIndex),
    ].filter((index) => entries[index]);
  }

  async withRpcFallback(chain, operationName, operation) {
    const entries = this.providerEntries(chain);
    let lastError = null;
    for (const index of this.providerOrder(chain)) {
      const entry = entries[index];
      try {
        const result = await operation(entry.provider, { index, url: entry.url });
        this.activeProviderIndexes.set(chain, index);
        return result;
      } catch (error) {
        if (isNonRetryableLocalError(error)) throw error;
        lastError = error;
      }
    }
    throw new Error(`${operationName} failed for ${chain} across ${entries.length} RPC endpoint(s): ${errorMessage(lastError)}`);
  }

  async provider(chain) {
    const entries = this.providerEntries(chain);
    const activeIndex = this.activeProviderIndexes.get(chain) ?? 0;
    return entries[activeIndex]?.provider || entries[0].provider;
  }

  async walletForProviderIndex(chain, index) {
    const key = `${chain}:${index}`;
    if (!this.wallets.has(key)) {
      const entries = this.providerEntries(chain);
      const provider = entries[index]?.provider || entries[0].provider;
      const wallet = new Wallet(await this.privateKey(), provider);
      this.wallets.set(key, wallet);
    }
    return this.wallets.get(key);
  }

  async wallet(chain) {
    const activeIndex = this.activeProviderIndexes.get(chain) ?? 0;
    return this.walletForProviderIndex(chain, activeIndex);
  }

  async nonceManagerForProviderIndex(chain, index) {
    const key = `${chain}:${index}`;
    if (!this.nonceManagers.has(key)) {
      const entries = this.providerEntries(chain);
      const provider = entries[index]?.provider || entries[0].provider;
      const wallet = await this.walletForProviderIndex(chain, index);
      this.nonceManagers.set(key, new SequentialNonceManager(provider, wallet.address));
    }
    return this.nonceManagers.get(key);
  }

  async nonceManager(chain) {
    const activeIndex = this.activeProviderIndexes.get(chain) ?? 0;
    return this.nonceManagerForProviderIndex(chain, activeIndex);
  }

  resetNonceManagers(chain = null) {
    const prefix = chain ? `${chain}:` : null;
    for (const [key, manager] of this.nonceManagers.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        manager.reset();
      }
    }
  }

  describeNonceManagers() {
    try {
      return {
        ok: true,
        chains: listEvmChains().map((chain) => {
          const activeProviderIndex = this.activeProviderIndexes.get(chain) ?? 0;
          const entries = this.providerEntries(chain);
          const manager = this.nonceManagers.get(`${chain}:${activeProviderIndex}`) || null;
          return {
            chain,
            activeProviderIndex,
            providerCount: entries.length,
            cachedNextNonce: Number.isInteger(manager?.nextNonce) ? manager.nextNonce : null,
          };
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: error.name,
          message: error.message,
        },
        chains: [],
      };
    }
  }

  async getAddress(chain = "bob") {
    const wallet = await this.wallet(chain);
    return wallet.address;
  }

  async buildTransactionRequest(intent, { reserveNonce = true } = {}) {
    validateEvmTransactionSemantics(intent);
    const chainConfig = getEvmChainConfig(intent.chain);
    const explicitNonce = Number.isInteger(intent.tx?.nonce)
      ? assertReasonableNonce(intent.tx.nonce, "intent tx nonce")
      : null;
    const useLegacy = chainConfig.legacyTxType === true;
    const txType = intent.tx?.type ?? (useLegacy ? 0 : 2);

    return this.withRpcFallback(intent.chain, "buildTransactionRequest", async (provider, { index }) => {
      const wallet = await this.walletForProviderIndex(intent.chain, index);
      const feeData = await provider.getFeeData();
      const explicitGasPrice = toBigIntOrNull(intent.tx?.gasPrice);
      const explicitMaxFeePerGas = toBigIntOrNull(intent.tx?.maxFeePerGas);
      const explicitMaxPriorityFeePerGas = toBigIntOrNull(intent.tx?.maxPriorityFeePerGas);
      const eip1559Fees = useLegacy
        ? null
        : bufferedEip1559Fees({
            feeData,
            chainConfig,
            explicitMaxFeePerGas,
            explicitMaxPriorityFeePerGas,
          });
      const baseRequest = {
        value: toBigIntOrNull(intent.tx?.value) ?? 0n,
        gasLimit: toBigIntOrNull(intent.tx?.gasLimit) ?? BigInt(chainConfig.fallbackGasUnits),
        ...(useLegacy
          ? { gasPrice: bufferedLegacyGasPrice({ feeData, chainConfig, explicitGasPrice }) }
          : eip1559Fees),
      };
      const requiredNative = transactionNativeDebit(baseRequest);
      if (requiredNative > 0n && typeof provider.getBalance === "function") {
        const nativeBalance = toBigIntOrNull(await provider.getBalance(wallet.address, "latest")) ?? 0n;
        if (nativeBalance < requiredNative) {
          throw new Error(
            `insufficient_native_balance_for_gas: chain=${intent.chain} requiredWei=${requiredNative.toString()} balanceWei=${nativeBalance.toString()}`,
          );
        }
      }
      const nonce = reserveNonce
        ? await (await this.nonceManagerForProviderIndex(intent.chain, index)).reserve(explicitNonce)
        : explicitNonce ?? assertReasonableNonce(
          await provider.getTransactionCount(wallet.address, "pending"),
          "pending nonce",
        );

      return {
        chainId: chainConfig.chainId,
        to: intent.tx?.to,
        data: intent.tx?.data || "0x",
        value: baseRequest.value,
        gasLimit: baseRequest.gasLimit,
        nonce,
        type: txType,
        ...(useLegacy ? { gasPrice: baseRequest.gasPrice } : eip1559Fees),
      };
    });
  }

  async signIntent(intent, { reserveNonce = true } = {}) {
    const request = await this.buildTransactionRequest(intent, { reserveNonce });
    const wallet = await this.wallet(intent.chain);
    const signedTx = await wallet.signTransaction(request);
    return createSignedTransactionEnvelope({
      intent,
      signedTx,
      txHash: keccak256(signedTx),
      chain: intent.chain,
      signerFamily: "evm",
      metadata: {
        nonce: request.nonce,
        from: wallet.address,
        to: request.to,
        value: toStringOrNull(request.value),
        gasLimit: toStringOrNull(request.gasLimit),
        gasPrice: toStringOrNull(request.gasPrice),
        maxFeePerGas: toStringOrNull(request.maxFeePerGas),
        maxPriorityFeePerGas: toStringOrNull(request.maxPriorityFeePerGas),
      },
    });
  }

  async broadcastSignedIntent(signedEnvelope) {
    const accepted = [];
    let lastError = null;
    for (const index of this.providerOrder(signedEnvelope.chain)) {
      const entry = this.providerEntries(signedEnvelope.chain)[index];
      try {
        const response = await entry.provider.broadcastTransaction(signedEnvelope.signedTx);
        this.activeProviderIndexes.set(signedEnvelope.chain, index);
        accepted.push({
          txHash: response.hash,
          nonce: response.nonce,
          from: response.from,
          to: response.to,
        });
      } catch (error) {
        if (isLikelyAlreadyBroadcast(error)) {
          this.activeProviderIndexes.set(signedEnvelope.chain, index);
          accepted.push({
            txHash: signedEnvelope.txHash,
            nonce: signedEnvelope.metadata?.nonce ?? null,
            from: signedEnvelope.metadata?.from ?? null,
            to: signedEnvelope.metadata?.to ?? null,
          });
          continue;
        }
        lastError = error;
      }
    }
    if (accepted.length > 0) return accepted[0];
    this.resetNonceManagers(signedEnvelope.chain);
    throw new Error(`broadcastSignedIntent failed for ${signedEnvelope.chain}: ${errorMessage(lastError)}`);
  }

  async waitForTransaction(chain, txHash, { confirmations = 1, timeoutMs = 120_000 } = {}) {
    const entries = this.providerEntries(chain);
    const waits = this.providerOrder(chain).map(async (index) => {
      const entry = entries[index];
      const receipt = await entry.provider.waitForTransaction(txHash, confirmations, timeoutMs);
      if (!receipt) throw new Error("waitForTransaction returned null");
      this.activeProviderIndexes.set(chain, index);
      return receipt;
    });
    try {
      return await Promise.any(waits);
    } catch (error) {
      this.resetNonceManagers(chain);
      const messages = error?.errors?.length
        ? error.errors.map(errorMessage).join("; ")
        : errorMessage(error);
      throw new Error(`waitForTransaction failed for ${chain} across ${entries.length} RPC endpoint(s): ${messages}`);
    }
  }
}

export function createEvmLocalKeySigner(options = {}) {
  return new EvmLocalKeySigner(options);
}
