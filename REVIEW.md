# 审核流程 / Review process

插件的上线方式是**审核后随平台版本发布**。本文说明审核分哪几步、审核人看什么、怎么用调试房试玩，以及合并请求上的标签怎么流转。写给审核人，也写给想知道自己的合并请求接下来会怎样的作者。

## 中文

### 1. 流程总览

1. 作者提交合并请求（`npx aiatt-plugin submit` 会先在本地跑完全部检查，再附上构建产物和检查报告）。
2. **自动检查**在合并请求上重跑一遍，任何一项失败都不进入人工审核。
3. **人工审核**：玩法、文案、能力申请、提示模板；审核人在合并请求的代码上开调试房亲自试玩。
4. 审核通过后合并。维护者把合并的内容同步进平台主干，随下一次平台发布上线（插件修复不必等大版本）；上线前平台后台可以先灰度少数房间或用户，再全量。
5. 上线后出现问题，平台可以随时停用该插件；作者修复后重新走本流程。

### 2. 自动检查（CI）

| 检查 | 失败说明什么 |
| --- | --- |
| 清单格式 | `plugin.json` 不符合 `room-plugin@1`：缺字段、座位数、能力、动作定义不对 |
| 一致性测试 | 宿主接口没按约定实现：缺函数、返回形状不对、状态过大、调用超时 |
| 泄露检查 | 某个座位或观众的视图里出现了不该看到的值 |
| 随机对局模糊测试 | 几千局随机对局里有卡死、报错或重放结果不一致的 |
| 包大小 | 服务端包或前端包超过上限 |
| 禁用 API 扫描 | 用了文件、网络、子进程、`eval`、时钟、`Math.random` 等 |
| 依赖白名单 | 引用了 `plugins/kit/` 和 SDK 白名单以外的模块，或夹带第三方代码 |
| 安全扫描（`tools/scan`） | 提交的文件里有密钥、令牌、内部地址、个人邮箱、本机路径、二进制或过大文件，或缺 SPDX 行 |

自动检查通过只说明「没有明显违规」，不代替人工审核。

### 3. 人工审核：看什么

审核人逐项确认，并在合并请求里留下结论。

**玩法**

- 规则完整、有明确的结束条件和排名；没有无解的卡局，超时（`timeout()`）有合理的兜底。
- 座位数、队伍、回合顺序和描述一致；一局的时长合理。
- Agent 的决策点（`decisions()`）说明清楚：它们看到的提示和回答格式合理，不会诱导 Agent 做规则之外的事。

**文案**

- 面向玩家的文字有简体中文，没有错别字、没有违规内容（色情、暴力、歧视、政治、广告、引流）。
- 提示模板（给 Agent 看的文字）只描述游戏本身，不含对平台、其他玩家或用户数据的指令；平台会在模板外再包一层固定的系统说明，但模板本身仍要审。

**能力申请**

- 清单里的 `capabilities`（随机数、回合、隐藏信息、计时、队伍……）都用得上，没有多要。
- 不要求任何访问存储、账号、网络的能力：插件只有自己这一局的状态。

**安全**（来自平台对社区插件的安全要求）

| 风险 | 审核人确认 |
| --- | --- |
| 插件读写别人的数据 | 代码没有试图访问存储、全局对象、文件或网络 |
| 插件卡死服务器 | 没有死循环和超大循环；每次调用耗时在限额内 |
| 插件泄露隐藏信息 | `secrets()` 声明完整，`view()` 对每个座位和观众都做了过滤 |
| 插件刷积分 | 积分只由平台按排名结算，插件不能自己给分 |
| 前端偷登录态、钓鱼 | 前端只渲染传入的视图；不写 `eval`、不动态加载外部脚本、不读 Cookie、不跳转到外部网站 |
| 恶意提示词诱导 Agent | 见上文「文案」 |
| 内容违规 | 文案、图片、声音都看过 |
| 版权 | 素材是作者自己的或明确可用的；没有夹带第三方代码 |

### 4. 用调试房试玩

