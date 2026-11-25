# 房间插件接口 room-plugin@1（2026-11-24，P0 定稿）

整体设计和迁移计划见 `docs/design/platform/房间插件化底层设计-2026-11-24.md`。本文是**插件作者要照着写的接口**，以代码为准：宿主 `lib/plugins/plugin-host.js`，清单校验 `lib/plugins/plugin-manifest.js`，Schema 子集 `lib/plugins/plugin-schema.js`，沙箱 `lib/plugins/plugin-sandbox.js`。可运行的例子：`test/plugins/fixtures/`（井字棋、暗数字），测试 `test/plugins/plugin-host.test.js`。

## 1. 一个插件是什么

```
<插件 id>/
  plugin.json          清单（第 2 节）
  server/index.js      服务端逻辑，全部是纯函数（第 3 节）；可以 require 插件目录里的其他文件
  locales/<语言>.json   ctx.t 用的文案（zh-CN / zh-TW / en，可选）
```

`server/` 可以分成多个文件：平台加载时把 `server/index.js` 和它用字面相对路径 `require` 的插件内文件打包成一个文件再放进沙箱（`lib/plugins/plugin-bundle.js`）。引用插件目录以外的东西（平台模块、Node 模块、`..` 越界、拼出来的名字）一律拒绝。

**插件工具箱**：几个插件共用的纯规则放在 `plugins/kit/`（例如谜题交易所和无尽回廊都用的谜题模板），插件里写 `require('@aiatt/plugin-kit/<名字>')`，打包时一起打进去；工具箱文件守同样的沙箱规则，只能引用工具箱里的其它文件。清单见 `plugins/kit/README.md`。

样板：`plugins/gomoku/`（五子棋，带引擎座位）、`plugins/spy/`（卧底庄园，隐藏信息、多阶段、截止时间、房主开票）。

前端（`client/`）、Agent 提示模板（`agent/`）、资源在 P1/P2 接入时补进本文；P0 只定服务端。

## 2. 清单 plugin.json

| 字段 | 要求 |
|---|---|
| `id` | 2–40 位小写字母、数字、连字符，字母开头 |
| `version` | `主.次.修订` |
| `api` | 固定 `"room-plugin@1"` |
| `category` | `match`（对局：开局 → 回合 → 结果）或 `activity`（活动：房间存在期间一直运行） |
| `name` | 至少 `en`；可有 `zh-CN`、`zh-TW`；每个不超过 40 字 |
| `author`、`license` | 必填 |
| `seats` | `{min, max, teams, people?}`：对局 `min ≥ 1`，活动可以 0；`max ≤ 32`；`teams` 为 `solo` / `teams` / `free`。一个座位是一队（一个人和他的 Agent、一方）时，`people: {min, max}` 写桌上的人数（选游戏的地方显示它），默认等于座位数 |
| `capabilities` | 只能从这些里选：`rng` `turns` `deadlines` `teams` `hidden` `spectators` `aiSeats` `scoring` `highlights` `commitReveal` `messages` `timers` `panels` `voice`。宿主只按声明的能力办事（例如声明了 `turns` 才检查轮次，声明了 `deadlines` 才计时） |
| `timing` | `{turnSeconds: 5–3600（默认 60）, timed}` |
| `ai` | `{mode: engine | model | none, price: 0–10000 的整数}`；不是 `none` 时必须声明 `aiSeats` |
| `config` | 开房选项，JSON Schema，`type` 必须是 `object`；`default` 会自动填上 |
| `actions` | `{动作名: JSON Schema}`，每个 `type` 必须是 `object`，不能自己声明 `type` 属性（平台用动作名填） |
| `hostActions` | 可选，`actions` 里的动作名列表：房主随时可以做的动作（例如卧底的提前开票）。谁是房主由平台判断（房主本人；快速匹配桌上任何真人成员），房主不一定有座位 |
| `limits` | `stateBytes`（默认 64 KB，最多 1 MB）、`eventsPerAction`（默认 20，最多 200）、`callMs`（每次调用的时间上限，默认 200 ms，最多 500 ms：墙钟时间，要留出进程繁忙、垃圾回收的余量）、`engineMs`（`engine()` 一次的上限，默认同 `callMs`，最多 2000 ms：平台引擎座位的搜索） |

