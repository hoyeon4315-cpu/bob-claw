import assert from "node:assert/strict";
import { test } from "node:test";
import { isAddress } from "ethers";
import {
  DESTINATION_REPRESENTATIVE_BINDINGS,
} from "../src/config/destination-representative-bindings.mjs";
import {
  buildRepresentativeChainCoverage,
  buildRepresentativeTargets,
} from "../src/strategy/representative-chain-coverage.mjs";
import { selectDestinationRepresentativeCandidate } from "../src/executor/destination-representative-autopilot.mjs";

const OFFICIAL_REPO_CHAINS = [
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "bera",
  "optimism",
  "soneium",
  "sei",
  "sonic",
];

const KNOWN_BINDING_KINDS = new Set([
  "compound_v2_ctoken_mint_redeem",
  "aave_v3_pool_supply_withdraw",
  "compound_v3_comet_supply_withdraw",
  "moonwell_mtoken_mint_redeem",
  "erc4626_vault_supply_withdraw",
  "euler_evault_deposit_withdraw",
]);

test("destination representative bindings cover every official Gateway chain exactly once", () => {
  const bindings = Object.values(DESTINATION_REPRESENTATIVE_BINDINGS);
  assert.equal(bindings.length, OFFICIAL_REPO_CHAINS.length);
  assert.deepEqual([...new Set(bindings.map((binding) => binding.chain))].sort(), [...OFFICIAL_REPO_CHAINS].sort());

  for (const chain of OFFICIAL_REPO_CHAINS) {
    const chainBindings = bindings.filter((binding) => binding.chain === chain);
    assert.equal(chainBindings.length, 1, `${chain} has one representative binding`);
  }

  for (const binding of bindings) {
    assert.equal(isAddress(binding.assetAddress), true, `${binding.templateId} asset address is valid`);
    assert.equal(KNOWN_BINDING_KINDS.has(binding.bindingKind), true, `${binding.templateId} binding kind is known`);
    if (binding.enabled !== false) {
      const shareAddress = binding.cTokenAddress || binding.cometAddress || binding.aTokenAddress || binding.shareTokenAddress || binding.vaultAddress;
      assert.equal(isAddress(shareAddress), true, `${binding.templateId} executable share address is valid`);
      assert.ok(binding.evidence?.lastVerifiedAt, `${binding.templateId} executable binding has verification date`);
    }
  }
});

test("representative coverage tracks queued, active, and missing chain venues without adding executable queue items", () => {
  const targets = buildRepresentativeTargets({
    wrappedBtcVenues: {
      base: {
        venues: [
          { protocol: "moonwell", family: "lending", asset: "wBTC.OFT" },
          { protocol: "aerodrome", family: "cl_lp", asset: "cbBTC/LBTC" },
        ],
      },
      bsc: {
        venues: [
          { protocol: "venus", family: "lending", asset: "wBTC.OFT" },
        ],
      },
    },
    stableVenues: {
      ethereum: {
        venues: [
          { protocol: "aave_v3", family: "lending", depositAsset: "USDC" },
        ],
      },
    },
  });
  const coverage = buildRepresentativeChainCoverage({
    targets,
    now: "2026-04-25T00:00:00.000Z",
    queue: [
      {
        chain: "base",
        protocolId: "moonwell",
        executionReadiness: { status: "inventory_missing" },
        protocolBindingPlan: { status: "binding_ready" },
      },
    ],
    positionRecords: [
      {
        event: "position_opened",
        positionId: "p1",
        chain: "ethereum",
        protocolId: "aave",
        amountUsd: 25,
      },
    ],
  });

  assert.equal(coverage.summary.chainCount, 3);
  assert.equal(coverage.summary.queuedRepresentativeChainCount, 1);
  assert.equal(coverage.summary.activeRepresentativeChainCount, 1);
  assert.equal(coverage.summary.missingRepresentativeChainCount, 1);
  assert.deepEqual(coverage.summary.missingChains, ["bsc"]);

  const base = coverage.chains.find((item) => item.chain === "base");
  assert.equal(base.status, "queued_representative");
  assert.ok(base.blockers.includes("representative_inventory_or_gas_not_ready"));

  const ethereum = coverage.chains.find((item) => item.chain === "ethereum");
  assert.equal(ethereum.status, "active_representative");
  assert.equal(ethereum.nextAction, "monitor_active_representative_receipts");
});

test("destination representative selector prefers larger ready inventory before dust candidates", () => {
  const selected = selectDestinationRepresentativeCandidate([
    {
      templateId: "avalanche:stablecoin_lending_carry",
      chain: "avalanche",
      status: "ready",
      matchedToken: { estimatedUsd: 0.84 },
      matchedNative: { estimatedUsd: 5.9 },
    },
    {
      templateId: "soneium:stablecoin_lending_carry",
      chain: "soneium",
      status: "ready",
      matchedToken: { estimatedUsd: 3.29 },
      matchedNative: { estimatedUsd: 1.29 },
    },
    {
      templateId: "base:stablecoin_lending_carry",
      chain: "base",
      status: "covered",
      matchedToken: { estimatedUsd: 20 },
    },
  ]);

  assert.equal(selected.templateId, "soneium:stablecoin_lending_carry");
});
