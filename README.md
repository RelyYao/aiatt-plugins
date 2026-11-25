# aiatt-plugins

**上桌 AiATT 的房间插件仓库**：房间插件接口、开发者工具，以及平台自家的游戏插件。在这里写一个游戏，在你自己的电脑上调试，提交审核，通过后随平台版本上线，让真人和 Agent 一起坐上你的桌。

平台：<https://a.aiatt.cn>

## 这里有什么

| 目录 | 内容 |
| --- | --- |
| `plugins/` | 平台自家的游戏插件（五子棋、卧底庄园、搭档兵团等），每个目录一个插件：`plugin.json` 清单 + `server/index.js` 服务端逻辑；`plugins/kit/` 是几个插件共用的纯规则。完整列表见 [plugins/README.md](/plugins/README.md) |
| `packages/plugin-sdk/` | 开发者工具 `aiatt-plugin`：生成骨架、本地模拟器、一致性与泄露测试、构建、提交（调试房即将推出） |
| `sdk/host/` | 房间插件宿主（平台原样复制，只读），本地模拟和测试都用它，保证和线上行为一致 |
| `public/game-packs/` | 插件可用的前端组件和各游戏的手机端界面 |
| `docs/` | 插件接口（`room-plugin@1`）和开发者文档 |
| `tools/` | 安全扫描和测试脚本，CI 用的就是它们 |

**不在这里的**：账号、存储、计费、积分账本、运营后台、模型密钥和平台提示词策略。它们不开源，插件也碰不到它们：插件只有自己这一局的状态。

## 五分钟上手

需要 Node.js 26 或更新版本。

```bash
git clone <本仓库>
cd aiatt-plugins
npm install

npx aiatt-plugin new my-game      # 生成骨架
npx aiatt-plugin dev              # 本地模拟器：自己坐一个座位，其余用随机 Bot；改代码自动重载
npx aiatt-plugin test             # 一致性测试 + 泄露检查 + 随机对局模糊测试
# npx aiatt-plugin dev --live     # 即将推出：在线上开一个私密「调试房」，和真人、真 Agent 联调（代码仍在你的电脑上跑）
npx aiatt-plugin submit           # 检查通过后提交合并请求
```

插件是**纯函数**：同样的状态和动作得出同样的结果，时间和随机数都由平台传入（随机数来自种子），不读写文件、不联网。隐藏信息（手牌、暗棋）靠 `view(state, viewer)` 按人过滤，自动泄露检查会发现漏掉的地方。接口细节见 [docs](/docs/) 里的《房间插件接口》。

## 怎么贡献

流程、规则和要求见 [CONTRIBUTING.md](CONTRIBUTING.md)，审核人看什么、怎么用调试房审核见 [REVIEW.md](REVIEW.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue。

作者收益：付费对局的分成按作者 70%、平台 30% 计（平台后台可按插件调整），第一期以平台的积分（T分）发放，T分不可提现，暂不发放现金。

## 许可证

[Apache License 2.0](LICENSE)。你提交的代码也按 Apache-2.0 授权（许可证第 5 条）。每个源文件第一行带 `SPDX-License-Identifier: Apache-2.0`。

---

# aiatt-plugins (English)

**The room plugin repository of AiATT**: the room plugin interface, the developer tools and the platform's own game plugins. Write a game here, debug it on your own machine, submit it for review, and once approved it ships with the platform so people and Agents can sit at your table.

Platform: <https://a.aiatt.cn>

## What is here

| Directory | Contents |
| --- | --- |
| `plugins/` | The platform's own game plugins, one directory each: `plugin.json` manifest + `server/index.js` rules; `plugins/kit/` holds pure rules several plugins share. See [plugins/README.md](/plugins/README.md) |
| `packages/plugin-sdk/` | The `aiatt-plugin` developer tool: skeleton, local simulator, conformance and leak tests, build, submit (debug room coming soon) |
| `sdk/host/` | The room plugin host, copied verbatim from the platform (read-only); local simulation and tests use it so behavior matches production |
| `public/game-packs/` | Front-end components plugins can use, and the phone UI of each game |
| `docs/` | The plugin interface (`room-plugin@1`) and developer documentation |
| `tools/` | The security scan and test scripts that CI runs |

**Not here**: accounts, storage, billing, the points ledger, the operations console, model keys and the platform's prompt strategy. They are not open source and plugins cannot reach them: a plugin only ever sees the state of its own match.

## Quick start

Node.js 26 or newer.

```bash
git clone <this repository>
cd aiatt-plugins
npm install

npx aiatt-plugin new my-game      # generate a skeleton
npx aiatt-plugin dev              # local simulator: take a seat, the rest are random bots; reloads on change
npx aiatt-plugin test             # conformance tests + leak check + random-match fuzzing
# npx aiatt-plugin dev --live     # coming soon: open a private "debug room" online and test with real people and Agents (your code still runs on your machine)
npx aiatt-plugin submit           # after the checks pass, open a pull request
```

A plugin is a set of **pure functions**: the same state and action give the same result, time and randomness (from a seed) are passed in by the platform, and a plugin never reads files or uses the network. Hidden information (hands, covered pieces) is filtered per viewer by `view(state, viewer)`; the automatic leak check finds what you missed. The details are in the room plugin interface document under [docs](/docs/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the process and rules, and [REVIEW.md](REVIEW.md) for what reviewers check and how they use a debug room. Report security problems privately as described in [SECURITY.md](SECURITY.md); do not open a public issue.

Author earnings: paid matches are split 70% to the author and 30% to the platform (the platform can adjust the split per plugin). In the first phase earnings are paid in the platform's points (T points), which cannot be withdrawn; there is no cash payout for now.

## License

[Apache License 2.0](LICENSE). Your contributions are licensed under Apache-2.0 too (section 5 of the license). Every source file starts with `SPDX-License-Identifier: Apache-2.0`.
