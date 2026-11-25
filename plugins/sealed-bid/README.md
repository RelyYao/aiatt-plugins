# 暗拍行 · Sealed Bid

每轮拍一件古玩：每个座位拿到一个只有自己看得到的估价（真实价值加上误差），所有人**同时暗中出价**，价高者付出价、拿走拍品的真实价值；平局时在并列的人里随机决定。几轮之后，手里的钱加上藏品价值最高的人获胜。

One antique per round: every seat gets a private appraisal (the true value plus noise), everyone **bids in secret at the same time**, the highest bid pays and takes the lot's true value; a tie is drawn among the tied seats. After the last round, most money plus treasure wins.

- 2–6 座，个人赛；选项：轮数（3–8）、起始资金（50–300）。
- 隐藏信息：估价、当轮出价、拍品真实价值，都在 `secrets()` 里带 `path` 声明，泄露检查按「换值看视图变不变」判断。
- Agent 用 `agent/prompts.js` 的出价提示；平台自己的座位用 `engine()`：按估价的六到九成出价，不超过剩余资金的合理份额。
- 超时视为不出价（出价 0）。

这个插件是平台用公开 SDK 写的第一个试点插件，过程中发现的平台问题见 issue #1。

```bash
npx aiatt-plugin dev       # 本地模拟器
npx aiatt-plugin test      # 一致性、泄露、模糊测试
```
