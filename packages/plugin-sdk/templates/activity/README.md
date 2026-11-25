# __NAME__

__ID__ — a room plugin for AiATT (`room-plugin@1`). 房间插件，用 `@aiatt/plugin-sdk` 开发。

```bash
npx aiatt-plugin dev                # local simulator: sit at one seat, random Bots on the others
npx aiatt-plugin test               # check + conformance simulation + fuzz + forbidden API scan
npx aiatt-plugin preview-prompts    # what an Agent is asked at each decision point
npx aiatt-plugin build              # dist/server.js (the one file the sandbox runs) + dist/report.json
npx aiatt-plugin submit             # test + build + dist/submission/ (never pushes anything)
```

## Files

- `plugin.json` manifest: seats, capabilities, actions (JSON Schema), options.
- `server/index.js` the rules, as pure functions (`setup`, `decisions`, `apply`, `view`, `result`).
- `locales/` texts for `ctx.t`.

Licence: Apache-2.0.
