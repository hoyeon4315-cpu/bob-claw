import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  assertRecordedRpcFixtureCoverage,
  buildResearchSplits,
  loadRecordedRpcFixtures,
  loadResearchPanel,
  readOnlyArchiveRpc,
} from "../research/prepare.mjs";
import {
  appendResultRow,
  decideStagnationKills,
  runCandidateRound,
  validateCandidateWorkspace,
} from "../research/run.mjs";
import { runTrackBSearch } from "../research/factorSearch.mjs";
import { scanResearchIsolation } from "../research/isolationGuard.mjs";
import {
  emitPromotionIntent,
  scoreCandidateResults,
  shouldEmitPromotionIntent,
} from "../research/score.mjs";

function tempDir(name) {
  return mkdtempSync(join(tmpdir(), `bob-claw-${name}-`));
}

function writeCandidate(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, body, "utf8");
  return path;
}

const CANDIDATE_BODY = `
export const metadata = {
  name: "MomentumCarry",
  track: "A",
  family: "momentum",
  event: "create",
  notes: "fixture momentum candidate"
};

export function buildSignals({ panel, helpers }) {
  const close = panel.rows.map((row) => row.close);
  const fast = helpers.sma(close, 3);
  const slow = helpers.sma(close, 8);
  return panel.rows.map((row, index) => fast[index] > slow[index] ? 1 : 0);
}
`;

test("research prepare builds deterministic purged and embargoed splits", () => {
  const panel = loadResearchPanel({ bars: 90, chains: ["base"], seed: 7 });
  const splits = buildResearchSplits(panel, {
    foldCount: 4,
    trainSize: 24,
    valSize: 8,
    purgeSize: 2,
    embargoSize: 2,
  });

  assert.equal(splits.length, 4);
  assert.deepEqual(
    splits.map((split) => split.id),
    ["fold_0", "fold_1", "fold_2", "fold_3"],
  );
  for (const split of splits) {
    assert.equal(split.train.end + 2, split.val.start);
    assert.equal(split.val.end + 2, split.embargoEnd);
    assert.ok(split.train.start >= 0);
    assert.ok(split.embargoEnd <= panel.rows.length);
  }
});

test("recorded read-only RPC fixtures cover all 11 Gateway destination chains and block mutation methods", async () => {
  const fixtures = loadRecordedRpcFixtures();
  const coverage = assertRecordedRpcFixtureCoverage(fixtures);
  assert.equal(coverage.ok, true, JSON.stringify(coverage));
  assert.equal(coverage.chains.length, 11);
  assert.rejects(
    () => readOnlyArchiveRpc({ chain: "base", method: "eth_sendRawTransaction", params: ["0xdead"] }),
    /blocked read-only research rpc method/,
  );
  const block = await readOnlyArchiveRpc({ chain: "base", method: "eth_blockNumber" });
  assert.match(block, /^0x/);
});

