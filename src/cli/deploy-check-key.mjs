#!/usr/bin/env node
/**
 * Validates private key format before deploying.
 * Usage: node src/cli/deploy-check-key.mjs 0xYOUR_KEY_HERE
 */
import { execSync } from 'child_process';

const pk = process.argv[2];

if (!pk) {
  console.log('❌ 프라이빗 키를 입력하세요\n');
  console.log('사용법:');
  console.log('  node src/cli/deploy-check-key.mjs 0x프라이빗키\n');
  console.log('MetaMask에서 키 내보내기:');
  console.log('  1. MetaMask 열기');
  console.log('  2. 점 세 개(⋮) → 계정 세부정보');
  console.log('  3. "비공개 키 표시" 클릭');
  console.log('  4. 비밀번호 입력');
  console.log('  5. 나온 키 복사 (0x로 시작하는 66자)');
  process.exit(1);
}

// Validate format
console.log('🔍 키 형식 검증...');
console.log(`   길이: ${pk.length}자 (필요: 66자)`);
console.log(`   0x 접두사: ${pk.startsWith('0x') ? '✅' : '❌'}`);

if (!pk.startsWith('0x')) {
  console.log('\n⚠️  0x 접두사가 없습니다. 추가합니다...');
  const fixedPk = '0x' + pk;
  console.log(`   수정: ${fixedPk.slice(0,6)}...${fixedPk.slice(-4)} (${fixedPk.length}자)`);
  if (fixedPk.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(fixedPk)) {
    console.log('   ✅ 수정된 키 유효!');
    console.log('\n다시 실행:');
    console.log(`   node src/cli/deploy-check-key.mjs ${fixedPk}`);
    process.exit(0);
  }
}

if (pk.length !== 66) {
  console.log(`\n❌ 키 길이 오류: ${pk.length}자 ≠ 66자`);
  if (pk.length === 64) {
    console.log('   → 0x 접두사 누락. 다시 시도:');
    console.log(`   node src/cli/deploy-check-key.mjs 0x${pk}`);
  }
  process.exit(1);
}

if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.log('\n❌ 16진수가 아닌 문자 포함');
  const badChars = pk.slice(2).split('').filter(c => !/[0-9a-fA-F]/.test(c));
  console.log('   잘못된 문자:', [...new Set(badChars)].join(', '));
  process.exit(1);
}

console.log('   ✅ 형식 유효!\n');

// Derive address from key
console.log('🔑 주소 확인...');
try {
  const addr = execSync(
    `${process.env.HOME}/.foundry/bin/cast wallet address --private-key ${pk} 2>&1`
  ).toString().trim();
  console.log(`   지갑 주소: ${addr}`);
  
  const expected = '0x96262be63aa687563789225c2fe898c27a3b0ae4';
  if (addr.toLowerCase() === expected.toLowerCase()) {
    console.log('   ✅ 올바른 지갑!');
  } else {
    console.log(`   ⚠️  예상 지갑(${expected})과 다릅니다`);
    console.log('   다른 지갑의 키일 수 있습니다. 계속 진행하시겠습니까?');
  }
} catch (e) {
  console.log('   ❌ cast wallet address 실패:', e.message);
  process.exit(1);
}

// Deploy
console.log('\n🚀 배포 시작...');
try {
  const result = execSync(
    `${process.env.HOME}/.foundry/bin/forge create src/contracts/BalancerFlashArb.sol:BalancerFlashArb ` +
    `--rpc-url https://mainnet.base.org ` +
    `--private-key ${pk} ` +
    `--constructor-args 0x96262be63aa687563789225c2fe898c27a3b0ae4`,
    { cwd: process.cwd(), timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
  ).toString();
  
  console.log(result);
  
  const match = result.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/);
  if (match) {
    const addr = match[1];
    const { writeFileSync } = await import('fs');
    writeFileSync('data/deployed-contract.json', JSON.stringify({
      contractAddress: addr,
      owner: '0x96262be63aa687563789225c2fe898c27a3b0ae4',
      chain: 'base', chainId: 8453,
      rpc: 'https://mainnet.base.org',
      deployedAt: new Date().toISOString(),
      balancerVault: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
    }, null, 2));
    console.log('\n✅ 배포 성공! 주소:', addr);
    console.log('   설정 저장: data/deployed-contract.json');
    console.log('\n🧪 테스트: npm run trigger:arb -- --once --simulate');
  }
} catch (e) {
  const err = e.stderr?.toString() || e.message;
  console.log('❌ 배포 실패:\n' + err);
  if (err.includes('Failed to decode private key')) {
    console.log('\n💡 키 형식 문제입니다. MetaMask에서 다시 복사해보세요.');
  }
}
