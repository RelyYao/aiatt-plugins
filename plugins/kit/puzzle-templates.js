// SPDX-License-Identifier: Apache-2.0
// plugins/kit/puzzle-templates.js — 谜题交易所 · 参数化谜题模板库（插件工具箱：谜题交易所、无尽回廊两个插件共用，`@aiatt/plugin-kit/puzzle-templates`）
// 种子化确定性生成 + 验证器 + 难度评分 + 提示券派生。平台无内置 LLM——
// 可解性由这里的确定性代码数学保证（出题参数只决定难度与迷惑性，不决定可解性）。
// 结构仿 spywords.js 的运营资产模式；commit-reveal 的承诺对象 = solution JSON。
'use strict';

/* ---------- 种子化 RNG（mulberry32）：同 seed 同谜题，揭示后任何人可复算 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, maxExclusive) { return Math.floor(rng() * maxExclusive); }

/* ---------- 模板目录元数据（catalog / 出题 UI / Agent 手册共用） ---------- */
const TEMPLATES = {
  lights: {
    name: 'Lights Out', icon: '💡',
    desc: 'Click a cell to flip it and its four neighbors; turn every light off to solve',
    i18n: { 'zh-CN': { name: '点灯阵', desc: '点击一格，十字五格连锁翻转，全灭即解' } },
    defaultParams: { size: 4, clicks: 3 },
    paramInfo: 'size 3-5 · clicks 2-8',
  },
  pipes: {
    name: 'Pipe Grid', icon: '🔧',
    desc: 'Click a pipe to rotate it 90°; connect every pipe with no leaks to solve',
    i18n: { 'zh-CN': { name: '管道阵', desc: '点击旋转管件 90°，接通全部管路且不泄漏即解' } },
    defaultParams: { cols: 4, rows: 4, branches: 1 },
    paramInfo: 'cols 3-6 · rows 3-5 · branches 1-3',
  },
  cipher: {
    name: 'Code Breaker', icon: '🔐',
    desc: 'Guess a color sequence and get position/color feedback; match it exactly to solve',
    i18n: { 'zh-CN': { name: '密码阵', desc: '提交颜色序列猜测，得位置/颜色反馈，全对即解' } },
    defaultParams: { length: 4, colors: 5 },
    paramInfo: 'length 4-6 · colors 5-7',
  },
};
const LIGHTS = { size: [3, 5], clicks: [2, 8] };
const PIPES = { cols: [3, 6], rows: [3, 5], branches: [1, 3] };
const CIPHER = { length: [4, 6], colors: [5, 7], maxGuesses: 10 };
const HINTS_PER_ROUND = 2;

/* ---------- 参数校验与归一 ---------- */
function coerceInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}
function normalizeParams(template, raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (template === 'lights') {
    out.size = coerceInt(input.size, ...LIGHTS.size, TEMPLATES.lights.defaultParams.size);
    out.clicks = coerceInt(input.clicks, ...LIGHTS.clicks, TEMPLATES.lights.defaultParams.clicks);
  } else if (template === 'pipes') {
    out.cols = coerceInt(input.cols, ...PIPES.cols, TEMPLATES.pipes.defaultParams.cols);
    out.rows = coerceInt(input.rows, ...PIPES.rows, TEMPLATES.pipes.defaultParams.rows);
    out.branches = coerceInt(input.branches, ...PIPES.branches, TEMPLATES.pipes.defaultParams.branches);
  } else if (template === 'cipher') {
    out.length = coerceInt(input.length, ...CIPHER.length, TEMPLATES.cipher.defaultParams.length);
    out.colors = coerceInt(input.colors, ...CIPHER.colors, TEMPLATES.cipher.defaultParams.colors);
  } else {
    return { code: 400, error: 'BAD_TEMPLATE', message: `Puzzle template must be one of ${Object.keys(TEMPLATES).join('/')}` };
  }
  for (const [key, value] of Object.entries(out)) {
    if (value === null) return { code: 400, error: 'BAD_PARAMS', message: `Parameter ${key} is out of range (${TEMPLATES[template].paramInfo})` };
  }
  return { params: out };
}

/* ---------- lights 点灯阵 ---------- */
function lightsToggle(cells, size, idx) {
  const row = Math.floor(idx / size), col = idx % size;
  const flip = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) cells[r * size + c] ^= 1; };
  flip(row, col); flip(row - 1, col); flip(row + 1, col); flip(row, col - 1); flip(row, col + 1);
}
function lightsIsSolved(board) { return board.cells.every(cell => cell === 0); }

