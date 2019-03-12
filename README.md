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
[./wsclient.js](./wsclient.js)
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

Before advancing any further, consider a simple helper function to send DevTools protocol commands and wait for their responses (SEND.js):

<!-- gen:insertjs(./SEND.js) -->
[./SEND.js](./SEND.js)
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
[./sessions.js](./sessions.js)
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
2. [Line 26](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L26): the “flatten” flag is a CDP’s future and should be passed so that we can pass sessionId as a part of JSONRPC message (line 32).
3. [Line 32](https://github.com/aslushnikov/getting-started-with-cdp/blob/master/sessions.js#L32): include a sessionId as a part of JSONRPC message to send a message to the page.

