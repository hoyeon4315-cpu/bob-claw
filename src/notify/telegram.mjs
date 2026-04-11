export function formatGatewayUpdateAlert(result) {
  const lines = [
    "BOB Claw update alert",
    `observedAt: ${result.observedAt}`,
    `reasons: ${result.changeReasons.join(",") || "none"}`,
    `routeCount: ${result.snapshot.routeCount}`,
    `chains: ${result.snapshot.chains.join(",")}`,
    `addedRoutes: ${result.diff.addedRoutes.length}`,
    `removedRoutes: ${result.diff.removedRoutes.length}`,
    `probeOk: ${result.probes.filter((probe) => probe.ok).length}/${result.probes.length}`,
    `probeFailures: ${result.probeFailures.length}`,
  ];

  for (const failure of result.probeFailures.slice(0, 3)) {
    lines.push(`failure: ${failure.routeKey} ${failure.errorStatus || "no_status"} ${failure.errorCode || ""}`.trim());
  }

  lines.push("liveTrading: still blocked until audit gates pass");
  return lines.join("\n");
}

export async function sendTelegramMessage({ botToken, chatId, text, fetchImpl = fetch }) {
  if (!botToken || !chatId) {
    return { sent: false, skipped: true, reason: "telegram_not_configured" };
  }

  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const bodyText = await response.text();
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = { raw: bodyText.slice(0, 500) };
  }

  if (!response.ok) {
    throw new Error(`Telegram send failed with status ${response.status}: ${JSON.stringify(body)}`);
  }

  return { sent: true, skipped: false, status: response.status, body };
}
