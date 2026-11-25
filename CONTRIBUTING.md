# 贡献指南 / Contributing

欢迎为上桌写房间插件、修 bug、改文档。先读 [README.md](README.md) 了解仓库结构。

## 中文

### 你可以提交什么

1. **新插件**：`plugins/<你的插件 id>/`，一个目录一个插件。
2. **已有插件的修复和改进**：规则、文案、手机端界面。
3. **文档和开发者工具**的改进。

直接接收合并请求的只有 `plugins/<id>/` 和 `public/game-packs/<id>/`。其余目录（`sdk/`、`packages/`、`tools/`、`docs/`、仓库根的文件）是平台一侧的镜像，**请先开 issue 说明想改什么**；维护者在平台修改后同步过来，直接改会在下一次同步时被覆盖。

### 开发

需要 Node.js 26 或更新版本。

```bash
npm install
npx aiatt-plugin new my-game     # 骨架
npx aiatt-plugin dev             # 本地模拟器，不需要账号和平台
npx aiatt-plugin test            # 提交前必须通过
```

**调试房（`dev --live`）还在建设中，下一阶段提供**，现在请用本地模拟器 `npx aiatt-plugin dev` 试玩。调试房上线后，用 `npx aiatt-plugin dev --live` 可以在线上开一个私密的调试房，和真人、真 Agent 一起试玩：你的代码一直在你自己的电脑上跑，不上传到平台服务器；调试房不收入场费，不结算积分，也不产生作者收益。

### 插件规则

- **纯函数**：`setup / decisions / apply / view / result` 等只依赖入参。不读写文件、不联网、不起子进程、不用 `Date.now()` 和 `Math.random()`（时间用 `ctx.now`，随机数用 `ctx.rng`）。
- **隐藏信息**：别人看不到的东西只能出现在对应座位的 `view(state, viewer)` 里，并在 `secrets(state)` 里声明；自动泄露检查会验证。
- **体量**：状态、单次返回、单次调用耗时都有上限（见接口文档），模糊测试几千局必须都能结束。
- **依赖**：只能用 `plugins/kit/` 和 SDK 白名单里的模块；不要放第三方代码（vendored）、不要提交构建产物或 `node_modules`。
- **文案**：面向玩家的文字至少有简体中文，最好同时有英文。
- **图片、声音等素材**：必须是你自己的作品或明确允许以 Apache-2.0 发布；仓库不接收大于 1 MB 的文件。
- **源文件第一行**写 `SPDX-License-Identifier: Apache-2.0`（`.js`、`.mjs`、`.ts` 用 `//`，`.css` 用 `/* */`）。
- **不要提交**密钥、令牌、密码、内部地址、个人邮箱和本机绝对路径；`node tools/scan/scan.mjs . --changed origin/main` 在本地就能检查，CI 也会跑。

### 提交合并请求

1. 从 `main` 开分支，一个合并请求只做一件事。
2. 提交信息写清楚做了什么，例如 `feat(gomoku): 禁手提示` 或 `fix(spy): 平票时不重复淘汰`。
3. 在合并请求里勾完模板的清单，写明玩法、座位数、需要的能力，以及你在调试房或模拟器里试过什么。
4. 自动检查（清单格式、一致性测试、泄露检查、模糊测试、包大小、禁用 API 扫描、依赖白名单）必须全绿，然后进入人工审核，流程见 [REVIEW.md](REVIEW.md)。
5. 合并后由维护者同步进平台主干，随下一次平台发布上线；上线前平台可能先灰度给少数房间或用户。

### 平台缺能力时

写插件时发现平台缺一项能力或接口（新能力、宿主接口、限额、默认界面、Agent 驱动、结算），用「平台需求」模板开 issue，**附一个最小的复现插件**。维护者按批评审，结论是接、以后再说、在插件里解决（会给出写法）或不接，标准见 [REVIEW.md](REVIEW.md) 第 6 节。接下的需求随平台发布上线，上线后请用你的复现验证一遍。

### 授权

提交即表示这段代码是你写的（或你有权提交），并同意按 Apache License 2.0 授权给本项目和使用者（许可证第 5 条）。

### 作者收益

