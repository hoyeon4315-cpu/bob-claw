import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function stripWrappingQuotes(value) {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    process.env[key] = value;
  }
}

loadDotEnvFile(resolve(process.cwd(), ".env"));

export function getEnv(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value;
}

export function getNumberEnv(name, fallback) {
  const raw = getEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }
  return parsed;
}

export function getBooleanEnv(name, fallback = false) {
  const raw = getEnv(name);
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean`);
}

export function getCsvEnv(name, fallback) {
  const raw = getEnv(name);
  const source = raw === undefined ? fallback : raw;
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getChainRpcUrls(chainName, fallback) {
  const envName = `BOB_CLAW_RPC_URLS_${chainName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return getCsvEnv(envName, fallback.join(","));
}

export const config = {
  gatewayApiBase: getEnv("BOB_GATEWAY_API_BASE", "https://gateway-api-mainnet.gobob.xyz"),
  merklApiBase: getEnv("BOB_CLAW_MERKL_API_BASE", "https://api.merkl.xyz"),
  verifyRecipient: getEnv("BOB_CLAW_VERIFY_RECIPIENT", "0x000000000000000000000000000000000000dEaD"),
  estimateFrom: getEnv("BOB_CLAW_ESTIMATE_FROM", null),
  verifyBtcRecipient: getEnv("BOB_CLAW_VERIFY_BTC_RECIPIENT", "1BitcoinEaterAddressDontSendf59kuE"),
  sampleSats: getCsvEnv("BOB_CLAW_SAMPLE_SATS", "10000,25000,50000,100000,150000"),
  slippageBps: String(getNumberEnv("BOB_CLAW_SLIPPAGE_BPS", 50)),
  requestDelayMs: getNumberEnv("BOB_CLAW_REQUEST_DELAY_MS", 1500),
  dataDir: getEnv("BOB_CLAW_DATA_DIR", "./data"),
  liveModeFlagPath: getEnv("BOB_CLAW_LIVE_MODE_FLAG", "./state/live-mode.enabled"),
  emergencyStopFlagPath: getEnv("BOB_CLAW_EMERGENCY_STOP_FLAG", "./state/emergency-stop"),
  approveEthereumL1Routes: getBooleanEnv("BOB_CLAW_APPROVE_ETHEREUM_L1", true),
  telegramBotToken: getEnv("TELEGRAM_BOT_TOKEN", ""),
  telegramChatId: getEnv("TELEGRAM_CHAT_ID", ""),
};
