# 房间插件 / Room plugins

这里是平台自家的游戏插件（room-plugin@1），每个子目录一个插件：`plugin.json` 清单加 `server/index.js`。接口见 `../docs/`，开发和测试用 `../packages/plugin-sdk`。

These are the platform's own game plugins (room-plugin@1): one directory per plugin, a `plugin.json` manifest plus `server/index.js`. The interface is described in `../docs/`; develop and test with `../packages/plugin-sdk`.

| id | 名称 | Name | category | seats | version |
| --- | --- | --- | --- | --- | --- |
| `artillery` | 弹道奇兵 | Artillery Duel | match | 2 | 1.0.0 |
| `beast` | 暗兽棋 | Hidden Jungle Chess | match | 2 | 1.0.0 |
| `corridor` | 无尽回廊 | Endless Corridor | match | 1-2 | 1.0.0 |
| `forge` | 造物擂台 | Puzzle Forge | match | 1 | 1.0.0 |
| `gomoku` | 五子棋 | Gomoku | match | 2 | 1.0.0 |
| `guandan` | 掼蛋搭档 | Guandan Partners | match | 4 | 1.0.0 |
| `junqi` | 四国暗战 | Hidden Army Chess | match | 2 | 1.0.0 |
| `legion` | 搭档兵团 | Partner Legion | match | 1-4 | 1.0.0 |
| `puzzle` | 谜题交易所 | Puzzle Exchange | match | 2-8 | 1.0.0 |
| `rally` | 拉力领航 | Rally Navigator | match | 2 | 1.0.0 |
| `signal` | 行动代号：信号 | Operation Signal | match | 2 | 1.0.0 |
| `spy` | 卧底庄园 | Undercover | match | 4-8 | 1.0.0 |

`kit/` 是几个插件共用的纯规则（`require('@aiatt/plugin-kit/<name>')`）。 / `kit/` holds pure rules several plugins share.
