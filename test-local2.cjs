const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto('http://localhost:8787', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Tap Base chain
  const base = await page.locator('[data-chain-id=\"base\"]').first();
  await base.click();
  await page.waitForTimeout(1200);

  // Get all chip bounding boxes and check if they're in viewport
  const chipData = await page.locator('[data-protocol-id]').evaluateAll(els => {
    return els.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-protocol-id'),
        x: rect.x, y: rect.y, w: rect.width, h: rect.height,
        inViewport: rect.x >= 0 && rect.y >= 0 && rect.right <= 390 && rect.bottom <= 844
      };
    });
  });
  console.log('CHIPS:', JSON.stringify(chipData, null, 2));

  // Check if any chips overlap
  for (let i = 0; i < chipData.length; i++) {
    for (let j = i + 1; j < chipData.length; j++) {
      const a = chipData[i];
      const b = chipData[j];
      const overlap = !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
      if (overlap) console.log('OVERLAP:', a.id, b.id);
    }
  }

  await browser.close();
})();
