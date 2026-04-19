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
    if (!Number.isInteger(this.nextNonce)) {
      this.nextNonce = await this.provider.getTransactionCount(this.address, "pending");
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
    this.wallets = new Map();
    this.nonceManagers = new Map();
  }

  async privateKey() {
    if (!this.privateKeyPromise) {
      this.privateKeyPromise = this.keyReader(this.env.BURNER_EVM_KEY_PATH || this.env.BURNER_PRIVATE_KEY_PATH || null);
    }
    return this.privateKeyPromise;
  }

  async provider(chain) {
    if (!listEvmChains().includes(chain)) {
      throw new Error(`Unsupported EVM chain: ${chain}`);
    }
    if (!this.providers.has(chain)) {
      const config = getEvmChainConfig(chain);
      const rpcUrl = resolveRpcUrls(chain)[0];
      this.providers.set(chain, this.providerFactory(rpcUrl, config.chainId));
    }
    return this.providers.get(chain);
  }

  async wallet(chain) {
    if (!this.wallets.has(chain)) {
      const provider = await this.provider(chain);
      const wallet = new Wallet(await this.privateKey(), provider);
      this.wallets.set(chain, wallet);
    }
    return this.wallets.get(chain);
  }

  async nonceManager(chain) {
    if (!this.nonceManagers.has(chain)) {
      const wallet = await this.wallet(chain);
      this.nonceManagers.set(chain, new SequentialNonceManager(wallet.provider, wallet.address));
    }
    return this.nonceManagers.get(chain);
  }

  async getAddress(chain = "bob") {
    const wallet = await this.wallet(chain);
    return wallet.address;
  }

  async buildTransactionRequest(intent, { reserveNonce = true } = {}) {
    const chainConfig = getEvmChainConfig(intent.chain);
    const wallet = await this.wallet(intent.chain);
    const provider = wallet.provider;
    const feeData = await provider.getFeeData();
    const explicitNonce = Number.isInteger(intent.tx?.nonce) ? intent.tx.nonce : null;
    const nonce = reserveNonce
      ? await (await this.nonceManager(intent.chain)).reserve(explicitNonce)
      : explicitNonce ?? await provider.getTransactionCount(wallet.address, "pending");

    return {
      chainId: chainConfig.chainId,
      to: intent.tx?.to,
      data: intent.tx?.data || "0x",
      value: toBigIntOrNull(intent.tx?.value) ?? 0n,
      gasLimit: toBigIntOrNull(intent.tx?.gasLimit) ?? BigInt(chainConfig.fallbackGasUnits),
      nonce,
      type: intent.tx?.type ?? 2,
      maxFeePerGas: toBigIntOrNull(intent.tx?.maxFeePerGas) ?? feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: toBigIntOrNull(intent.tx?.maxPriorityFeePerGas) ?? feeData.maxPriorityFeePerGas ?? undefined,
      gasPrice: toBigIntOrNull(intent.tx?.gasPrice) ?? feeData.gasPrice ?? undefined,
    };
  }

  async signIntent(intent, { reserveNonce = true } = {}) {
    const wallet = await this.wallet(intent.chain);
    const request = await this.buildTransactionRequest(intent, { reserveNonce });
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
    const provider = await this.provider(signedEnvelope.chain);
    const response = await provider.broadcastTransaction(signedEnvelope.signedTx);
    return {
      txHash: response.hash,
      nonce: response.nonce,
      from: response.from,
      to: response.to,
    };
  }

  async waitForTransaction(chain, txHash, { confirmations = 1, timeoutMs = 120_000 } = {}) {
    const provider = await this.provider(chain);
    return provider.waitForTransaction(txHash, confirmations, timeoutMs);
  }
}

export function createEvmLocalKeySigner(options = {}) {
  return new EvmLocalKeySigner(options);
}
