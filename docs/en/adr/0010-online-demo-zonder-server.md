# The online demo runs without a server

_Nederlands: [0010-online-demo-zonder-server.md](../../adr/0010-online-demo-zonder-server.md)_

The demo at [box3balans.nl/demo](https://box3balans.nl/demo/) runs without a server. At every release (and on 1 January) a workflow starts the normal demo, asks it everything the pages ask, in Dutch and in English, and puts those answers next to a separate build of the web app (`vite build --mode online-demo`) in the `demo/` folder on the `gh-pages` branch. In the browser, `web/src/staticDemo.ts` answers the app's requests from that recording; the transactions and the history are filtered there the way the server does. Saving isn't possible: the app then says it can't be done in the online demo. Only the language switches, by picking the other recording.

That way it's real output from the real code, with no server to maintain, no costs and nobody's data. The landing page stays as it is ([ADR 0008](0008-landingspagina-op-gh-pages.md)): the workflow only writes in `demo/`, and the build happens in a separate job without write permissions.

## Considered

- **The real demo on a free host** (Fly.io, Render, Hugging Face Spaces): everything works, but all visitors share one household (whoever renames an account does so for everyone), free plans go to sleep, and it needs an account with a host. A separate copy per visitor is work on the server.
- **The whole app in the browser**, with PGlite: the database can run there, Fastify and `node:crypto` can't without a lot of emulation, and it becomes a download of several MB.
- **Screenshots only**: already in the README, but you can't click through them.

What's not in it: requests with freely typed input (searching for an asset, your own assumptions in the 2028 preview) and everything that saves or imports something.
