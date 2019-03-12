## Target Hierarchy & Session Auto-Attaching

As of March 2019, DevTools Protocol arranges targets in a hierarchy:
- The Browser session's Target domain manages the top-level targets: Pages, Browser, ServiceWorkers, SharedWorkers and [OOPIFs](https://www.chromium.org/developers/design-documents/oop-iframes).
- The Page/OOPIFs session's Target domain manages the subtargets: Workers, ServiceWorkers and OOPIFs.
- The Worker session's Target domain manages the nested Workers.

Currently the only way to attach to the sub-targets of a page is by calling [`Target.setAutoAttach`](https://vanilla.aslushnikov.com/#Target.setAutoAttach). This will result in a sequence of [`Target.attachedToTarget`](https://vanilla.aslushnikov.com/#Target.attachedToTarget) events that report child `sessionId`s.

Auto-attaching to the Page's subtargets serves multiple purposes:
- That's the only way to discover DedicatedWorkers
- That's the only way to figure out if a ServiceWorker/OOPIF relates to the Page

