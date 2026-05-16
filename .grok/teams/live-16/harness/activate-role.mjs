#!/usr/bin/env node
/**
 * .grok/teams/live-16/harness/activate-role.mjs
 *
 * Initial activation test script for BOB Claw 16-Person Live Team (B Model) roles.
 * Validates that a role definition .md follows the standard template structure
 * (as established in protocol.md and all roles/ files).
 *
 * Usage:
 *   node .grok/teams/live-16/harness/activate-role.mjs --help
 *   node .grok/teams/live-16/harness/activate-role.mjs --list
 *   node .grok/teams/live-16/harness/activate-role.mjs --validate "Capital & Treasury Domain Lead"
 *   node .grok/teams/live-16/harness/activate-role.mjs --validate-all
 *   node .grok/teams/live-16/harness/activate-role.mjs --spawn-example "Yield & Campaign Opportunity Engineer"
 *
 * This script is the bootstrap for 16-team internal harness verification.
 * It enforces that every role prompt is spawn-ready and references the Live Collaboration Protocol.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROLES_DIR = path.join(__dirname, '..', 'roles');
const PROTOCOL_REF = 'protocol.md';

const ROLE_FILES = {
  'Capital & Treasury Domain Lead': 'Capital-and-Treasury-Domain-Lead.md',
  'Evidence, Data & Quality Domain Lead': 'Evidence-Data-and-Quality-Domain-Lead.md',
  'Opportunity & Research Domain Lead': 'Opportunity-and-Research-Domain-Lead.md',
  'Risk, Safety & Resilience Domain Lead': 'Risk-Safety-and-Resilience-Domain-Lead.md',
  'Execution & Policy Domain Lead': 'Execution-and-Policy-Domain-Lead.md',
  'Payback & Gateway Settlement Domain Lead': 'Payback-and-Gateway-Settlement-Domain-Lead.md',
  'Refill & Capital Automation Engineer': 'Refill-and-Capital-Automation-Engineer.md',
  'Allocation & Rebalancing Specialist': 'Allocation-and-Rebalancing-Specialist.md',
  'Resilience & Self-Healing Engineer': 'Resilience-and-Self-Healing-Engineer.md',
  'Policy & Intent Evaluation Engineer': 'Policy-and-Intent-Evaluation-Engineer.md',
  'Signer & Audit Integrity Engineer': 'Signer-and-Audit-Integrity-Engineer.md',
  'Settlement & Proof Engineer': 'Settlement-and-Proof-Engineer.md',
  'Yield & Campaign Opportunity Engineer': 'Yield-and-Campaign-Opportunity-Engineer.md',
  'Protocol Reader & On-chain Data Engineer': 'Protocol-Reader-and-On-chain-Data-Engineer.md',
  'Receipt & Reconciliation Engineer': 'Receipt-and-Reconciliation-Engineer.md'
};

const REQUIRED_MARKERS = [
  { label: 'Title (# Role Name)', regex: /^#\s+.+/m },
  { label: '**Type** (Domain Lead or Specialist)', regex: /\*\*Type\*\*:\s*(Domain Lead|Specialist)/m },
  { label: '**Primary Ownership** or **Primary Domain**', regex: /\*\*(Primary Ownership|Primary Domain)\*\*:/m },
  { label: '**Core Mission**', regex: /\*\*Core Mission\*\*/m },
  { label: '**Key Areas You Own**', regex: /\*\*Key Areas You Own\*\*/m },
  { label: '**Collaboration Expectations (B Model)**', regex: /\*\*Collaboration Expectations \(B Model\)\*\*/m },
  { label: '**How to Call You**', regex: /\*\*How to Call You\*\*/m },
  { label: '**Flexibility & Evolution Rule**', regex: /\*\*Flexibility & Evolution Rule.*\*\*/m },
  { label: '**Operating Style**', regex: /\*\*Operating Style\*\*/m },
  { label: 'Reference to Live Collaboration Protocol / B Model', regex: /Live Collaboration Protocol|protocol\.md|B Model|16-Person Live Team Protocol/m }
];

