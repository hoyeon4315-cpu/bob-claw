#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function currentStage(state) {
  return state.stages.find((stage) => stage.id === state.currentStageId) || state.stages.find((stage) => stage.status === "in_progress") || null;
}

function packetHead(packet = null) {
  return packet?.summary?.topPacketItems?.[0] || packet?.items?.[0] || null;
}

function stageBlockers(stage = null, { packet = null, promotionGate = null, allocationPlan = null } = {}) {
  if (!stage) return [];

  if (stage.id === "stage_5_destination_scoring") {
    const blockers = [];
    if (Number.isFinite(packet?.summary?.itemCount) && packet.summary.itemCount > 0) {
      blockers.push(`economics_packet_remaining:${packet.summary.itemCount}`);
    }
    if (Number.isFinite(promotionGate?.summary?.reviewOnlyCount) && promotionGate.summary.reviewOnlyCount > 0) {
      blockers.push(`allocation_review_only:${promotionGate.summary.reviewOnlyCount}`);
    }
    return blockers;
  }

  if (stage.id === "stage_6_overfit_and_truthfulness_gates") {
    const blockers = [];
    if (Number.isFinite(promotionGate?.summary?.reviewOnlyCount) && promotionGate.summary.reviewOnlyCount > 0) {
      blockers.push(`review_only_candidates:${promotionGate.summary.reviewOnlyCount}`);
    }
    for (const item of promotionGate?.summary?.topAllocationBlockers || []) {
      blockers.push(`${item.blocker}:${item.count}`);
    }
    return blockers;
  }

  if (stage.id === "stage_7_allocation_planner") {
    const blockers = [];
    if ((allocationPlan?.summary?.allocationReadyCount || 0) <= 0) blockers.push("no_allocation_ready_candidates");
    if ((allocationPlan?.summary?.activeAllocationCount || 0) <= 0) blockers.push("no_active_allocations");
    return blockers;
  }

  if (stage.id === "stage_8_reviewable_agent_loop") {
    return packetHead(packet) ? ["next_action_should_be_persisted_from_packet_head"] : ["allocator_next_action_unknown"];
  }

  if (stage.id === "stage_9_execution_admission_preparation") {
    return (allocationPlan?.summary?.allocationReadyCount || 0) > 0
      ? ["allocator_candidates_need_manual_admission_review"]
      : ["no_allocator_candidate_ready_for_admission"];
  }

  return [];
}

function nextAction(stage = null, { packet = null, promotionGate = null } = {}) {
  if (!stage) return null;

  if (stage.id === "stage_5_destination_scoring") {
    const head = packetHead(packet);
    return head
      ? {
          code: "measure_destination_economics",
          label: `measure ${head.templateId}`,
          command: head.commandSuggestion || null,
        }
      : null;
  }

  if (stage.id === "stage_6_overfit_and_truthfulness_gates") {
    const reviewOnly = promotionGate?.summary?.topReviewOnly?.[0] || null;
    return reviewOnly?.allocationGate?.nextAction || null;
  }

  if (stage.id === "stage_7_allocation_planner") {
    return {
      code: "review_destination_allocation_plan",
      label: "review destination allocation plan",
      command: "npm run report:destination-allocation-plan -- --json",
    };
  }

  if (stage.id === "stage_8_reviewable_agent_loop") {
    return {
      code: "write_session_handoff",
      label: "refresh session handoff artifacts",
      command: "npm run write:session-handoff",
    };
  }

  if (stage.id === "stage_9_execution_admission_preparation") {
    return {
      code: "build_prelive_review_package",
      label: "rebuild prelive review package",
      command: "npm run build:prelive-review-package -- --write",
    };
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const statePath = join(config.dataDir, "native-btc-capital-allocator-plan-state.json");
  const state = await readJson(statePath);
  const stage = currentStage(state);
  const [economicsPacket, promotionGate, allocationPlan] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "destination-economics-packet.json")),
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonIfExists(join(config.dataDir, "destination-allocation-plan.json")),
  ]);
  const completed = state.stages.filter((item) => item.status === "completed");
  const remaining = state.stages.filter((item) => item.status !== "completed");
  const destinationPacketHead = packetHead(economicsPacket);
  const action = nextAction(stage, { packet: economicsPacket, promotionGate, allocationPlan });

  const report = {
    schemaVersion: 1,
    statePath,
    lastReviewedAt: state.lastReviewedAt,
    currentStage: stage
      ? {
          id: stage.id,
          label: stage.label,
          status: stage.status,
          verification: stage.verification || [],
        }
      : null,
    progress: {
      completedStageCount: completed.length,
      remainingStageCount: remaining.length,
      totalStageCount: state.stages.length,
      progressPct: state.summary?.progressPct ?? null,
    },
    nextStages: remaining.slice(0, 3).map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
    })),
    stageBlockers: stageBlockers(stage, {
      packet: economicsPacket,
      promotionGate,
      allocationPlan,
    }),
    nextAction: action,
    destinationAllocator: {
      packetHead: destinationPacketHead
        ? {
            templateId: destinationPacketHead.templateId,
            chain: destinationPacketHead.chain,
            familyId: destinationPacketHead.familyId,
            label: destinationPacketHead.label,
          }
        : null,
      packetItemCount: economicsPacket?.summary?.itemCount ?? 0,
      promotableCount: promotionGate?.summary?.promotableCount ?? 0,
      allocationReadyCount: promotionGate?.summary?.allocationReadyCount ?? 0,
      reviewOnlyCount: promotionGate?.summary?.reviewOnlyCount ?? 0,
      activeAllocationCount: allocationPlan?.summary?.activeAllocationCount ?? 0,
      planningAllocationCount: allocationPlan?.summary?.planningAllocationCount ?? 0,
    },
    sessionStartChecklist: state.sessionStartChecklist || [],
    groundTruth: state.groundTruth || {},
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`currentStage=${report.currentStage?.label || "n/a"} (${report.currentStage?.status || "unknown"})`);
  console.log(`progress=${report.progress.completedStageCount}/${report.progress.totalStageCount}`);
  console.log(`remainingStages=${report.progress.remainingStageCount}`);
  console.log(`progressPct=${report.progress.progressPct ?? "n/a"}`);
  console.log(`lastReviewedAt=${report.lastReviewedAt || "n/a"}`);
  console.log("");
  console.log("Current stage verification:");
  for (const item of report.currentStage?.verification || []) {
    console.log(`- ${item}`);
  }
  console.log("");
  console.log("Next stages:");
  for (const item of report.nextStages) {
    console.log(`- ${item.label} (${item.status})`);
  }
  console.log("");
  console.log("Allocator context:");
  console.log(`- packetHead=${report.destinationAllocator.packetHead?.templateId || "n/a"}`);
  console.log(`- packetItems=${report.destinationAllocator.packetItemCount}`);
  console.log(`- promotable=${report.destinationAllocator.promotableCount}`);
  console.log(`- allocationReady=${report.destinationAllocator.allocationReadyCount}`);
  console.log(`- reviewOnly=${report.destinationAllocator.reviewOnlyCount}`);
  console.log(`- activeAllocations=${report.destinationAllocator.activeAllocationCount}`);
  if (report.stageBlockers.length > 0) {
    console.log("");
    console.log("Stage blockers:");
    for (const item of report.stageBlockers) {
      console.log(`- ${item}`);
    }
  }
  if (report.nextAction) {
    console.log("");
    console.log(`nextAction=${report.nextAction.code || "n/a"} command=${report.nextAction.command || "n/a"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