**Schema 只支持这些关键字**：`type` `enum` `const` `minimum` `maximum` `minLength` `maxLength` `pattern` `items` `minItems` `maxItems` `properties` `required` `additionalProperties` `default` `title` `description`。用了别的关键字，清单校验直接不通过（不会被悄悄忽略）。

## 3. 服务端：纯函数

```js
module.exports = definePlugin({
  setup(ctx) { return 初始状态; },                         // 对局类必有；ctx 有 seats、config、rng、now、t、commit、verify
  decisions(state, ctx) { return [{ actor, actions: ['place'], deadlineSeconds }]; },   // 必有
  apply(state, action, ctx) { return { state, events } | { error, message }; },        // 必有；ctx.actor 是谁
  timeout(state, decision, ctx) { return 动作; },          // 可选：截止时间到了，替这个座位走哪一步
  leave(state, seat, ctx) { return { state, events }; },  // 可选：一个座位彻底离开（背后的人都退出了房间），对局怎么办
  engine(state, decision, ctx) { return 动作 | null; },   // 可选：平台自己走的座位（`kind: bot` 或 `engine: true`：内置 Bot、陪练方）怎么走，和 ai.mode（Agent 座位怎么走、怎么计价）无关；null 表示这个决策点不动
  secrets(state) { return [{ value, visibleTo: [座位] }]; }, // 可选：哪些值只有哪些座位能看（一致性检查的泄露检查用）
  view(state, viewer) { return 这个人能看到的; },          // 必有；viewer 为 null 是观战
  result(state) { return { done: false } | { done: true, ranking: [[第一名…], [第二名…]], summary, highlights }; },  // 必有
  migrate(state, fromVersion) { return state; },          // 可选（P1 起用于沿用状态）
});
```

- **状态和动作都是 JSON。**参数以 JSON 文本传进去、返回值以 JSON 文本传出来，插件拿到的永远是副本，改它不会影响平台。
- **不能用**：`require`、`process`、计时器、`Date`、`Math.random`、`eval` / `new Function`、异步函数。随机数用 `ctx.rng()`（`rng.int(lo, hi)`、`rng.pick(list)`、`rng.shuffle(list)`），时间用 `ctx.now`。每一步的随机数种子由平台按「对局种子 + 步数」给出，所以任何一局都能**重放**到完全相同的状态。
- **承诺-揭示**：`ctx.commit(value)` 返回 `{hash, salt}`（已有公开承诺格式的游戏可以用 `ctx.sha256(text)` 自己拼）；插件把值和盐留在自己的状态里（在 `view` 里对别人隐藏），公开 `hash`；揭示后任何人都能用 `ctx.verify(value, salt, hash)` 核对。
- **出错**：`apply` 返回 `{error: 'CELL_TAKEN', message}` 表示这一步不合法，平台回复 409，状态不变；输入本身不合格（坐标越界、格式不对）时加 `status: 400`，不是这个座位能做的事加 `status: 403`。抛异常、超时、返回格式不对、状态超过 `stateBytes`、事件太多太大，平台都会拒绝这一步，状态同样不变。
- `decisions` 里的 `actor` 必须是座位 id，`actions` 必须是清单里的动作，第一个是主要动作。可以给 `key`（例如「第几轮第几个」）：同一个人、同一组动作、同一个 `key` 在下一步还在时，截止时间沿用；`key` 变了就重新计时（同一编队下一轮再轮到时不会沿用旧的截止时间）。自己在状态里记时间的插件（卧底的 `turnEndsAt`）直接给 `deadlineAt`（毫秒时间戳），规则和宿主的截止时间就是同一个，中途接管的对局也不会重新计时；`deadlineAt: null` 表示这个决策点不计时（例如对手思考时随时可以认输）。
- 座位：`{ id, kind: human | agent | bot, name, team?, owner?, engine? }`。`kind: bot` 或 `engine: true` 的座位由平台引擎走（`engine()`）。`owner` 只是标记，房主权限用 `hostActions`。
- **房主动作**：平台用 `act(room, 谁, 动作, { host: true })` 担保这个人是房主；动作在 `hostActions` 里时，宿主不查座位和决策点，插件在 `ctx.host` 里看到 `true`，自己决定房主能做什么（卧底：投票截止前只有房主能开票）。
- **离开**：`leave(room, 座位)` 调插件的 `leave()`，记成一条 `$leave` 日志，重放时同样走 `leave()`。没有 `leave()` 的插件由平台决定（`conclude`）。