function printHelp() {
  console.log(`
16-Team Role Activation Validator (Harness Bootstrap)

Commands:
  --help                  Show this help
  --list                  List all known 16-team roles and their file status
  --validate "Exact Role Name"   Validate one role definition against template
  --validate-all          Validate every defined role (exit 1 on any failure)
  --spawn-example "Exact Role Name"   Print a ready-to-paste spawn prompt snippet using the Direct Call template

All roles must pass validation before being spawned in a live session.
This enforces evidence-complete activation hygiene for the 16-person team.
`);
}

function normalizeRoleName(input) {
  if (ROLE_FILES[input]) return input;
  // tolerant match
  const lower = input.toLowerCase();
  for (const name of Object.keys(ROLE_FILES)) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

async function loadRoleContent(roleName) {
  const fileName = ROLE_FILES[roleName];
  if (!fileName) {
    throw new Error(`Unknown role: ${roleName}. Use --list to see valid names.`);
  }
  const fullPath = path.join(ROLES_DIR, fileName);
  const content = await fs.readFile(fullPath, 'utf8');
  return { content, fullPath, fileName };
}

async function validateRole(roleName) {
  const normalized = normalizeRoleName(roleName);
  if (!normalized) {
    return { role: roleName, valid: false, error: 'Unknown role name. Run --list for exact names.' };
  }
  try {
    const { content, fullPath } = await loadRoleContent(normalized);
    const issues = [];

    for (const marker of REQUIRED_MARKERS) {
      if (!marker.regex.test(content)) {
        issues.push(`Missing or malformed: ${marker.label}`);
      }
    }

    // Extra quality checks for 16-team protocol compliance (tolerant — early roles use "collaborate" language + B Model section)
    const hasCollaborationSignal = /collaborat/i.test(content) ||
                                   content.includes('templates/') ||
                                   content.includes('handoff') ||
                                   content.includes('Joint Session') ||
                                   content.includes('Live Collaboration Protocol') ||
                                   content.includes('B Model');
    if (!hasCollaborationSignal) {
      issues.push('Missing explicit collaboration pattern guidance (collaborate language, templates/, B Model, handoff, or Direct Call)');
    }
    if (!content.includes('How to Call You')) {
      issues.push('Missing "How to Call You" activation address');
    }
    if (content.includes('You are the "') && !content.match(/You are (the|being called)/)) {
      // loose
    }

    const isDomainLead = /\*\*Type\*\*:\s*Domain Lead/m.test(content);
    const isSpecialist = /\*\*Type\*\*:\s*Specialist/m.test(content);

    if (!isDomainLead && !isSpecialist) {
      issues.push('Type must be explicitly "Domain Lead" or "Specialist"');
    }

    return {
      role: normalized,
      valid: issues.length === 0,
      file: fullPath,
      issues: issues.length ? issues : null,
      type: isDomainLead ? 'Domain Lead' : (isSpecialist ? 'Specialist' : 'Unknown')
    };
  } catch (err) {
    return { role: normalized, valid: false, error: err.message };
  }
}

async function listRoles() {
  console.log('16-Team Roles (15 definitions + 1 orchestration):\n');
  for (const [name, file] of Object.entries(ROLE_FILES)) {
    const full = path.join(ROLES_DIR, file);
    let status = 'MISSING';
    try {
      await fs.access(full);
      status = 'DEFINED';
    } catch {}
    console.log(`  ${name.padEnd(42)} ${status}  (${file})`);
  }
  console.log('\n  Engineering Manager & Live Team Coordinator   ORCHESTRATION  (protocol.md + templates/ + main coordinator)');
  console.log('\nRun --validate-all to run harness activation checks on all defined roles.\n');
}

async function validateAll() {
  console.log('Running 16-Team Role Activation Validation (harness bootstrap)...\n');
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const name of Object.keys(ROLE_FILES)) {
    const result = await validateRole(name);
    if (result.valid) {
      console.log(`✅ PASS: ${name} (${result.type})`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${name}`);
      if (result.issues) result.issues.forEach(i => console.log(`     - ${i}`));
      if (result.error) console.log(`     - ${result.error}`);
      failed++;
      failures.push(result);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Passed: ${passed} / ${Object.keys(ROLE_FILES).length}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailures require scaffolder or role definition fixes before live spawn.');
    process.exitCode = 1;
  } else {
    console.log('\nAll roles are template-compliant and activation-ready per protocol.md.');
  }
}

function printSpawnExample(roleName) {
  const normalized = normalizeRoleName(roleName);
  if (!normalized) {
    console.error('Unknown role. Use --list.');
    process.exit(1);
  }
  const fileName = ROLE_FILES[normalized];
  const roleFile = `.grok/teams/live-16/roles/${fileName}`;

  console.log(`
=== READY-TO-PASTE SPAWN PROMPT (Direct Call pattern) ===

You are the ${normalized}.
Reference: .grok/teams/live-16/protocol.md and your role definition at ${roleFile}

You are being called into a live collaboration using the BOB Claw 16-Person Live Team Protocol (B Model).

**Calling Agent**: [Your Role, e.g. Evidence, Data & Quality Domain Lead]
**Called Role**: ${normalized}

**Context / Why you are needed**:
[Describe the specific task, e.g. "DefiLlama yield lane needs receipt-backed validation for YCE-002. Current blocker is in active-work/defillama-yield-lane-revival.md. We need your on-chain reader + settlement proof integration to move from analysis_only to shadow_ready."]

**Relevant shared artifacts** (read these first):
- .grok/teams/live-16/active-work/<task>.md
- Recent diagnostic output (e.g. npm run report:capital-audit -- --json or snapshot:defillama)
- Your role definition and protocol.md

**What the calling agent expects from you**:
- [Specific: review + propose design, take ownership of X, produce receipt schema update, validate on-chain proof, etc.]

**Collaboration rules**:
- Stay in Execution Mode.
- Use fork_context: true if you need to pull additional roles.
- Write all material updates to the shared active-work/ artifact.
- Directly address other roles by full name when needed.
- Quote raw diagnostic outputs when relevant.

Please respond with analysis or next concrete step. If you need to hand off or call a Joint Session, say so clearly using the templates in .grok/teams/live-16/templates/.

=== END PROMPT ===

To actually spawn: the Engineering Manager / Domain Lead uses the task tool (spawn_subagent) with the above in the prompt, fork_context: true, background if long-running.
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printHelp();
    return;
  }

  if (args.includes('--list')) {
    await listRoles();
    return;
  }

  if (args.includes('--validate-all')) {
    await validateAll();
    return;
  }

  const validateIdx = args.indexOf('--validate');
  if (validateIdx !== -1) {
    const roleArg = args[validateIdx + 1];
    if (!roleArg) {
      console.error('Usage: --validate "Exact Role Name"');
      process.exit(1);
    }
    const result = await validateRole(roleArg);
    if (result.valid) {
      console.log(`✅ VALID: ${result.role} is template-compliant and ready for spawn.`);
      console.log(`   File: ${result.file}`);
      console.log(`   Type: ${result.type}`);
    } else {
      console.log(`❌ INVALID: ${result.role || roleArg}`);
      if (result.issues) result.issues.forEach(i => console.log(`   - ${i}`));
      if (result.error) console.log(`   Error: ${result.error}`);
      process.exitCode = 1;
    }
    return;
  }

  const exampleIdx = args.indexOf('--spawn-example');
  if (exampleIdx !== -1) {
    const roleArg = args[exampleIdx + 1];
    if (!roleArg) {
      console.error('Usage: --spawn-example "Exact Role Name"');
      process.exit(1);
    }
    printSpawnExample(roleArg);
    return;
  }

  printHelp();
}

main().catch(err => {
  console.error('Harness activation script error:', err);
  process.exit(1);
});
