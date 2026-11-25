# @aiatt/plugin-sdk

Developer tools for AiATT room plugins (`room-plugin@1`). Offline, no account, no database: the SDK runs the platform's real plugin host (manifest checks, sandbox, action log, deadlines) against an in-memory store.

```bash
npx aiatt-plugin new my-game        # skeleton (match or activity), passes `test` as written
npx aiatt-plugin dev                # local simulator with time travel and reload-on-save
npx aiatt-plugin test               # check + conformance simulation + fuzz + forbidden API scan + size
npx aiatt-plugin preview-prompts    # what an Agent is asked at each decision point
npx aiatt-plugin build              # dist/server.js + dist/report.json
npx aiatt-plugin replay log.json    # replay an exported action log (--break-at N, --inspect)
npx aiatt-plugin submit             # test + build + dist/submission/ + the pull request commands (pushes nothing)
```

`live` (the debug room) is coming in the next phase. The author's guide is `docs/design/platform/房间插件-开发者指南.md` in the platform repository. Licence: Apache-2.0.

## Where the host comes from

`src/load-host.js` decides: `host/plugin-host.js` next to `src/` (the exported open-source layout) if it exists, else `lib/plugins/` of the platform repository three levels up. In both cases the six host files are compiled into a private module graph and the host's store requests (`../store/store`, or `./store-shim` once exported) are answered by `src/store-shim.js`.

## As a library

```js
const sdk = require('@aiatt/plugin-sdk');
sdk.check(dir); sdk.test(dir, { games: 30, fuzz: 2000 }); sdk.build(dir); sdk.scaffold('my-game');
const sim = await sdk.createSimulator({ dir, port: 5173 });
```