/* ---------- pipes 管道阵 ---------- */
const DIRS = [{ dr: -1, dc: 0, bit: 1, opp: 4 }, { dr: 0, dc: 1, bit: 2, opp: 8 }, { dr: 1, dc: 0, bit: 4, opp: 1 }, { dr: 0, dc: -1, bit: 8, opp: 2 }];
function rotateMask(mask, times) {
  let out = mask;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) out = ((out << 1) | (out >>> 3)) & 15;
  return out;
}
function buildTree(cols, rows, branches, rng) {
  const n = cols * rows;
  const degree = new Array(n).fill(0);
  const edges = [];
  const visited = new Array(n).fill(false);
  const start = randInt(rng, n);
  visited[start] = true;
  const frontier = [];
  const pushFrontier = (cell) => {
    const r = Math.floor(cell / cols), c = cell % cols;
    for (const d of DIRS) {
      const nr = r + d.dr, nc = c + d.dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const next = nr * cols + nc;
      if (!visited[next]) frontier.push([cell, next]);
    }
  };
  pushFrontier(start);
  while (frontier.length) {
    // 分叉偏好：按 branches 概率挑「接入点已有度数」的边，制造三通/四通节点
    let pick = -1;
    if (rng() < 0.3 + 0.18 * branches) {
      let bestDeg = 0;
      frontier.forEach(([from], i) => { if (degree[from] > bestDeg) { bestDeg = degree[from]; pick = i; } });
    }
    if (pick < 0) pick = randInt(rng, frontier.length);
    const [from, to] = frontier.splice(pick, 1)[0];
    if (visited[to]) continue;
    visited[to] = true;
    degree[from]++; degree[to]++;
    edges.push([from, to]);
    pushFrontier(to);
  }
  const masks = new Array(n).fill(0);
  for (const [a, b] of edges) {
    const ra = Math.floor(a / cols), ca = a % cols, rb = Math.floor(b / cols), cb = b % cols;
    if (rb < ra) masks[a] |= 1; else if (rb > ra) masks[a] |= 4; else if (cb > ca) masks[a] |= 2; else masks[a] |= 8;
    if (ra < rb) masks[b] |= 1; else if (ra > rb) masks[b] |= 4; else if (ca > cb) masks[b] |= 2; else masks[b] |= 8;
  }
  return { masks, degree };
}
function pipesConnected(board) {
  const { cols, rows, masks, rots } = board;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const open = rotateMask(masks[idx], rots[idx]);
      for (const d of DIRS) {
        if (!(open & d.bit)) continue;
        const nr = r + d.dr, nc = c + d.dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return false; // 泄漏
        const nIdx = nr * cols + nc;
        if (!(rotateMask(masks[nIdx], rots[nIdx]) & d.opp)) return false; // 对端未接
      }
    }
  }
  return true;
}
function pipesIsSolved(board) { return pipesConnected(board); }

/* ---------- cipher 密码阵 ---------- */
function cipherFeedback(secret, seq) {
  let exact = 0;
  const restS = [], restG = [];
  for (let i = 0; i < secret.length; i++) {
    if (seq[i] === secret[i]) exact++;
    else { restS.push(secret[i]); restG.push(seq[i]); }
  }
  let partial = 0;
  const pool = restS.slice();
  for (const g of restG) {
    const at = pool.indexOf(g);
    if (at >= 0) { partial++; pool.splice(at, 1); }
  }
  return { exact, partial };
}

