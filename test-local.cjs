const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto('http://localhost:8787', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Tap Base chain
  const base = await page.locator('[data-chain-id=\"base\"]').first();
  if (await base.isVisible().catch(()=>false)) {
    await base.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: '/tmp/k1-base.png' });

    // Count chips
    const chips = await page.locator('[data-protocol-id]').count();
    console.log('BASE_CHIPS:', chips);

    // Check all chip labels
    const labels = await page.locator('[data-protocol-id] text').allTextContents();
    console.log('CHIP_LABELS:', JSON.stringify(labels));

    // Short click first chip
    const chip = await page.locator('[data-protocol-id]').first();
    if (await chip.isVisible().catch(()=>false)) {
      const box = await chip.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
        await page.waitForTimeout(900);
        await page.screenshot({ path: '/tmp/k2-chip.png' });
      }
    }
  }

  // Switch to DeFi tab
  const defiBtn = await page.locator('button').filter({ hasText: /DeFi/i }).first();
  if (await defiBtn.isVisible().catch(()=>false)) {
    await defiBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/k3-defi.png' });
    console.log('DEFI_CLICKED:', true);
  }

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
