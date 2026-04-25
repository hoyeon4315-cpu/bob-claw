import { readJsonl, latestBy } from "../../lib/jsonl-read.mjs";

export const REFILL_JOB_STORES = ["capital-manager-refill-jobs", "treasury-refill-jobs"];

export function refillJobTimestamp(job = {}) {
  return job.createdAt || job.observedAt || null;
}

export function mergeLatestRefillJobsById(jobRecordsByStore = []) {
  const merged = jobRecordsByStore.flatMap(({ storeName, jobs = [] }) =>
    jobs.map((job) => ({
      ...job,
      jobSourceStore: storeName,
    })),
  );
  return [...latestBy(merged, (item) => item.jobId, refillJobTimestamp).values()];
}

export async function readLatestRefillJobs(dataDir, { stores = REFILL_JOB_STORES } = {}) {
  const records = await Promise.all(stores.map((storeName) => readJsonl(dataDir, storeName)));
  return mergeLatestRefillJobsById(
    stores.map((storeName, index) => ({
      storeName,
      jobs: records[index],
    })),
  );
}

export async function readRefillJobById(dataDir, jobId, options = {}) {
  const jobs = await readLatestRefillJobs(dataDir, options);
  return jobs.find((item) => item.jobId === jobId) || null;
}
