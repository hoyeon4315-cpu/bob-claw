import { buildDestinationInputWorkbench } from "./destination-input-workbench.mjs";
import { buildDestinationEvidencePolicy } from "./destination-evidence-policy.mjs";
import { buildDestinationEconomicsLedger } from "./destination-economics-ledger.mjs";
import { buildDestinationEstimatedEconomics } from "./destination-estimated-economics.mjs";
import { buildDestinationEconomicsQueue } from "./destination-economics-queue.mjs";
import { buildDestinationEconomicsPacket } from "./destination-economics-packet.mjs";
import { buildDestinationResearchQueue } from "./destination-research-queue.mjs";

export function buildDestinationEconomicsSnapshot({
  admissionChecklist = null,
  overrides = null,
  observations = null,
  blockers = null,
} = {}) {
  const workbench = buildDestinationInputWorkbench({ admissionChecklist, overrides });
  const evidencePolicy = buildDestinationEvidencePolicy({ workbench });
  const ledger = buildDestinationEconomicsLedger({ observations, workbench, blockers, evidencePolicy });
  const economics = buildDestinationEstimatedEconomics({ workbench, blockers });
  return {
    workbench,
    evidencePolicy,
    ledger,
    economics,
  };
}

export function buildDestinationEconomicsQueueSnapshot({
  admissionChecklist = null,
  overrides = null,
  observations = null,
  blockers = null,
} = {}) {
  const { workbench, evidencePolicy, ledger, economics } = buildDestinationEconomicsSnapshot({
    admissionChecklist,
    overrides,
    observations,
    blockers,
  });
  const researchQueue = buildDestinationResearchQueue({ workbench, evidencePolicy, economics });
  const economicsQueue = buildDestinationEconomicsQueue({ economics, researchQueue });
  return {
    workbench,
    evidencePolicy,
    ledger,
    economics,
    researchQueue,
    economicsQueue,
  };
}

export function buildDestinationEconomicsPacketSnapshot({
  admissionChecklist = null,
  overrides = null,
  freshnessAudit = null,
  observations = null,
  blockers = null,
} = {}) {
  const { workbench, evidencePolicy, ledger, economics, economicsQueue } = buildDestinationEconomicsQueueSnapshot({
    admissionChecklist,
    overrides,
    observations,
    blockers,
  });
  const economicsPacket = buildDestinationEconomicsPacket({ economicsQueue, workbench, freshnessAudit });
  return {
    workbench,
    evidencePolicy,
    ledger,
    economics,
    economicsQueue,
    economicsPacket,
  };
}