test("candidate workspace enforces max three active candidate files and stagnation kills", () => {
  const dir = tempDir("research-candidates");
  try {
    writeCandidate(dir, "alpha", CANDIDATE_BODY);
    writeCandidate(dir, "beta", CANDIDATE_BODY.replace("MomentumCarry", "BetaCarry"));
    writeCandidate(dir, "gamma", CANDIDATE_BODY.replace("MomentumCarry", "GammaCarry"));
    const valid = validateCandidateWorkspace(dir);
    assert.equal(valid.ok, true);
    assert.equal(valid.activeFiles.length, 3);

    writeCandidate(dir, "delta", CANDIDATE_BODY.replace("MomentumCarry", "DeltaCarry"));
    const invalid = validateCandidateWorkspace(dir);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.blockers.includes("too_many_active_candidates"));

    const stale = decideStagnationKills([
      { event: "stable", candidate_name: "alpha" },
      { event: "stable", candidate_name: "alpha" },
      { event: "stable", candidate_name: "alpha" },
      { event: "evolve", candidate_name: "beta" },
      { event: "stable", candidate_name: "beta" },
    ]);
    assert.deepEqual(stale.mustKillOrTouch, ["alpha"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backtest runner appends exactly one TSV row per evaluated candidate", async () => {
  const dir = tempDir("research-run");
  const candidateDir = join(dir, "candidates");
  const resultsPath = join(dir, "results.tsv");
  try {
    writeCandidate(candidateDir, "momentum_carry", CANDIDATE_BODY);
    const panel = loadResearchPanel({ bars: 80, chains: ["base"], seed: 11 });
    const split = buildResearchSplits(panel, { foldCount: 1, trainSize: 32, valSize: 16 })[0];
    const round = await runCandidateRound({
      candidateDir,
      resultsPath,
      panel,
      split,
      commit: "abc1234",
    });
    assert.equal(round.rows.length, 1);
    assert.equal(readFileSync(resultsPath, "utf8").trim().split("\n").length, 2);

    appendResultRow(resultsPath, {
      commit: "def5678",
      event: "stable",
      candidate_name: "momentum_carry",
      sharpe: 1.2,
      maxdd: -0.05,
      turnover: 0.2,
      notes: "manual append",
    });
    assert.equal(readFileSync(resultsPath, "utf8").trim().split("\n").length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("research scorer blocks weak candidates and emits promotion intents only through auto-promotion evidence", () => {
  const weak = scoreCandidateResults({
    candidateName: "weak",
    track: "A",
    foldResults: [
      { sharpe: 0.1, maxDrawdownPct: 4, turnover: 0.3, capacityUsd: 500, netReturn: 0.001 },
      { sharpe: -0.1, maxDrawdownPct: 6, turnover: 0.4, capacityUsd: 500, netReturn: -0.001 },
    ],
  });
  assert.equal(shouldEmitPromotionIntent(weak), false);
  assert.ok(weak.blockers.includes("deflated_sharpe_lower_bound_below_threshold"));

  const strong = scoreCandidateResults({
    candidateName: "strong",
    track: "B",
    foldResults: Array.from({ length: 12 }, (_, index) => ({
      sharpe: 2.2 + index * 0.01,
      maxDrawdownPct: 4,
      turnover: 0.18,
      capacityUsd: 50_000,
      netReturn: 0.02,
    })),
  });
  assert.equal(strong.autoPromotion.passed, true, JSON.stringify(strong.autoPromotion.blockers));
  assert.equal(shouldEmitPromotionIntent(strong), true);

  const dir = tempDir("research-promotion");
  try {
    const out = join(dir, "research-promotion-intents.jsonl");
    const record = emitPromotionIntent({
      score: strong,
      candidatePath: "research/candidates/strong.mjs",
      outPath: out,
      now: "2026-04-26T00:00:00.000Z",
    });
    assert.equal(record.action, "request_committed_canary_promotion");
    assert.equal(record.liveDeploy, false);
    assert.ok(record.gate.initialCanaryCaps.perTxUsd > 0);
    const raw = readFileSync(out, "utf8");
    assert.match(raw, /request_committed_canary_promotion/);
    assert.doesNotMatch(raw, /sendRawTransaction|signerSocket|liveDeploy":true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Track B deterministic factor search emits an OOS-eligible candidate on fixture data", async () => {
  const dir = tempDir("research-track-b");
  const candidateDir = join(dir, "candidates");
  try {
    const result = await runTrackBSearch({
      candidateDir,
      maxCandidates: 1,
      panel: loadResearchPanel({ bars: 160, chains: ["base"], seed: 21 }),
      now: "2026-04-26T00:00:00.000Z",
    });
    assert.equal(result.generatedCount, 1);
    assert.equal(result.oosEligibleCount, 1);
    assert.equal(existsSync(result.generated[0].path), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("research static guard rejects signer, treasury-key, live-fund, and key-env edges", () => {
  const clean = scanResearchIsolation({ rootDir: resolve(".") });
  assert.equal(clean.ok, true, JSON.stringify(clean.violations.slice(0, 3)));

  const dir = tempDir("research-guard");
  try {
    mkdirSync(join(dir, "research"), { recursive: true });
    writeFileSync(
      join(dir, "research", "bad.mjs"),
      'import "../src/executor/signer/client.mjs";\nconsole.log(process.env.BURNER_EVM_KEY_PATH);\n',
      "utf8",
    );
    const dirty = scanResearchIsolation({ rootDir: dir });
    assert.equal(dirty.ok, false);
    assert.ok(dirty.violations.some((item) => item.reason === "forbidden_path"));
    assert.ok(dirty.violations.some((item) => item.reason === "forbidden_secret_env"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("npm run research -- --max-experiments=1 --no-agent completes without production state", () => {
  const dir = tempDir("research-cli");
  try {
    const result = spawnSync(
      "npm",
      [
        "run",
        "research",
        "--",
        "--max-experiments=1",
        "--no-agent",
        `--data-dir=${join(dir, "data")}`,
        `--candidate-dir=${join(dir, "candidates")}`,
        `--results-path=${join(dir, "results.tsv")}`,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          DEV_LOCK_PATH: join(dir, "DEV_LOCK"),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /trackB/);
    assert.equal(existsSync(join(dir, "results.tsv")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