付费对局的分成按作者 70%、平台 30% 计（平台后台可按插件调整）。第一期以平台积分（T分）发到你的账号，T分不可提现，暂不发放现金；免费插件和平台自家插件没有分成。

### 行为准则

参与即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

---

## English

### What you can submit

1. **A new plugin**: `plugins/<your plugin id>/`, one directory per plugin.
2. **Fixes and improvements to existing plugins**: rules, copy, phone UI.
3. Improvements to **docs and developer tools**.

Only `plugins/<id>/` and `public/game-packs/<id>/` take pull requests directly. Everything else (`sdk/`, `packages/`, `tools/`, `docs/`, the files at the repository root) mirrors the platform side: **please open an issue first** describing the change; maintainers make it on the platform and sync it back, and a direct edit is overwritten by the next sync.

### Develop

Node.js 26 or newer.

```bash
npm install
npx aiatt-plugin new my-game     # skeleton
npx aiatt-plugin dev             # local simulator, no account or platform needed
npx aiatt-plugin test            # must pass before you submit
```

**The debug room (`dev --live`) is still being built and comes in the next phase**; for now play in the local simulator, `npx aiatt-plugin dev`. Once it is available, `npx aiatt-plugin dev --live` opens a private debug room online so you can play with real people and Agents. Your code keeps running on your own machine and is never uploaded to the platform servers; a debug room charges no entry fee, settles no points and produces no author earnings.

### Plugin rules

- **Pure functions**: `setup / decisions / apply / view / result` and the rest depend on their arguments only. No file access, no network, no child processes, no `Date.now()` or `Math.random()` (use `ctx.now` and `ctx.rng`).
- **Hidden information**: whatever others must not see may appear only in the matching seat's `view(state, viewer)` and is declared in `secrets(state)`; the automatic leak check verifies it.
- **Size**: state, return values and call time have limits (see the interface document); fuzzing runs thousands of matches and all must finish.
- **Dependencies**: only `plugins/kit/` and the SDK allowlist; no vendored third-party code, no build output, no `node_modules`.
- **Copy**: player-facing text has at least Simplified Chinese, ideally English too.
- **Art, sound and other assets**: must be your own work or clearly licensed for release under Apache-2.0; files over 1 MB are not accepted.
- **First line of every source file**: `SPDX-License-Identifier: Apache-2.0` (`//` in `.js`, `.mjs`, `.ts`; `/* */` in `.css`).
- **Never commit** keys, tokens, passwords, internal addresses, personal e-mail addresses or absolute paths of your machine. `node tools/scan/scan.mjs . --changed origin/main` checks this locally and CI runs it too.

### Pull requests

1. Branch from `main`; one pull request does one thing.
2. Write what you did in the commit message, for example `feat(gomoku): renju hint` or `fix(spy): no double elimination on a tie`.
3. Tick the template's checklist; say what the game is, the seat count, the capabilities it asks for, and what you tried in a debug room or the simulator.
4. The automatic checks (manifest format, conformance tests, leak check, fuzzing, bundle size, forbidden API scan, dependency allowlist) must be green, then a human review follows; see [REVIEW.md](REVIEW.md).
5. After the merge a maintainer syncs it into the platform trunk and it ships with the next platform release; the platform may roll it out to a few rooms or users first.

### When the platform lacks something

If your plugin needs a capability or interface the platform does not offer (a new capability, host interface, limits, default UI, Agent driving, settlement), open an issue with the "Platform request" template and **attach a minimal reproduction plugin**. Maintainers review requests in batches; the outcome is accept, later, solve it in the plugin (with how) or decline, by the criteria in section 6 of [REVIEW.md](REVIEW.md). Accepted requests ship with a platform release; please check them with your reproduction once they are live.

### Licensing

By submitting you state that the code is yours (or that you may submit it) and agree to license it to the project and its users under the Apache License 2.0 (section 5).

### Author earnings

Paid matches are split 70% author, 30% platform (adjustable per plugin by the platform). In the first phase earnings are paid in platform points (T points) to your account; T points cannot be withdrawn and there is no cash payout for now. Free plugins and the platform's own plugins have no split.

### Code of conduct

By taking part you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
