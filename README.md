# Using Chrome DevTools Protocol

## Intro

> **NOTE**: Interactive protocol viewers are available at:
> https://chromedevtools.github.io/devtools-protocol/ (official) and https://vanilla.aslushnikov.com (unofficial).


The Chrome DevTools Protocol allows for tools to instrument, inspect, debug and profile Chromium, Chrome and other Blink-based browsers. Many existing projects currently use the protocol. The Chrome DevTools uses this protocol and the team maintains its API.

To run scripts locally, clone this repository and make sure to install
dependencies:

```bash
git clone https://github.com/aslushnikov/getting-started-with-cdp
cd getting-started-with-cdp
npm i
```

## Protocol Fundamentals

When Chromium is started with a `--remote-debugging-port=0` flag, it starts a Chrome DevTools protocol server and prints its WebSocket URL to STDOUT. The output looks something like this:

```bash
DevTools listening on ws://127.0.0.1:36775/devtools/browser/a292f96c-7332-4ce8-82a9-7411f3bd280a
```

Clients can create a WebSocket to connect to the URL and start sending CDP commands.  Chrome DevTools protocol is an extension of [JSONRPC](https://www.jsonrpc.org/specification): each comand is a javascript struct with an `id`, a `method`, and an optional `params`.

The following example launches Chromium with a remote debugging port enabled and attaches to it via WebSocket:

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

This script sends a [`Targets.setDiscoverTargets`](https://vanilla.aslushnikov.com/#Target.setDiscoverTargets) command over the DevTools protocol. In response, CDP will emit a [`Target.targetCreated`](https://vanilla.aslushnikov.com/#Target.targetCreated) event for every existing target and then return an empty response for the command:

```bash
connected!
{"method":"Target.targetCreated","params":{"targetInfo":{"targetId":"38555cfe-5ef3-44a5-a4e9-024ee6ebde5f","type":"browser","title":"","url":"","attached":true}}}
{"method":"Target.targetCreated","params":{"targetInfo":{"targetId":"52CA0FEA80FB0B98BCDB759E535B21E4","type":"page","title":"","url":"about:blank","attached":false,"browserContextId":"339D5F1CCABEFE8545E15F3C2FA5F505"}}}
{"id":1,"result":{}}
```

A few things to notice:
1. [Line 18](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/wsclient.js#L18): Every command that is sent over to CDP must have a unique “id” parameter. Message responses will be delivered over websocket and will have the same “id”.
2. Incoming WebSocket messages without “id” parameter are protocol events.
3. CDP heavily relies on messages order. In case of `Target.setDiscoverTargets`, it is (implicitly) guaranteed that all current targets will be reported before the response.
4. There's a top-level "browser" target that always exists.

Before advancing any further, consider a simple helper function to send DevTools protocol commands and wait for their responses (SEND.js):

<!-- gen:insertjs(./SEND.js) -->
File: [./SEND.js](./SEND.js)
```js
// Send a command over WebSocket and return a promise
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

## Targets & Sessions

Chrome DevTools protocol has APIs to interact with many different parts of the browser - such as pages, serviceworkers and extensions. These parts are called Targets and can be fetched/tracked using [Target domain](https://vanilla.aslushnikov.com/#Target).

When client wants to interact with a target using CDP, it has to first attach to the target using [Target.attachToTarget](https://vanilla.aslushnikov.com/#Target.attachToTarget) command. The command will establish a *protocol session* to the given target and return a *sessionId*.

In order to submit a CDP command to the target, every message should also include the “sessionId” parameter next to the usual JSONRPC’s “id”.

The following example uses CDP to attach to a page and navigate it to a web site:

<!-- gen:insertjs(./sessions.js) -->
File: [./sessions.js](./sessions.js)
```js
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const SEND = require('./SEND');

(async () => {
  // Launch a headful browser so that we can see page navigating.
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

  // Attach to page target.
  const sessionId = (await SEND(ws, {
    id: 2,
    method: 'Target.attachToTarget',
    params: {
      targetId: pageTarget.targetId,
      flatten: true,
    },
  })).result.sessionId;

  // Navigate page using session.
  await SEND(ws, {
    sessionId,
    id: 1,
    method: 'Page.navigate',
    params: {
      url: 'https://pptr.dev',
    },
  });
})();
```
<!-- gen:stop -->

Things to notice:
1. [Lines 22](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L22) and [33](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L33): clients must provide unique “id” for commands inside the session, but different sessions might have clashing ids.
2. [Line 26](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L26): the `"flatten"` flag is a preffered mode of operation; non-flatten mode will be removed eventually. Flatten mode allows us to pass `sessionId` as a part of JSONRPC message (line 32).
3. [Line 32](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L32): include a sessionId as a part of JSONRPC message to send a message to the page.

Sessions hold client state - such as pending evaluations, reported execution contexts e.t.c. Each session is initialized with a set of *domains*, the exact set of which depends on the target the session is attached to and can be [found somewhere in the Chromium source](https://cs.chromium.org/search/?q=%22session-%3EAddHandler%22+f:devtools&type=cs). For example, sessions connected to a browser don't have a "Page" domain, but pages do.

We call sessions attached to a Browser target as *browser sessions*. Similarly, there are *page sessions*, *worker sessions* and so on.

## Session Hierarchy

When a client connects over the WebSocket to the launched Chromium browser ([sessions.js:10]((https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L22))), a *root* browser session is created.
This session is the one that receives commands if there's no `sessionId` specified ([sessions.js:14](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L14-L17)). Later on, when the root browser session is used to attach to a page target ([sessions.js:21](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L21-L28)), a new page session created.

> **NOTE**: page session is created from-inside browser session and thus is a **child** to browser session.

This can go on: the page session can be used to create a worker session. **The parent-child relationship arranges all protocol sessions into multiple *trees* - each tree has a root in some root browser session.** When a parent session closes, all its child sessions are closed too.

## Target Hierarchy & Session Auto-Attaching

As of March 2019, there's a hierarchy of targets in DevTools Protocol:
- browser session Target domain manages top-level targets: Pages, Browser, ServiceWorkers, SharedWorkers
- page session Target domain manages both Workers, ServiceWorkers and [OOPIFs](https://www.chromium.org/developers/design-documents/oop-iframes)

> **NOTE**: OOPIFs might have other OOPIFs inside, so the session tree depth is potentially unbound.

The only way to attach to sub-targets inside a page is by calling [`Target.setAutoAttach`](https://vanilla.aslushnikov.com/#Target.setAutoAttach). This will result in a sequence of [`Target.attachedToTarget`](https://vanilla.aslushnikov.com/#Target.attachedToTarget) events that report child `sessionId`s.

Auto-attaching to page's subtargets serves multiple purposes:
- That's the only way to discover DedicatedWorkers
- That's the only way to discover OOPIFs
- That's the only way to figure if SW relates to a page

> **NOTE**: There are plans to flatten targets, exposing Workers and OOPIFs on browser session target domain and introducing a designated api to describe ServiceWorker<->Page relationship.

## Using Puppeteer's [CDPSession](https://pptr.dev/#?product=Puppeteer&version=v1.13.0&show=api-class-cdpsession)

CDP allows creating multiple sessions to the same target. This makes it very convenient to use Puppeteer
to experiment with a raw protocol.

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
  // Use CDP to set animation playback rate.
  const client = await page.target().createCDPSession();
  await client.send('Animation.enable');
  client.on('Animation.animationCreated', () => {
    console.log('Animation created!');
  });
  await client.send('Animation.setPlaybackRate', {
    playbackRate: 2,
  });

  // Check out fast animations on the "loading..." screen.
  await page.goto('https://pptr.dev');
})();
```
<!-- gen:stop -->

It's easy to monitor all messages that Puppeteer exchanges with Chromium over CDP.
Prefixing Puppeteer script with "DEBUG=*protocol" will output traffic to STDOUT:

```bash
# Use DEBUG env variable to dump CDP traffic.
$ DEBUG=*protocol node simple.js
```