# Using Chrome DevTools Protocol

> **Think twice before using CDP directly for browser automation. You'll be better off with [Playwright](https://github.com/microsoft/playwright)**

> Not convinced? At least use [Puppeteer's CDPSession](https://github.com/aslushnikov/getting-started-with-cdp#using-puppeteers-cdpsession).

> See also [Contributing to Chrome DevTools Protocol](https://docs.google.com/document/d/1c-COD2kaK__5iMM5SEx-PzNA7HFmgttcYfOHHX0HaOM/edit#heading=h.e6mz7k1mw34a)


## Intro

> **NOTE**: An interactive protocol viewer is available at https://vanilla.aslushnikov.com.

The Chrome DevTools Protocol allows for tools to instrument, inspect, debug and profile Chromium, Chrome and other Blink-based browsers. Many existing projects currently use the protocol. The Chrome DevTools uses this protocol and the team maintains its API.

To run scripts locally, clone this repository and make sure to install
dependencies:

```bash
git clone https://github.com/aslushnikov/getting-started-with-cdp
cd getting-started-with-cdp
npm i
```

## Protocol Fundamentals

When Chromium is started with a `--remote-debugging-port=0` flag, it starts a Chrome DevTools Protocol server and prints its WebSocket URL to STDERR. The output looks something like this:

```bash
DevTools listening on ws://127.0.0.1:36775/devtools/browser/a292f96c-7332-4ce8-82a9-7411f3bd280a
```

Clients can create a WebSocket to connect to the URL and start sending CDP commands.  Chrome DevTools protocol is mostly based on [JSONRPC](https://www.jsonrpc.org/specification): each comand is a JavaScript struct with an `id`, a `method`, and an optional `params`.

The following example launches Chromium with a remote debugging port enabled and attaches to it via a WebSocket:

<!-- gen:insertjs(./wsclient.js) -->
File: [./wsclient.js](./wsclient.js)
```js
const WebSocket = require('ws');
const puppeteer = require('puppeteer');

(async () => {
  // Puppeteer launches browser with a --remote-debugging-port=0 flag,
  // parses Remote Debugging URL from Chromium's STDOUT and exposes
  // it as |browser.wsEndpoint()|.
  const browser = await puppeteer.launch();

  // Create a websocket to issue CDP commands.
  const ws = new WebSocket(browser.wsEndpoint(), {perMessageDeflate: false});
  await new Promise(resolve => ws.once('open', resolve));
  console.log('connected!');

  ws.on('message', msg => console.log(msg));

  console.log('Sending Target.setDiscoverTargets');
  ws.send(JSON.stringify({
    id: 1,
    method: 'Target.setDiscoverTargets',
    params: {
      discover: true
    },
  }));
})();
```
<!-- gen:stop -->

This script sends a [`Targets.setDiscoverTargets`](https://vanilla.aslushnikov.com/#Target.setDiscoverTargets) command over the DevTools protocol. The browser will first emit a [`Target.targetCreated`](https://vanilla.aslushnikov.com/#Target.targetCreated) event for every existing target and then respond to the command:

```bash
connected!
Sending Target.setDiscoverTargets
{"method":"Target.targetCreated","params":{"targetInfo":{"targetId":"38555cfe-5ef3-44a5-a4e9-024ee6ebde5f","type":"browser","title":"","url":"","attached":true}}}
{"method":"Target.targetCreated","params":{"targetInfo":{"targetId":"52CA0FEA80FB0B98BCDB759E535B21E4","type":"page","title":"","url":"about:blank","attached":false,"browserContextId":"339D5F1CCABEFE8545E15F3C2FA5F505"}}}
{"id":1,"result":{}}
```

A few things to notice:
1. [Line 19](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/wsclient.js#L19): Every command that is sent over to CDP must have a unique `'id'` parameter. Message responses will be delivered over websocket and will have the same `'id'`.
2. Incoming WebSocket messages without `'id'` parameter are protocol events.
3. Message order is important in CDP. In case of `Target.setDiscoverTargets`, it is (implicitly) guaranteed that all current targets will be reported before the response.
4. There's a top-level "browser" target that always exists.

Before advancing any further, consider a simple helper function to send DevTools protocol commands and wait for their responses:

<!-- gen:insertjs(./SEND.js) -->
File: [./SEND.js](./SEND.js)
```js
// Send a command over the WebSocket and return a promise
// that resolves with the command response.
module.exports = function SEND(ws, command) {
  ws.send(JSON.stringify(command));
  return new Promise(resolve => {
    ws.on('message', function(text) {
      const response = JSON.parse(text);
      if (response.id === command.id) {
        ws.removeListener('message', arguments.callee);
        resolve(response);
      }
    });
  });
}
```
<!-- gen:stop -->

> **NOTE**: this `SEND` implementation is very inefficient - don't use it as-is! Check out Puppeteer's [Connection.js](https://github.com/GoogleChrome/puppeteer/blob/master/lib/Connection.js) for a
> better version.

## Targets & Sessions

Chrome DevTools protocol has APIs to interact with many different parts of the browser - such as pages, serviceworkers and extensions. These parts are called *Targets* and can be fetched/tracked using [Target domain](https://vanilla.aslushnikov.com/#Target).

When client wants to interact with a target using CDP, it has to first attach to the target using [Target.attachToTarget](https://vanilla.aslushnikov.com/#Target.attachToTarget) command. The command will establish a *protocol session* to the given target and return a *sessionId*.

In order to submit a CDP command to the target, every message should also include a `sessionId` parameter next to the usual JSONRPC’s `'id'`.

The following example uses CDP to attach to a page and navigate it to a web site:

<!-- gen:insertjs(./sessions.js) -->
File: [./sessions.js](./sessions.js)
```js
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const SEND = require('./SEND');

(async () => {
  // Launch a headful browser so that we can see the page navigating.
  const browser = await puppeteer.launch({headless: false});

  // Create a websocket to issue CDP commands.
  const ws = new WebSocket(browser.wsEndpoint(), {perMessageDeflate: false});
  await new Promise(resolve => ws.once('open', resolve));

  // Get list of all targets and find a "page" target.
  const targetsResponse = await SEND(ws, {
    id: 1,
    method: 'Target.getTargets',
  });
  const pageTarget = targetsResponse.result.targetInfos.find(info => info.type === 'page');

  // Attach to the page target.
  const sessionId = (await SEND(ws, {
    id: 2,
    method: 'Target.attachToTarget',
    params: {
      targetId: pageTarget.targetId,
      flatten: true,
    },
  })).result.sessionId;

  // Navigate the page using the session.
  await SEND(ws, {
    sessionId,
    id: 1, // Note that IDs are independent between sessions.
    method: 'Page.navigate',
    params: {
      url: 'https://pptr.dev',
    },
  });
})();
```
<!-- gen:stop -->

Things to notice:
1. [Lines 22](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L22) and [33](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L33): clients must provide unique `'id'` for commands inside the session, but different sessions might use the same ids.
2. [Line 26](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L26): the `"flatten"` flag is the preffered mode of operation; the non-flattened mode will be removed eventually. Flattened mode allows us to pass `sessionId` as a part of the message (line 32).
3. [Line 32](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L32): include the `sessionId` of the page as a part of the message to send it to the page.

Some commands set state which is stored per session, e.g. `Runtime.enable` and `Targets.setDiscoverTargets`. Each session is initialized with a set of *domains*, the exact set depends on the attached target and can be [found somewhere in the Chromium source](https://cs.chromium.org/search/?q=%22session-%3EAddHandler%22+f:devtools&type=cs). For example, sessions connected to a browser don't have a "Page" domain, but sessions connected to pages do.

We call sessions attached to a Browser target *browser sessions*. Similarly, there are *page sessions*, *worker sessions* and so on. In fact, the WebSocket connection is an implicitly created browser session.

## Session Hierarchy

When a client connects over the WebSocket to the launched Chromium browser ([sessions.js:10]((https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L22))), a *root* browser session is created.
This session is the one that receives commands if there's no `sessionId` specified ([sessions.js:14](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L14-L17)). Later on, when the root browser session is used to attach to a page target ([sessions.js:21](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L21-L28)), a new page session created.

The page session is created from inside the browser session and thus is a **child** of the browser session. When a parent session closes, e.g. via [`Target.detachFromTarget`](https://vanilla.aslushnikov.com/#Target.detachFromTarget), all of its child sessions are closed as well.


## Stable vs Experimental methods

The Chrome DevTools Protocol has stable and experimental parts. Events, methods, and sometimes whole domains
might be marked as experimental. DevTools team doesn't commit to maintaining experimental APIs and changes/removes them regularly. 

**!!! USE EXPERIMENTAL APIS AT YOUR OWN RISK !!!**

As history has shown, experimental APIs *do* change quite often. If possible, stick to the stable protocol or use [Puppeteer](https://github.com/GoogleChrome/puppeteer).

> **NOTE**: The Chrome DevTools team maintains [Puppeteer](https://github.com/GoogleChrome/puppeteer) as a reliable high-level API to control a browser. Internally, Puppeteer *does* use experimental CDP methods, but the team makes sure to update the library as the underlying protocol changes.

[Vanilla protocol viewer](https://vanilla.aslushnikov.com/) aggressively highlights experimental bits with red background.

## Using Puppeteer's [CDPSession](https://pptr.dev/#?product=Puppeteer&version=v1.13.0&show=api-class-cdpsession)

It is very convenient to use Puppeteer to experiment with the raw protocol.
The following example creates a raw protocol session to the page to speed up animations.

<!-- gen:insertjs(./cdpsession.js) -->
File: [./cdpsession.js](./cdpsession.js)
```js
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
```
<!-- gen:stop -->

It's easy to monitor all CDP messages that Puppeteer exchanges with Chromium.

```bash
# Use DEBUG env variable to dump CDP traffic.
$ DEBUG=*protocol node simple.js
```

You can also monitor CDP messages from DevTools: [Chrome DevTools Protocol Monitor](https://umaar.com/dev-tips/166-protocol-monitor/).
