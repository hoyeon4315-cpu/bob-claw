const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('https://bob-claw-dashboard.pages.dev', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/dashboard-deployed.png' });

  const baseNode = await page.locator('[data-chain-id="base"]').first();
  if (await baseNode.isVisible().catch(() => false)) {
    await baseNode.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/dashboard-deployed-base.png' });

    const chip = await page.locator('[data-protocol-id]').first();
    if (await chip.isVisible().catch(() => false)) {
      const box = await chip.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, box.y + 40);
        await page.mouse.up();
        await page.waitForTimeout(500);
        await page.screenshot({ path: '/tmp/dashboard-deployed-drag.png' });
      }
    }
  }

  console.log('DEPLOYED_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
