// SPDX-License-Identifier: Apache-2.0
// plugins/gomoku/server/ai.js — 五子棋启发式落子（内置 Bot、Agent 提示与五子棋插件的引擎座位共用；lib/games/gomoku/gomoku-ai.js 转发到这里）
// 思路：按棋型分档（成五 > 活四/双四 > 四三 > 双活三 > …），进攻与防守分开计分；
// 再用有节点预算的连续冲四（VCF）搜索抢杀、并避开会让对方走出 VCF 的点；
// 平静局面再看一手对方的最强回应；同档分差很小时随机取一，避免每局走法一模一样。
// 棋盘语义 board[y][x]，0 空 / 1 黑 / 2 白；连五及长连都算胜（与 lib/games/gomoku/game.js checkWin 一致）。
'use strict';

const SIZE = 15;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const REACH = 4; // 单方向取落子点前后 4 格，够覆盖所有含落子点的五元组
const LIVE_THREES = ['__XXX_', '_XXX__', '_XX_X_', '_X_XX_'];
const LIVE_TWOS = ['__XX__', '__XX_', '_XX__', '_X_X_', '_X__X_'];

// 各档分值。防守表整体低于同档进攻：能赢先赢，但堵对方成五优先于自己做活四。
const ATTACK = { five: 1e8, openFour: 1e6, fourThree: 5e5, doubleThree: 8e4, four: 3000, three: 2000, sleepThree: 300, two: 150, sleepTwo: 30 };
const DEFENSE = { five: 1e7, openFour: 3e5, fourThree: 1e5, doubleThree: 6e4, four: 1500, three: 1800, sleepThree: 200, two: 100, sleepTwo: 20 };
const QUIET_BELOW = 6e4; // 低于双活三防守档视为平静局面，才做一手前瞻和随机
const JITTER = 0.03;
const LOOKAHEAD_TOP = 8;
const REPLY_WEIGHT = 0.6;
// VCF 在请求内同步执行，用节点数封顶，保证最坏情况也只有几十毫秒
const VCF_DEPTH = 8;
const VCF_NODES_ATTACK = 150;
const VCF_NODES_DEFENSE = 25;

const REASONS = [
  ['five', 'win', '成五取胜'],
  ['block-five', 'block-five', '堵对方成五'],
  ['openFour', 'open-four', '做活四/双四'],
  ['fourThree', 'four-three', '做四三'],
  ['block-openFour', 'block-open-four', '防对方活四/双四'],
  ['block-fourThree', 'block-four-three', '防对方四三'],
  ['doubleThree', 'double-three', '做双活三'],
  ['block-doubleThree', 'block-double-three', '防对方双活三'],
];

function inBoard(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }

// 以 (x,y) 为中心取一条线：X=己方（中心视作已落子），_=空，O=对方或棋盘外
function lineThrough(board, x, y, dx, dy, color) {
  let line = '';
  for (let i = -REACH; i <= REACH; i++) {
    const nx = x + dx * i, ny = y + dy * i;
    if (i === 0) line += 'X';
    else if (!inBoard(nx, ny)) line += 'O';
    else line += board[ny][nx] === color ? 'X' : board[ny][nx] === 0 ? '_' : 'O';
  }
  return line;
}

// pattern 是否出现在 line 的、覆盖中心格的位置上（中心之外的旧棋型不算这一手的功劳）
function hasThroughCenter(line, pattern) {
  for (let s = Math.max(0, REACH - pattern.length + 1); s <= REACH && s + pattern.length <= line.length; s++) {
    if (line.startsWith(pattern, s)) return true;
  }
  return false;
}

// 分析一条线：连五 / 能一步成五的空位数（≥2 即活四级别）/ 活三 / 眠三 / 活二 / 眠二
function classifyLine(line) {
  const completions = new Set();
  let sleepThree = false, sleepTwo = false;
  for (let s = 0; s <= REACH; s++) {
    const w = line.slice(s, s + 5);
    if (w.includes('O')) continue;
    const xs = w.split('X').length - 1;
    if (xs === 5) return { five: true };
    if (xs === 4) completions.add(s + w.indexOf('_'));
    else if (xs === 3) sleepThree = true;
    else if (xs === 2) sleepTwo = true;
  }
  return {
    five: false,
    completions: completions.size,
    three: LIVE_THREES.some(p => hasThroughCenter(line, p)),
    sleepThree,
    two: LIVE_TWOS.some(p => hasThroughCenter(line, p)),
    sleepTwo,
  };
}

// 假设 color 落在 (x,y)，统计四个方向形成的棋型
function analyze(board, x, y, color) {
  const a = { five: false, openFour: 0, fours: 0, threes: 0, sleepThrees: 0, twos: 0, sleepTwos: 0 };
  for (const [dx, dy] of DIRS) {
    const c = classifyLine(lineThrough(board, x, y, dx, dy, color));
    if (c.five) { a.five = true; continue; }
    if (c.completions >= 2) a.openFour++;
    else if (c.completions === 1) a.fours++;
    else if (c.three) a.threes++;
    else if (c.sleepThree) a.sleepThrees++;
    else if (c.two) a.twos++;
    else if (c.sleepTwo) a.sleepTwos++;
  }
  return a;
}

// 棋型 → 最高档名（不够组合杀的返回 null）
function tierOf(a) {
  if (a.five) return 'five';
  if (a.openFour || a.fours >= 2) return 'openFour';
  if (a.fours && a.threes) return 'fourThree';
  if (a.threes >= 2) return 'doubleThree';
  return null;
}