> **调试房还在建设中，下一阶段提供。** 在它上线之前，审核人在本地用 `npx aiatt-plugin dev` 模拟器和 `replay` 试玩被审核的代码；下面写的是调试房上线后的流程。

调试房让审核人在**真实的平台环境**里和真人、真 Agent 一起玩被审核的代码，而代码本身一直运行在审核人自己的电脑上。

1. 把合并请求的分支拉到本地：`git fetch origin pull/<编号>/head:pr-<编号>` 然后 `git switch pr-<编号>`，`npm install`。
2. **先在本地读一遍代码**（尤其是 `server/index.js` 和前端文件），再运行；不要对没读过的代码运行 `dev --live`。
3. `npx aiatt-plugin dev --live`，用你自己的开发者令牌登录，平台开一个私密的调试房（标「调试中」，只能邀请进入，最多 8 人加 Agent，24 小时没人自动解散）。
4. 邀请其他审核人或作者入座，也可以邀请 Agent 入座（平台 AI、托管 Bot、命令行 Agent 都行），在终端里看每次调用的入参、返回、耗时和报错，以及 Agent 在每个决策点收到的提示。
5. 至少完整玩一局，并试这些情况：中途离开、超时、非法动作、观众视角、手机屏幕尺寸。
6. 调试房**不收入场费、不结算积分、不产生作者收益**；平台照常校验身份、座位、动作格式、状态大小、按人过滤视图，所以在调试房里看到的泄露问题是真的。作者电脑（这里是审核人电脑）断线超过一分钟，对局会暂停。
7. 玩完后关闭终端即可；调试房会自动解散。不要在调试房里发布任何不该公开的内容。

### 5. 标签怎么流转

合并请求上的标签由机器人或维护者设置，同一时刻只有一个 `status:` 标签。

| 标签 | 含义 | 下一步 |
| --- | --- | --- |
| `status: checks-failed` | 自动检查有失败项 | 作者修复后推送，自动重跑 |
| `status: ready-for-review` | 自动检查全绿，等审核人认领 | 审核人认领，改成 `in-review` |
| `status: in-review` | 审核人正在看代码、开调试房试玩 | 通过则 `approved`；有意见则 `changes-requested` |
| `status: changes-requested` | 审核人提了必须修改的意见 | 作者推送修改，回到 `checks-failed` 或 `ready-for-review` |
| `status: approved` | 审核通过（新插件需要两位审核人，修复需要一位） | 维护者合并 |
| `status: merged-pending-sync` | 已合并，等待同步进平台主干 | 维护者同步，随平台发布 |
| `status: released` | 已随平台版本上线 | 关闭 |
| `status: rejected` | 不接收（玩法不合适、内容违规、安全问题等），写明原因 | 关闭 |

辅助标签：`type: new-plugin`、`type: plugin-fix`、`type: docs`、`type: tooling`；`needs: debug-room`（审核人需要开调试房）；`needs: art-license`（素材授权待确认）；`security`（涉及安全，转私下处理，见 [SECURITY.md](SECURITY.md)）。

审核人原则：对事不对人；给出能照着改的意见；第一期不承诺固定的审核时长；有安全疑虑时宁可拒绝并说明原因。

### 6. 平台需求怎么评审

「平台需求」issue（标签 `type: platform-request`）由平台维护者按批评审（大约每周一次）。每条按七项看，评审结论写在 issue 里：

1. **通用性**：至少两个插件或一整类玩法用得上，不为单个插件开特例。
2. **符合插件原则**：插件仍是纯逻辑，副作用由平台管；平台代码里不出现插件名字；能力默认拒绝。
3. **安全**：不泄露别人的隐藏信息，不绕过沙箱，不能刷积分，前端拿不到登录态。
4. **性能和存储**：每个动作多出来的计算、调用和写入在预算内。
5. **兼容**：对 `room-plugin@1` 只做增量；破坏性变更要出新的大版本，旧插件继续跑。
6. **代价和排期**：工作量，以及和平台路线图冲不冲突。
7. **替代方案**：能在插件里或 `plugins/kit/` 里解决的，优先这样做。

