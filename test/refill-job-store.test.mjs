import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  mergeLatestRefillJobsById,
  readLatestRefillJobs,
  readRefillJobById,
} from "../src/executor/helpers/refill-job-store.mjs";

test("mergeLatestRefillJobsById prefers newest createdAt across refill stores", () => {
  const jobs = mergeLatestRefillJobsById([
    {
      storeName: "treasury-refill-jobs",
      jobs: [
        {
          jobId: "job-1",
          createdAt: "2026-04-20T09:00:00.000Z",
          chain: "base",
          asset: "wBTC.OFT",
        },
      ],
    },
    {
      storeName: "capital-manager-refill-jobs",
      jobs: [
        {
          jobId: "job-1",
          createdAt: "2026-04-20T10:00:00.000Z",
          chain: "base",
          asset: "ETH",
        },
      ],
    },
  ]);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].asset, "ETH");
  assert.equal(jobs[0].jobSourceStore, "capital-manager-refill-jobs");
});

test("readRefillJobById resolves capital-manager jobs without duplicating them into treasury store", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-refill-store-"));
  try {
    await writeFile(
      join(tempDir, "capital-manager-refill-jobs.jsonl"),
      `${JSON.stringify({
        jobId: "job-capital",
        createdAt: "2026-04-20T10:00:00.000Z",
        chain: "sonic",
        asset: "wBTC.OFT",
      })}\n`,
    );
    await writeFile(
      join(tempDir, "treasury-refill-jobs.jsonl"),
      `${JSON.stringify({
        jobId: "job-treasury",
        createdAt: "2026-04-20T09:00:00.000Z",
        chain: "base",
        asset: "ETH",
      })}\n`,
    );

    const jobs = await readLatestRefillJobs(tempDir);
    const capitalJob = await readRefillJobById(tempDir, "job-capital");

    assert.equal(jobs.length, 2);
    assert.equal(capitalJob?.chain, "sonic");
    assert.equal(capitalJob?.jobSourceStore, "capital-manager-refill-jobs");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
