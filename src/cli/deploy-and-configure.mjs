#!/usr/bin/env node
/**
 * deploy-and-configure.mjs
 * One-click: Deploy BalancerFlashArb → verify → save address → test call
 * 
 * Usage: node src/cli/deploy-and-configure.mjs --private-key=0x...
 *   or:  PRIVATE_KEY=0x... node src/cli/deploy-and-configure.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const RPC = 'https://mainnet.base.org';
const WALLET = '0x96262be63aa687563789225c2fe898c27a3b0ae4';
const FORGE = process.env.HOME + '/.foundry/bin/forge';
const CAST = process.env.HOME + '/.foundry/bin/cast';
const CONFIG_PATH = 'data/deployed-contract.json';

// --- Parse args ---
let privateKey = process.env.PRIVATE_KEY;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--private-key=')) privateKey = arg.split('=')[1];
}

if (!privateKey) {
  console.error('❌ Private key required.');
  console.error('Usage: node src/cli/deploy-and-configure.mjs --private-key=0x...');
  console.error('  or:  PRIVATE_KEY=0x... node src/cli/deploy-and-configure.mjs');
  process.exit(1);
}

// Validate format
if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
  console.error('❌ Private key must be 0x + 64 hex chars (66 total). Got', privateKey.length, 'chars.');
  process.exit(1);
}

// --- Check existing deployment ---
if (existsSync(CONFIG_PATH)) {
  const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  console.log(`⚠️  Existing deployment found: ${existing.contractAddress}`);
  console.log(`   Deployed at: ${existing.deployedAt}`);
  
  // Verify it still has code
  try {
    const code = execSync(`${CAST} code ${existing.contractAddress} --rpc-url ${RPC} 2>&1`).toString().trim();
    if (code !== '0x' && code.length > 2) {
      console.log('✅ Contract still live on-chain. Skipping redeploy.');
      console.log(`\n🚀 Ready to trade: npm run trigger:arb -- --once --simulate --contract=${existing.contractAddress}`);
      process.exit(0);
    }
  } catch {}
  console.log('   Contract no longer has code. Redeploying...\n');
}

// --- Step 1: Check balance ---
console.log('🔍 Step 1: Checking wallet...');
try {
  const bal = execSync(`${CAST} balance ${WALLET} --rpc-url ${RPC} --ether 2>&1`).toString().trim();
  console.log(`   Balance: ${bal} ETH`);
  if (parseFloat(bal) < 0.001) {
    console.error('❌ Insufficient ETH for deployment (~0.003 needed)');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Failed to check balance:', e.message);
  process.exit(1);
}

// --- Step 2: Deploy ---
console.log('\n🚀 Step 2: Deploying BalancerFlashArb...');
let deployOutput;
try {
  deployOutput = execSync(
    `${FORGE} create src/contracts/BalancerFlashArb.sol:BalancerFlashArb ` +
    `--rpc-url ${RPC} ` +
    `--private-key ${privateKey} ` +
    `--constructor-args ${WALLET}`,
    { cwd: process.cwd(), timeout: 120000 }
  ).toString();
  console.log(deployOutput);
} catch (e) {
  console.error('❌ Deployment failed:', e.stderr?.toString() || e.message);
  process.exit(1);
}

// Extract address
const addrMatch = deployOutput.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/);
if (!addrMatch) {
  console.error('❌ Could not parse deployed address from output');
  process.exit(1);
}
const contractAddress = addrMatch[1];

// --- Step 3: Verify ---
console.log('🔍 Step 3: Verifying contract...');
try {
  const code = execSync(`${CAST} code ${contractAddress} --rpc-url ${RPC} 2>&1`).toString().trim();
  if (code === '0x' || code.length <= 2) {
    console.error('❌ No code at deployed address!');
    process.exit(1);
  }
  console.log(`   ✅ Code verified (${code.length} chars)`);
  
  // Verify owner
  const owner = execSync(`${CAST} call ${contractAddress} "owner()(address)" --rpc-url ${RPC} 2>&1`).toString().trim();
  console.log(`   ✅ Owner: ${owner}`);
  if (owner.toLowerCase() !== WALLET.toLowerCase()) {
    console.warn('   ⚠️  Owner mismatch! Expected', WALLET);
  }
} catch (e) {
  console.error('❌ Verification failed:', e.message);
}

// --- Step 4: Save config ---
const config = {
  contractAddress,
  owner: WALLET,
  chain: 'base',
  chainId: 8453,
  rpc: RPC,
  deployedAt: new Date().toISOString(),
  balancerVault: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
};
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
console.log(`\n💾 Step 4: Config saved to ${CONFIG_PATH}`);

// --- Step 5: Summary ---
console.log('\n' + '='.repeat(60));
console.log('✅ DEPLOYMENT COMPLETE');
console.log('='.repeat(60));
console.log(`Contract: ${contractAddress}`);
console.log(`Owner:    ${WALLET}`);
console.log(`Chain:    Base (8453)`);
console.log(`Config:   ${CONFIG_PATH}`);
console.log('\n🚀 Next steps:');
console.log(`  1. Test:  npm run trigger:arb -- --once --simulate --contract=${contractAddress}`);
console.log(`  2. Canary: npm run trigger:arb -- --once --contract=${contractAddress}`);
console.log('='.repeat(60));
