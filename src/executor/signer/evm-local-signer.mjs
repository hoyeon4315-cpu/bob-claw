import { readFile } from "node:fs/promises";
import { JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { getChainRpcUrls } from "../../config/env.mjs";
import { getEvmChainConfig, listEvmChains } from "../../config/chains.mjs";
import { createSignedTransactionEnvelope, SignerInterface } from "./signer-interface.mjs";

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "bigint" ? value : BigInt(value);
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
      this.nextNonce = explicitNonce + 1;
      return explicitNonce;
    }
    const pendingNonce = await this.provider.getTransactionCount(this.address, "pending");
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

function isLikelyAlreadyBroadcast(error) {
  return /already known|already imported|known transaction|nonce too low/iu.test(errorMessage(error));
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

  async getAddress(chain = "bob") {
    const wallet = await this.wallet(chain);
    return wallet.address;
  }

  async buildTransactionRequest(intent, { reserveNonce = true } = {}) {
    const chainConfig = getEvmChainConfig(intent.chain);
    const explicitNonce = Number.isInteger(intent.tx?.nonce) ? intent.tx.nonce : null;
    const useLegacy = chainConfig.legacyTxType === true;
    const txType = intent.tx?.type ?? (useLegacy ? 0 : 2);

    return this.withRpcFallback(intent.chain, "buildTransactionRequest", async (provider, { index }) => {
      const wallet = await this.walletForProviderIndex(intent.chain, index);
      const feeData = await provider.getFeeData();
      const nonce = reserveNonce
        ? await (await this.nonceManagerForProviderIndex(intent.chain, index)).reserve(explicitNonce)
        : explicitNonce ?? await provider.getTransactionCount(wallet.address, "pending");

      return {
        chainId: chainConfig.chainId,
        to: intent.tx?.to,
        data: intent.tx?.data || "0x",
        value: toBigIntOrNull(intent.tx?.value) ?? 0n,
        gasLimit: toBigIntOrNull(intent.tx?.gasLimit) ?? BigInt(chainConfig.fallbackGasUnits),
        nonce,
        type: txType,
        ...(useLegacy
          ? { gasPrice: toBigIntOrNull(intent.tx?.gasPrice) ?? feeData.gasPrice ?? undefined }
          : {
              maxFeePerGas: toBigIntOrNull(intent.tx?.maxFeePerGas) ?? feeData.maxFeePerGas ?? undefined,
              maxPriorityFeePerGas: toBigIntOrNull(intent.tx?.maxPriorityFeePerGas) ?? feeData.maxPriorityFeePerGas ?? undefined,
            }),
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
      },
    });
  }

  async broadcastSignedIntent(signedEnvelope) {
    return this.withRpcFallback(signedEnvelope.chain, "broadcastSignedIntent", async (provider) => {
      try {
        const response = await provider.broadcastTransaction(signedEnvelope.signedTx);
        return {
          txHash: response.hash,
          nonce: response.nonce,
          from: response.from,
          to: response.to,
        };
      } catch (error) {
        if (isLikelyAlreadyBroadcast(error)) {
          return {
            txHash: signedEnvelope.txHash,
            nonce: signedEnvelope.metadata?.nonce ?? null,
            from: signedEnvelope.metadata?.from ?? null,
            to: signedEnvelope.metadata?.to ?? null,
          };
        }
        throw error;
      }
    });
  }

  async waitForTransaction(chain, txHash, { confirmations = 1, timeoutMs = 120_000 } = {}) {
    return this.withRpcFallback(chain, "waitForTransaction", async (provider) => (
      provider.waitForTransaction(txHash, confirmations, timeoutMs)
    ));
  }
}

export function createEvmLocalKeySigner(options = {}) {
  return new EvmLocalKeySigner(options);
}
