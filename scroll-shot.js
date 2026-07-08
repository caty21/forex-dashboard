const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setViewportSize({width: 589, height: 900});
  await p.goto('http://localhost:3099/');
  await p.waitForTimeout(9000);
  await p.evaluate(() => window.scrollTo(0, 2200));
  await p.waitForTimeout(400);
  await p.screenshot({path: 'C:/Users/capug/AppData/Local/Temp/scroll2200.png'});
  await p.evaluate(() => window.scrollTo(0, 4200));
  await p.waitForTimeout(400);
  await p.screenshot({path: 'C:/Users/capug/AppData/Local/Temp/scroll4200.png'});
  await p.evaluate(() => window.scrollTo(0, 6500));
  await p.waitForTimeout(400);
  await p.screenshot({path: 'C:/Users/capug/AppData/Local/Temp/scroll6500.png'});
  await b.close();
  console.log('done');
})();
