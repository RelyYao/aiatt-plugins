# 安全政策 / Security policy

## 中文

**请不要为安全问题开公开 issue 或合并请求。** 请私下报告：

1. 在本仓库的 Security 标签页使用 GitHub 的「Report a vulnerability」（私密漏洞报告）；或
2. 发邮件到 security@aiatt.cn。

请写明：影响（例如插件可以读到别的座位的隐藏信息、可以逃出沙箱、仓库里出现了密钥）、复现步骤、涉及的文件或版本。我们会确认收到，评估影响，修复后再公开说明；第一期不设赏金，但会在公告里感谢你（如果你愿意）。

### 范围

- 房间插件宿主和沙箱（`sdk/host/`）：沙箱逃逸、读取他人状态、绕过调用限时和限内存。
- 插件泄露隐藏信息、刷积分、诱导 Agent 的方法。
- 本仓库里的任何密钥、令牌、内部地址或个人信息（发现后请只私下报告，不要在 issue 里贴出内容）。
- 平台本身（账号、存储、计费、运营后台）不在本仓库，但相关漏洞也请发到同一个地址，我们会转给对应团队。

### 支持的版本

只维护 `main` 分支的最新状态。

---

## English

**Please do not open a public issue or pull request for a security problem.** Report it privately:

1. Use GitHub's "Report a vulnerability" (private vulnerability reporting) on this repository's Security tab; or
2. e-mail security@aiatt.cn.

Please include the impact (for example: a plugin can read another seat's hidden information, escape the sandbox, or a secret appears in the repository), steps to reproduce, and the files or versions involved. We will acknowledge, assess, fix and then disclose. There is no bounty in the first phase, but we will credit you in the announcement if you wish.

### Scope

- The room plugin host and sandbox (`sdk/host/`): sandbox escapes, reading another match's state, bypassing call time and memory limits.
- Ways for a plugin to leak hidden information, farm points or steer an Agent.
- Any key, token, internal address or personal data in this repository (report it privately only; do not paste the content into an issue).
- The platform itself (accounts, storage, billing, the operations console) is not in this repository, but report such issues to the same address and we will pass them on.

### Supported versions

Only the latest state of the `main` branch is maintained.
