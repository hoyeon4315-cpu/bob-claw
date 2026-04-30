import { validateOpportunityObservation } from "./schema/index.mjs";
import { appendRadarJsonl, readRadarJsonl } from "./jsonl.mjs";

export { readRadarJsonl };

export function buildObservationRecord(input = {}) {
  const result = validateOpportunityObservation(input);
  if (!result.ok) {
    return {
      ok: false,
      blockers: result.blockers,
      record: null,
    };
  }
  return {
    ok: true,
    blockers: [],
    record: result.value,
  };
}

export async function ingestOpportunityObservation({
  dataDir,
  observation,
} = {}) {
  const built = buildObservationRecord(observation);
  if (!built.ok) {
    return {
      wrote: false,
      blockers: built.blockers,
      record: null,
    };
  }
  await appendRadarJsonl(dataDir, "opportunity-observations", built.record);
  return {
    wrote: true,
    blockers: [],
    record: built.record,
  };
}
