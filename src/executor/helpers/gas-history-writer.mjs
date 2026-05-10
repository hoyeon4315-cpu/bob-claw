import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export function writeGasSample({ chain, gasPriceGwei, now, dataDir = "data" }) {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const filePath = join(dataDir, `gas-history-${chain}.jsonl`);
  const line = JSON.stringify({ observedAt: now, gasPriceGwei }) + "\n";
  appendFileSync(filePath, line, "utf8");
}
