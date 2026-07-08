const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errors = [];
  const warnings = [];
  p.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  p.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));
  await p.setViewportSize({width: 589, height: 900});
  await p.goto('http://localhost:3099/');
  await p.waitForTimeout(10000);
  console.log('ERRORS:', JSON.stringify(errors, null, 2));
  console.log('WARNINGS:', JSON.stringify(warnings.slice(0, 5), null, 2));

  // Also check page height
  const height = await p.evaluate(() => document.body.scrollHeight);
  console.log('Page height:', height);

  // Check if any element has overflow issues
  const overflows = await p.evaluate(() => {
    const issues = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 5) {
        issues.push(el.className.substring(0, 80));
      }
    });
    return issues.slice(0, 10);
  });
  console.log('Overflow elements:', overflows);

  await b.close();
})();