结论四种，各有标签：`status: planned`（接，排进开发）、`status: deferred`（以后再说，写明什么情况下再看）、`status: solved-in-plugin`（给出写法）、`status: rejected`（写明违反了哪一条）。接下的需求合并后是 `status: merged-pending-sync`，随平台发布上线后是 `status: released`；提需求的人用自己的复现验证后关闭。

---

## English

### 1. Overview

Plugins go live **after review, with a platform release**.

1. The author opens a pull request (`npx aiatt-plugin submit` first runs every check locally and attaches the build output and the check report).
2. **Automatic checks** run again on the pull request; any failure keeps it out of human review.
3. **Human review**: gameplay, copy, requested capabilities, prompt templates; the reviewer plays the code in a debug room.
4. After approval the pull request is merged. A maintainer syncs it into the platform trunk and it ships with the next platform release (plugin fixes do not wait for a major version); the platform can roll it out to a few rooms or users before everyone.
5. If a problem appears later, the platform can disable the plugin at any time; the author fixes it and goes through this process again.

### 2. Automatic checks (CI)

| Check | A failure means |
| --- | --- |
| Manifest format | `plugin.json` does not follow `room-plugin@1`: missing fields, wrong seats, capabilities or action definitions |
| Conformance tests | The host contract is not met: missing functions, wrong return shapes, oversized state, call time-outs |
| Leak check | A seat's or a spectator's view contains a value they must not see |
| Random-match fuzzing | Among thousands of random matches some stall, throw or do not replay to the same state |
| Bundle size | The server or front-end bundle is over the limit |
| Forbidden API scan | Files, network, child processes, `eval`, the clock, `Math.random` and similar are used |
| Dependency allowlist | A module outside `plugins/kit/` and the SDK allowlist is used, or third-party code is included |
| Security scan (`tools/scan`) | The change contains keys, tokens, internal addresses, personal e-mail addresses, local paths, binary or oversized files, or lacks the SPDX line |

Green checks only mean "nothing obviously wrong"; they do not replace human review.

### 3. Human review: what to check

The reviewer confirms each item and leaves the conclusion on the pull request.

**Gameplay**

- Complete rules with a clear end condition and ranking; no unwinnable stalls, a sensible fallback in `timeout()`.
- Seat count, teams and turn order match the description; a match has a reasonable length.
- The Agent decision points (`decisions()`) are clear: the prompts and answer formats Agents get are reasonable and do not push an Agent to act outside the rules.

**Copy**

- Player-facing text has Simplified Chinese, no typos and no prohibited content (sexual, violent, discriminatory, political, advertising, traffic diversion).
- Prompt templates (text shown to Agents) describe the game only and carry no instructions about the platform, other players or user data. The platform wraps a fixed system notice around every template, but the template itself is still reviewed.

**Capabilities**

- Every entry in `capabilities` (randomness, turns, hidden information, deadlines, teams, ...) is used; nothing extra is requested.
- No capability gives access to storage, accounts or the network: a plugin only has the state of its own match.

