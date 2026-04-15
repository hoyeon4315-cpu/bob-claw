export function formatGatewayUpdateAlert(result) {
  const lines = [
    "BOB Claw update alert",
    `observedAt: ${result.observedAt}`,
    `reasons: ${result.changeReasons.join(",") || "none"}`,
    `routeCount: ${result.snapshot.routeCount}`,
    `ethFamilyRoutes: ${result.ethFamily?.routeCount || 0}`,
    `chains: ${result.snapshot.chains.join(",")}`,
    `addedRoutes: ${result.diff.addedRoutes.length}`,
    `removedRoutes: ${result.diff.removedRoutes.length}`,
    `probeOk: ${result.probes.filter((probe) => probe.ok).length}/${result.probes.length}`,
    `probeFailures: ${result.probeFailures.length}`,
  ];

  if ((result.diff?.addedEthFamilyRoutes?.length || 0) > 0 || (result.diff?.removedEthFamilyRoutes?.length || 0) > 0) {
    const addedEthFamilyRoutes = result.diff?.addedEthFamilyRoutes?.length || 0;
    const removedEthFamilyRoutes = result.diff?.removedEthFamilyRoutes?.length || 0;
    lines.push(
      `ethFamilySurface: +${addedEthFamilyRoutes} / -${removedEthFamilyRoutes}`,
    );
  }

  for (const failure of result.probeFailures.slice(0, 3)) {
    lines.push(`failure: ${failure.routeKey} ${failure.errorStatus || "no_status"} ${failure.errorCode || ""}`.trim());
  }

  if ((result.diff?.addedEthFamilyRoutes?.length || 0) > 0) {
    lines.push("next: scan new ETH-family routes, then run analyze:ethereum-routes and audit:eth-family-overfit");
  }

  lines.push("liveTrading: still blocked until audit gates pass");
  return lines.join("\n");
}

function shortHash(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

export function formatPreliveForkExecutionAlert({ phase, plan = null, submission = null, receipt = null, audit = null }) {
  const lines = [
    "BOB Claw pre-live execution",
    `phase: ${phase || "unknown"}`,
  ];
  const route = plan?.routeLabel || submission?.routeLabel || receipt?.routeLabel || plan?.routeKey || submission?.routeKey || receipt?.routeKey;
  const amount = plan?.amount || submission?.amount || receipt?.amount;
  const environment = plan?.targetEnvironment || submission?.targetEnvironment || receipt?.targetEnvironment || "external_signed_fork";
  if (route) lines.push(`route: ${route}`);
  if (amount) lines.push(`amount: ${amount}`);
  lines.push(`environment: ${environment}`);
  if (submission) {
    lines.push(`submission: ${submission.submissionStatus || "unknown"}`);
    if (submission.reason) lines.push(`submissionReason: ${submission.reason}`);
    if (submission.txHash) lines.push(`txHash: ${shortHash(submission.txHash)}`);
  }
  if (receipt) {
    lines.push(`receipt: ${receipt.reconciliationStatus || "unknown"}`);
    lines.push(`failed: ${Boolean(receipt.flags?.failed)}`);
    if (Number.isFinite(receipt.realized?.actualKnownCostUsd)) {
      lines.push(`actualKnownCostUsd: ${receipt.realized.actualKnownCostUsd.toFixed(6)}`);
    }
    if (Number.isFinite(receipt.realized?.realizedNetPnlUsd)) {
      lines.push(`realizedNetPnlUsd: ${receipt.realized.realizedNetPnlUsd.toFixed(6)}`);
    }
  }
  if (audit) {
    lines.push(`records: ${audit.status} missing=${audit.missingRecordCount}`);
  }
  lines.push("liveTrading: still blocked until explicit canary approval");
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
