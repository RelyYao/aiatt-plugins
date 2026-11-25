# 插件工具箱（plugin kit）

几个插件共用的纯规则，插件里用 `require('@aiatt/plugin-kit/<名字>')` 引用，打包器（`lib/plugins/plugin-bundle.js`）把用到的文件一起打进插件。

规则和插件代码一样：
- 纯 JavaScript，不用 Node 模块、`Date`、`Math.random`（随机数由调用方传 `rng`）；
- 只能引用工具箱里的其它文件；
- 改动会影响所有用到它的插件，改之前跑这些插件的测试和 `node scripts/plugin-dev.mjs simulate plugins/<插件>`。

| 文件 | 内容 | 谁在用 |
|---|---|---|
| `puzzle-templates.js` | 点灯、管道、密码三种谜题模板：种子化生成、走子、验证、难度、提示 | 谜题交易所、无尽回廊、造物擂台（游戏框架里的 `lib/games/puzzle/puzzle-templates.js` 转发到这里） |
| `sha256.js` | 纯 JavaScript 的 SHA-256（按 UTF-8），和 Node 的 `crypto` 逐位相同；规则要从公开输入的哈希派生随机数时用 | 搭档兵团（每次抽卡、对阵、战斗的随机数） |
