const puppeteer = require('puppeteer');

(async() => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  console.log(await page.evaluate('7 * 8'));
  await browser.close();
})();