function scoreOf(a, table) {
  const tier = tierOf(a);
  if (tier) return table[tier];
  return a.fours * table.four + a.threes * table.three + a.sleepThrees * table.sleepThree
    + a.twos * table.two + a.sleepTwos * table.sleepTwo;
}

// 周围 2 格内有子才算候选（剪枝）
function candidates(board) {
  const list = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          if (inBoard(x + dx, y + dy) && board[y + dy][x + dx] !== 0) near = true;
        }
      }
      if (near) list.push([x, y]);
    }
  }
  return list;
}

function centerBonus(x, y) {
  const c = (SIZE - 1) / 2;
  return SIZE - Math.abs(x - c) - Math.abs(y - c);
}

function reasonOf(atk, def) {
  for (const [key, reason, text] of REASONS) {
    if (key.startsWith('block-') ? tierOf(def) === key.slice(6) : tierOf(atk) === key) return { reason, text };
  }
  return { reason: 'positional', text: '抢占有利位置' };
}

// 对方在当前局面下最强一手的进攻分（用于前瞻）
function bestReplyScore(board, color) {
  let best = 0;
  for (const [x, y] of candidates(board)) {
    best = Math.max(best, scoreOf(analyze(board, x, y, color), ATTACK));
  }
  return best;
}

// color 下一手能成五的所有点
function fiveSpots(board, color) {
  return candidates(board).filter(([x, y]) => analyze(board, x, y, color).five);
}

// 连续冲四取胜：color 每手都做四逼对方唯一应手，直到双四或成五。返回首手 {x, y} 或 null
function findVCF(board, color, budget, depth = VCF_DEPTH) {
  if (depth <= 0 || budget.left <= 0) return null;
  budget.left--;
  const opp = color === 1 ? 2 : 1;
  const fours = [];
  for (const [x, y] of candidates(board)) {
    const a = analyze(board, x, y, color);
    if (a.five) return { x, y };
    if (a.openFour || a.fours) fours.push({ x, y });
  }
  if (!fours.length) return null;
  const mustBlock = fiveSpots(board, opp);
  if (mustBlock.length >= 2) return null; // 对方双四，这一手堵不完
  const moves = mustBlock.length
    ? fours.filter(f => f.x === mustBlock[0][0] && f.y === mustBlock[0][1])
    : fours;
  for (const f of moves) {
    board[f.y][f.x] = color;
    const replies = fiveSpots(board, color);
    let wins = replies.length >= 2;
    if (replies.length === 1) {
      const [rx, ry] = replies[0];
      const counterWin = analyze(board, rx, ry, opp).five; // 对方的应手本身成五，这条线作废
      if (!counterWin) {
        board[ry][rx] = opp;
        wins = !!findVCF(board, color, budget, depth - 1);
        board[ry][rx] = 0;
      }
    }
    board[f.y][f.x] = 0;
    if (wins) return { x: f.x, y: f.y };
  }
  return null;
}

// 选点：返回 { x, y, reason, text }。rng 可注入以便测试稳定复现
function bestMove(board, color, rng = Math.random) {
  const opp = color === 1 ? 2 : 1;
  const cands = candidates(board);
  if (!cands.length) {
    if (board[7][7] === 0) return { x: 7, y: 7, reason: 'opening', text: '首手天元' };
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if (board[y][x] === 0) return { x, y, reason: 'positional', text: '抢占有利位置' };
    }
    return null;
  }
  const scored = cands.map(([x, y]) => {
    const atk = analyze(board, x, y, color);
    const def = analyze(board, x, y, opp);
    return { x, y, atk, def, value: scoreOf(atk, ATTACK) + scoreOf(def, DEFENSE) + centerBonus(x, y) };
  }).sort((a, b) => b.value - a.value);

  // 成五或堵五没有别的选择
  const top = scored[0];
  if (top.atk.five || top.def.five) return { x: top.x, y: top.y, ...reasonOf(top.atk, top.def) };
  const vcf = findVCF(board, color, { left: VCF_NODES_ATTACK });
  if (vcf) return { x: vcf.x, y: vcf.y, reason: 'vcf', text: '连续冲四抢杀' };

  // 前几名各试走一手：走完会让对方走出 VCF 的点垫底
  const quiet = top.value < QUIET_BELOW;
  const finalists = scored.slice(0, LOOKAHEAD_TOP).map((c) => {
    board[c.y][c.x] = color;
    const loses = !!findVCF(board, opp, { left: VCF_NODES_DEFENSE });
    const reply = quiet && !loses ? bestReplyScore(board, opp) : 0;
    board[c.y][c.x] = 0;
    return { ...c, final: loses ? -Infinity : c.value - reply * REPLY_WEIGHT };
  }).sort((a, b) => b.final - a.final);
  // 全部都防不住：退回最高分。有杀棋或必须应对时直接走，不随机
  if (finalists[0].final === -Infinity) return { x: top.x, y: top.y, ...reasonOf(top.atk, top.def) };
  if (!quiet) return { x: finalists[0].x, y: finalists[0].y, ...reasonOf(finalists[0].atk, finalists[0].def) };
  // 平静局面：扣掉对方最强回应后分差很小的随机取一
  const bar = finalists[0].final - Math.abs(finalists[0].final) * JITTER;
  const close = finalists.filter(c => c.final >= bar && c.final !== -Infinity);
  const pick = close[Math.floor(rng() * close.length)] || finalists[0];
  return { x: pick.x, y: pick.y, ...reasonOf(pick.atk, pick.def) };
}

module.exports = { bestMove, analyze, SIZE };