/* ---------- 生成入口 ---------- */
function generate(template, params, seed) {
  const rng = mulberry32(seed);
  if (template === 'lights') {
    const { size, clicks } = params;
    const solution = [];
    const used = new Set();
    while (solution.length < clicks && used.size < size * size) {
      const idx = randInt(rng, size * size);
      if (used.has(idx)) continue;
      used.add(idx); solution.push(idx);
    }
    const cells = new Array(size * size).fill(0);
    for (const idx of solution) lightsToggle(cells, size, idx);
    // 线性代数兜底：极小概率不同格的十字叠加恰好全灭，追加一步打破
    let guard = 0;
    while (lightsIsSolved({ cells }) && guard < size * size) {
      if (!used.has(guard)) { used.add(guard); solution.push(guard); lightsToggle(cells, size, guard); }
      guard++;
    }
    // 构造保证自检：从初盘重放解法必全灭（异或自反）
    const replay = cells.slice();
    for (const idx of solution) lightsToggle(replay, size, idx);
    if (!replay.every(c => c === 0)) throw new Error('lights generate self-check failed');
    const hints = solution.slice().sort((a, b) => a - b).slice(0, HINTS_PER_ROUND).map(idx => ({ type: 'cell', idx }));
    return {
      board: { size, cells },
      solution: { cells: solution },
      hints,
      difficulty: size >= 5 || clicks >= 6 ? 3 : size >= 4 || clicks >= 4 ? 2 : 1,
      meta: { size, clicks: solution.length },
    };
  }
  if (template === 'pipes') {
    const { cols, rows, branches } = params;
    // 分叉数不达标则确定性换子种子重试，最多 12 次
    let built = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const sub = mulberry32((seed * 1000 + attempt) >>> 0);
      const tree = buildTree(cols, rows, branches, sub);
      built = tree;
      if (tree.degree.filter(d => d >= 3).length >= branches) break;
    }
    const n = cols * rows;
    const scrambled = new Array(n);
    let misaligned = 0;
    for (let i = 0; i < n; i++) { scrambled[i] = randInt(rng, 4); if (scrambled[i] !== 0) misaligned++; }
    const minMisaligned = Math.max(2, Math.ceil(n / 4));
    let fix = 0;
    while (misaligned < minMisaligned && fix < n) {
      if (scrambled[fix] === 0) { scrambled[fix] = 1 + randInt(rng, 3); misaligned++; }
      fix++;
    }
    const rots = scrambled.slice();
    // 解法终态 = 每个管件回到「有效开孔 == 基准 mask」的最小旋转位
    // （对称管件存在 2/4-fold 等价位，取最小者；从当前 rots 顺时针 +1 步进必可达）
    const base = built.masks.map(m => {
      for (let r = 0; r < 4; r++) if (rotateMask(m, r) === m) return r;
      return 0;
    });
    const board = { cols, rows, masks: built.masks, rots };
    // 构造保证自检：复位到基准朝向后必须全接通
    if (!pipesConnected({ ...board, rots: base })) throw new Error('pipes generate self-check failed');
    const hintIdx = [];
    for (let i = 0; i < n && hintIdx.length < HINTS_PER_ROUND; i++) if (scrambled[i] !== 0) hintIdx.push(i);
    return {
      board,
      solution: { rots: base },
      hints: hintIdx.map(idx => ({ type: 'rot', idx, rot: base[idx] })),
      difficulty: n >= 18 || built.degree.filter(d => d >= 3).length >= 4 ? 3 : n >= 12 || built.degree.filter(d => d >= 3).length >= 2 ? 2 : 1,
      meta: { cells: n, junctions: built.degree.filter(d => d >= 3).length },
    };
  }
  // cipher
  const { length, colors } = params;
  const secret = Array.from({ length }, () => randInt(rng, colors));
  const hintPos = [];
  while (hintPos.length < Math.min(HINTS_PER_ROUND, length)) {
    const pos = randInt(rng, length);
    if (!hintPos.includes(pos)) hintPos.push(pos);
  }
  return {
    board: { length, colors, maxGuesses: CIPHER.maxGuesses, guesses: [] },
    solution: { secret },
    hints: hintPos.map(pos => ({ type: 'pos', pos, color: secret[pos] })),
    difficulty: length >= 6 || colors >= 7 ? 3 : length >= 5 || colors >= 6 ? 2 : 1,
    meta: { length, colors },
  };
}

/* ---------- 动作应用与终局判定（puzzle.js 调用） ---------- */
function applyMove(template, board, move) {
  if (template === 'lights') {
    const cells = board.cells.slice();
    lightsToggle(cells, board.size, move.idx);
    return { ...board, cells };
  }
  const rots = board.rots.slice();
  rots[move.idx] = (rots[move.idx] + 1) % 4;
  return { ...board, rots };
}
// cipher 的 feedback 需要私密 secret，由 puzzle.js 在收到 guess 时单独传
function applyGuess(board, secret, seq) {
  const guesses = board.guesses.concat([{ seq: seq.slice(), ...cipherFeedback(secret, seq) }]);
  return { ...board, guesses };
}
function isSolved(template, board) {
  if (template === 'lights') return lightsIsSolved(board);
  if (template === 'pipes') return pipesConnected(board);
  const last = board.guesses[board.guesses.length - 1];
  return !!last && last.exact === board.length;
}
function isFailed(template, board) {
  if (template !== 'cipher') return false;
  const last = board.guesses[board.guesses.length - 1];
  return board.guesses.length >= board.maxGuesses && (!last || last.exact !== board.length);
}
function describeHint(hint) {
  if (hint.type === 'cell') return `The solution includes cell ${hint.idx + 1}`;
  if (hint.type === 'rot') return `Pipe ${hint.idx + 1} should be at rotation ${hint.rot} (0-3)`;
  return `Position ${hint.pos + 1} of the code is color ${hint.color}`;
}
function revealedHints(hints, count) {
  if (!Array.isArray(hints) || !Number.isSafeInteger(count) || count < 1) return [];
  return hints.slice(0, count).map(h => h.type === 'cell' ? {type:'cell',idx:h.idx} : h.type === 'rot' ? {type:'rot',idx:h.idx,rot:h.rot} : h.type === 'pos' ? {type:'pos',pos:h.pos,color:h.color} : null).filter(Boolean);
}
/* 解题窗（秒）：随难度放宽 */
function solveWindowSec(template, difficulty) {
  const base = template === 'lights' ? 90 : template === 'pipes' ? 150 : 210;
  return base + difficulty * 60;
}

module.exports = {
  TEMPLATES, HINTS_PER_ROUND, CIPHER,
  normalizeParams, generate, applyMove, applyGuess, isSolved, isFailed,
  describeHint, revealedHints, solveWindowSec,
};
