// Real-time position value tracker using Zerion API
const API_KEY = process.env.BOB_CLAW_ZERION_API_KEY || "";
const ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

async function fetchZerionPositions() {
  if (!API_KEY) {
    console.error("BOB_CLAW_ZERION_API_KEY not set");
    return null;
  }

  const url = `https://api.zerion.io/v1/wallets/${ADDRESS}/positions?currency=usd&filter[positions]=only_simple&sort=value`;

  try {
    const res = await fetch(url, {
      headers: {
        "Authorization": `Basic ${Buffer.from(API_KEY + ":").toString("base64")}`,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      console.error(`Zerion API error: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Zerion fetch error:", e.message);
    return null;
  }
}

async function main() {
  console.log("=== Real-time Position Tracker (Zerion API) ===\n");
  console.log(`Address: ${ADDRESS}\n`);

  const data = await fetchZerionPositions();
  if (!data) {
    console.log("Failed to fetch from Zerion. Falling back to manual estimate.");
    return;
  }

  const positions = data.data || [];
  console.log(`Found ${positions.length} positions\n`);

  let totalValue = 0;
  let positionValue = 0;
  let tokenValue = 0;

  console.log("Positions:");
  console.log("-".repeat(100));

  for (const pos of positions) {
    const attrs = pos.attributes || {};
    const value = attrs.value || 0;
    const name = attrs.fungible_info?.name || attrs.name || "Unknown";
    const symbol = attrs.fungible_info?.symbol || attrs.symbol || "?";
    const chain = attrs.chain || "?";
    const isPosition = attrs.flags?.includes("position") || attrs.position_type;

    totalValue += value;
    if (isPosition) positionValue += value;
    else tokenValue += value;

    const type = isPosition ? "[POSITION]" : "[TOKEN]";
    console.log(
      `${type.padEnd(12)} ${chain.padEnd(10)} | ${symbol.padEnd(8)} | ${name.slice(0, 20).padEnd(22)} | $${value.toFixed(2).padStart(10)}`
    );

    if (attrs.position_type) {
      console.log(`           └─ Position type: ${attrs.position_type}`);
    }
    if (attrs.apy) {
      console.log(`           └─ APY: ${attrs.apy}%`);
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log(`Position Value:  $${positionValue.toFixed(2)}`);
  console.log(`Token Value:     $${tokenValue.toFixed(2)}`);
  console.log(`TOTAL:           $${totalValue.toFixed(2)}`);
  console.log(`\nSource: Zerion API (real-time)`);
}

main().catch(console.error);