**Security** (the platform's requirements for community plugins)

| Risk | The reviewer confirms |
| --- | --- |
| A plugin reads or writes other people's data | The code does not try to reach storage, globals, files or the network |
| A plugin hangs the server | No endless or huge loops; each call stays within its time limit |
| A plugin leaks hidden information | `secrets()` is complete and `view()` filters for every seat and for spectators |
| A plugin farms points | Points are settled by the platform from the ranking only; a plugin cannot award points |
| Front end steals sessions or phishes | The front end only renders the view it is given; no `eval`, no dynamically loaded external scripts, no cookie access, no redirects to external sites |
| Malicious prompts steering an Agent | See "Copy" above |
| Prohibited content | Text, images and sound were all looked at |
| Copyright | Assets are the author's own or clearly licensed; no third-party code is included |

### 4. Playing the change in a debug room

> **The debug room is still being built and comes in the next phase.** Until then reviewers play the code locally with the `npx aiatt-plugin dev` simulator and `replay`; what follows is the flow once the debug room is available.

A debug room lets a reviewer play the code under review in the **real platform environment** with real people and Agents, while the code itself keeps running on the reviewer's own machine.

1. Fetch the pull request: `git fetch origin pull/<number>/head:pr-<number>`, `git switch pr-<number>`, `npm install`.
2. **Read the code locally first** (especially `server/index.js` and the front-end files) and only then run it; never run `dev --live` on code you have not read.
3. `npx aiatt-plugin dev --live`, signing in with your own developer token. The platform opens a private debug room (marked "debugging", invite only, at most 8 people plus Agents, dissolved after 24 hours without people).
4. Invite other reviewers or the author to sit down, and invite Agents too (platform AI, hosted bots, command-line Agents); the terminal shows every call's input, output, duration and errors, and the prompt an Agent got at each decision point.
5. Play at least one full match and try: leaving midway, time-outs, illegal actions, the spectator view, a phone-sized screen.
6. A debug room charges **no entry fee, settles no points and produces no author earnings**. The platform validates as usual (identity, seats, action format, state size, per-viewer views), so a leak seen in a debug room is real. If the machine running the code (here the reviewer's) is offline for more than a minute, the match pauses.
7. When done, stop the terminal; the room dissolves by itself. Do not post anything non-public in a debug room.

### 5. Label flow

Labels are set by a bot or a maintainer; a pull request carries exactly one `status:` label at a time.

| Label | Meaning | Next |
| --- | --- | --- |
| `status: checks-failed` | An automatic check failed | The author fixes and pushes; checks rerun |
| `status: ready-for-review` | All checks green, waiting for a reviewer | A reviewer picks it up and sets `in-review` |
| `status: in-review` | A reviewer is reading the code and playing it | `approved`, or `changes-requested` |
| `status: changes-requested` | The reviewer asked for changes | The author pushes; back to `checks-failed` or `ready-for-review` |
| `status: approved` | Approved (new plugins need two reviewers, fixes need one) | A maintainer merges |
| `status: merged-pending-sync` | Merged, waiting to be synced into the platform trunk | A maintainer syncs; ships with a platform release |
| `status: released` | Live with a platform release | Close |
| `status: rejected` | Not accepted (unsuitable gameplay, prohibited content, security), with the reason written down | Close |

Helper labels: `type: new-plugin`, `type: plugin-fix`, `type: docs`, `type: tooling`; `needs: debug-room` (the reviewer needs a debug room); `needs: art-license` (asset license to be confirmed); `security` (security related, move to private handling, see [SECURITY.md](SECURITY.md)).

Reviewer principles: criticize the work, not the person; give comments the author can act on; no fixed turnaround is promised in the first phase; when in doubt about security, reject and explain.

### 6. Platform requests

"Platform request" issues (label `type: platform-request`) are reviewed by the platform maintainers in batches (about weekly), on seven points, with the verdict written in the issue:

1. **Reach**: at least two plugins or a whole kind of game benefit; no special case for one plugin.
2. **Plugin principles**: plugins stay pure logic and the platform owns side effects; no plugin names in platform code; capabilities are denied by default.
3. **Security**: no leak of others' hidden information, no way around the sandbox, no point farming, no session access from the client.
4. **Performance and storage**: the extra work, calls and writes per action fit the budget.
5. **Compatibility**: additive to `room-plugin@1`; a breaking change needs a new major version and old plugins keep running.
6. **Cost and timing**: the effort, and whether it collides with the platform roadmap.
7. **Alternatives**: what can be done inside the plugin or `plugins/kit/` is done there.

Four outcomes, each with a label: `status: planned` (accepted and scheduled), `status: deferred` (later, with the condition to look again), `status: solved-in-plugin` (with how), `status: rejected` (with the rule it breaks). An accepted request becomes `status: merged-pending-sync` when merged and `status: released` when live; the requester checks it with their reproduction and closes it.
