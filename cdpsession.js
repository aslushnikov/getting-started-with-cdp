const puppeteer = require('puppeteer');

(async() => {
  // Use Puppeteer to launch a browser and open a page.
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();

  // Create a raw DevTools protocol session to talk to the page.
  // Use CDP to set the animation playback rate.
  const session = await page.target().createCDPSession();
  await session.send('Animation.enable');
  session.on('Animation.animationCreated', () => {
    console.log('Animation created!');
  });
  await session.send('Animation.setPlaybackRate', {
    playbackRate: 2,
  });

  // Check it out! Fast animations on the "loading..." screen!
  await page.goto('https://pptr.dev');
})();
