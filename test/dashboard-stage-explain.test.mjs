import assert from "node:assert/strict";
import { test } from "node:test";
import { explainCurrentStage } from "../src/cli/dashboard-stage-explain.mjs";

test("dashboard stage explain reads stage blockers and evidence from lanePolicy", () => {
  const explanation = explainCurrentStage({
    overall: {
      lanePolicy: {
        stage: "B",
        stageBlockers: ["refill_routes_unresolved"],
        stageEvidence: {
          unresolvedRefillRoutes: 7,
        },
      },
    },
  });

  assert.equal(explanation.stage, "B");
  assert.deepEqual(explanation.blockers, ["refill_routes_unresolved"]);
  assert.deepEqual(explanation.evidence, { unresolvedRefillRoutes: 7 });
});
