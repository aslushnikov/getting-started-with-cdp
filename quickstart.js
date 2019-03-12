const puppeteer = require('puppeteer');

(async() => {
  // Use Puppeteer to launch a browser and open a page.
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();

  // Create a raw DevTools protocol session to talk to the page.
  // Use CDP to set animation playback rate.
  const client = await page.target().createCDPSession();
  await client.send('Animation.enable');
  client.on('Animation.animationCreated', () => {
    console.log('Animation created!');
  });
  await client.send('Animation.setPlaybackRate', {
    playbackRate: 2,
  });
  // <...>

  // Close brower.
  await browser.close();
})();