## 4. 宿主做了什么（一次动作）

1. 是否有这个座位（`PLUGIN_NOT_SEATED`）、动作名是否在清单里（`PLUGIN_UNKNOWN_ACTION`）、字段是否符合 Schema（`PLUGIN_ACTION_INVALID`，带出错位置）。
2. 声明了 `turns`：这个人现在是否有包含这个动作的决策点（`NOT_YOUR_TURN`）。
3. 在沙箱里调用 `apply`，检查返回、状态大小、事件。
4. 重新算 `decisions` 和 `result`；全部通过才写回房间，记一条动作日志。
5. `result.done`：记下排名，清空决策点，提交成功后通知结果监听者（P1 起接结算：积分、战绩、高光由平台按排名结算，插件不能直接加减分）。

**截止时间**：宿主的 `expire(room, now)` 把过期的决策点变成插件 `timeout()` 给的那一步（标记为系统代走）；插件没给出合法动作时，这个决策点停止计时，不会卡住整个房间的其它部分。

**视图**：`view(room, 谁)` 只返回 `plugin.view(state, 这个人)`，加上公开的决策点（别人的可选动作不显示）和结果。原始状态不出服务器。

**动作日志与重放**：每一步记在 `room.state.plugin.log`，房间里保留最近 200 步，更早的进流水账归档（账本 `pluginActions`，见存储引擎改造设计第四步），永不删除。`replay(room)` 从种子和完整日志（含归档）重新走一遍，检查是否得到同样的状态，用于复盘、作弊排查和复现问题。

**状态修复**：平台在步骤之外改了插件状态（版本迁移、后台修复）后，`resync(room)` 按当前状态重新算决策点和结果。

**接管与平台结束（P3）**：
- `adopt(room, 插件, { seats, state, match })`：游戏框架模块把切换前开始的对局按当时的状态交给插件。日志从这里开始，重放从接管时的状态起步。状态按 JSON 规整（没有 `undefined` 字段）。
- `conclude(room, { ranking, reason })`：平台自己结束对局（玩家离场、后台作废、Agent 执行停止）。不问插件，结果里记下原因（`imposed`）。
- `ensureBundled(id)`：按需加载仓库自带的插件。刚启动的进程（重启、脚本）在第一步之前也能用。

**目录**：`GET /api/plugins` 返回已加载插件的公开清单（名称、座位、能力、选项 Schema、动作名），开房页面按它生成。平台启动时从仓库根的 `plugins/` 目录加载自带插件（P1 起有内容）。

## 5. 开发工具

```bash
node scripts/plugin-dev.mjs check    <插件目录>   # 清单、打包、沙箱加载、必需的函数
node scripts/plugin-dev.mjs simulate <插件目录> [--games 20] [--seed 1] [--json]
node scripts/plugin-dev.mjs build    <插件目录> [--out dist/server.js]   # 沙箱实际运行的单文件，提交审核用
```

`simulate` 通过真实的宿主随机对局（`lib/plugins/plugin-conformance.js`），报告：插件出错 / 超时 / 返回格式不对 / 状态超限、对局卡住（没有决策点又没结束）、泄露（`secrets()` 声明的值出现在不该看到的视图或观战视图里）、重放得到的状态不一致（插件用了模块级的可变状态等）。仓库里的插件都要通过（`test/plugins/plugin-conformance.test.js`）。

## 6. 安全边界（现在和以后）

- P0 的沙箱是 Node 的 `vm` 上下文：插件拿不到平台对象、拿不到模块和进程，有调用时间上限。它**不是**对抗恶意代码的安全边界，所以现在只运行平台自己维护、经过审核的插件。
- 社区插件（P5）换成独立进程 + Node 权限模型，接口不变（同样是 JSON 进、JSON 出）。

## 7. 版本

- 接口版本 `room-plugin@1`；新增能力向后兼容，不兼容的改动升到 `@2`。
- 对局开局时锁定插件版本（房间里记着 `version`）；宿主当前加载的版本不同时，这个房间的动作返回 `PLUGIN_VERSION_UNAVAILABLE`，不会用新代码去跑旧状态。同时加载多个版本在 P1 迁移时补上。
