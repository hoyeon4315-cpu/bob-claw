function latestByPlanId(records = []) {
  const latest = new Map();
  for (const record of records) {
    if (!record?.planId) continue;
    const current = latest.get(record.planId);
    if (!current || new Date(record.observedAt) > new Date(current.observedAt)) {
      latest.set(record.planId, record);
    }
  }
  return [...latest.values()];
}

function routeLabel(record) {
  return record?.routeLabel || record?.routeContext?.routeKey || record?.routeKey || null;
}

function transitionFromPlan(plan) {
  return {
    observedAt: plan.observedAt,
    planId: plan.planId,
    kind: "fork_plan",
    status: plan.status || "unknown",
    routeLabel: routeLabel(plan),
    amount: plan.amount || null,
    chain: plan.srcChain || null,
  };
}

function transitionFromSubmission(submission) {
  return {
    observedAt: submission.observedAt,
    planId: submission.planId,
    kind: submission.submissionStatus === "failed" ? "fork_submission_failed" : "fork_submitted",
    status: submission.submissionStatus || "unknown",
    routeLabel: routeLabel(submission),
    amount: submission.amount || null,
    chain: submission.chain || null,
    reason: submission.reason || null,
  };
}

function transitionFromReceipt(receipt) {
  return {
    observedAt: receipt.observedAt,
    planId: receipt.planId,
    kind:
      receipt.reconciliationStatus === "reconciled"
        ? "fork_confirmed"
        : receipt.reconciliationStatus === "failed"
          ? "fork_failed"
          : "fork_pending_output",
    status: receipt.reconciliationStatus || "unknown",
    routeLabel: routeLabel(receipt),
    amount: receipt.amount || null,
    chain: receipt.chain || null,
    failed: Boolean(receipt.flags?.failed),
  };
}

function relevantJournalEvents(executionEvents = []) {
  return executionEvents.filter((item) => item?.executionMethod === "external_signed_raw_tx" || item?.actor?.startsWith("prelive_fork_"));
}

export function buildPreliveExecutionAudit({
  forkExecutionPlans = [],
  forkExecutionSubmissions = [],
  forkExecutionReceipts = [],
  executionEvents = [],
} = {}) {
  const latestPlans = latestByPlanId(forkExecutionPlans);
  const latestSubmissions = latestByPlanId(forkExecutionSubmissions);
  const latestReceipts = latestByPlanId(forkExecutionReceipts);
  const plansById = new Map(latestPlans.map((item) => [item.planId, item]));
  const submittedById = new Map(
    latestSubmissions
      .filter((item) => item.submissionStatus === "submitted")
      .map((item) => [item.planId, item]),
  );
  const journal = relevantJournalEvents(executionEvents);

  let missingPlanForSubmissionCount = 0;
  let missingPlanForReceiptCount = 0;
  let missingSubmissionForReceiptCount = 0;
  let missingJournalSubmissionCount = 0;
  let missingJournalReconciliationCount = 0;

  for (const submission of latestSubmissions) {
    if (!plansById.has(submission.planId)) {
      missingPlanForSubmissionCount += 1;
    }
    if (submission.submissionStatus === "submitted") {
      const hasJournalSubmission = journal.some(
        (item) => item.jobId === submission.planId && item.status === "submitted" && (!submission.txHash || item.txHash === submission.txHash),
      );
      if (!hasJournalSubmission) {
        missingJournalSubmissionCount += 1;
      }
    }
  }

  for (const receipt of latestReceipts) {
    if (!plansById.has(receipt.planId)) {
      missingPlanForReceiptCount += 1;
    }
    if (!submittedById.has(receipt.planId)) {
      missingSubmissionForReceiptCount += 1;
    }
    const expectedJournalStatus =
      receipt.reconciliationStatus === "failed"
        ? "failed"
        : receipt.reconciliationStatus === "reconciled"
          ? "confirmed"
          : "pending_output";
    const hasJournalReconciliation = journal.some(
      (item) => item.jobId === receipt.planId && item.status === expectedJournalStatus && (!receipt.txHash || item.txHash === receipt.txHash),
    );
    if (!hasJournalReconciliation) {
      missingJournalReconciliationCount += 1;
    }
  }

  const orphanJournalEventCount = journal.filter((item) => !plansById.has(item.jobId)).length;
  const missingRecordCount =
    missingPlanForSubmissionCount +
    missingPlanForReceiptCount +
    missingSubmissionForReceiptCount +
    missingJournalSubmissionCount +
    missingJournalReconciliationCount +
    orphanJournalEventCount;
  const blockers = [
    ...(missingPlanForSubmissionCount > 0 ? ["submission_without_plan"] : []),
    ...(missingPlanForReceiptCount > 0 ? ["receipt_without_plan"] : []),
    ...(missingSubmissionForReceiptCount > 0 ? ["receipt_without_submission"] : []),
    ...(missingJournalSubmissionCount > 0 ? ["submission_missing_journal_event"] : []),
    ...(missingJournalReconciliationCount > 0 ? ["receipt_missing_journal_event"] : []),
    ...(orphanJournalEventCount > 0 ? ["orphan_journal_events"] : []),
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: blockers.length ? "missing_records" : "complete",
    blockers,
    missingRecordCount,
    planCount: latestPlans.length,
    submissionCount: latestSubmissions.length,
    receiptCount: latestReceipts.length,
    missingPlanForSubmissionCount,
    missingPlanForReceiptCount,
    missingSubmissionForReceiptCount,
    missingJournalSubmissionCount,
    missingJournalReconciliationCount,
    orphanJournalEventCount,
    recentTransitions: [...latestPlans.map(transitionFromPlan), ...latestSubmissions.map(transitionFromSubmission), ...latestReceipts.map(transitionFromReceipt)]
      .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))
      .slice(0, 8),
  };
}
