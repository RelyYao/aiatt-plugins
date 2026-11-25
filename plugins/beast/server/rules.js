// SPDX-License-Identifier: Apache-2.0
// plugins/beast/server/rules.js — Beast Chess (暗兽棋) rules, pure: the board and its terrain, the seeded setup, the
// battle table and move generation. The plugin (./index.js) plays by them; lib/games/beast/beast.js reads them too
// (its platform AI, the private view and the exported rules), so there is one copy. No Node APIs: it runs in the
// sandbox. The commitment hash is taken outside (ctx.sha256 in the plugin, Node crypto on the platform).
'use strict';
/* ---------- 常量与地形 ---------- */
const COLS = 7, ROWS = 9;
const TURN_MS = 60 * 1000;          // 60s/步（惰性结算）
const TURN_CAP = 300;               // 回合上限（手数；每手 = 一方行动一次）
const RAT = 1, CAT = 2, DOG = 3, WOLF = 4, LEOPARD = 5, TIGER = 6, LION = 7, ELEPHANT = 8;
const RANK_NAMES = { 1: '鼠', 2: '猫', 3: '狗', 4: '狼', 5: '豹', 6: '虎', 7: '狮', 8: '象' };
const RANK_EMOJI = { 1: '🐀', 2: '🐈', 3: '🐕', 4: '🐺', 5: '🐆', 6: '🐯', 7: '🦁', 8: '🐘' };
// 兽穴：side0（蓝，下方 r0-2）穴在 (3,0)；side1（红，上方 r6-8）穴在 (3,8)
const DENS = { 0: [3, 0], 1: [3, 8] };
// 陷阱：穴旁各 3 格（我方陷阱只对进入的敌方生效）
const TRAPS = { 0: [[2, 0], [4, 0], [3, 1]], 1: [[2, 8], [4, 8], [3, 7]] };
// 河流：行 3-5，列 1-2 与 4-5（两块 2×3）
const WATERS = [];
for (let r = 3; r <= 5; r++) for (const c of [1, 2, 4, 5]) WATERS.push([c, r]);
// 固定镜像槽位：side0 的 8 个起始格（经典斗兽棋位），side1 为中心点对称镜像。
// 坐标仍为镜像槽位；v2 双方身份独立洗牌，自己的身份不再暴露敌方同槽身份。
const SLOTS = [
  [[0, 0], [6, 0], [1, 1], [5, 1], [0, 2], [2, 2], [4, 2], [6, 2]],           // side0（蓝，下方）
  [[6, 8], [0, 8], [5, 7], [1, 7], [6, 6], [4, 6], [2, 6], [0, 6]],           // side1（红，上方）
];
const PIECE_PREFIX = ['b', 'r']; // side0 → b0..b7，side1 → r0..r7
const WATER_SET = new Set(WATERS.map(([c, r]) => `${c},${r}`));
const TRAP_OWNER = new Map(); // "c,r" → side
for (const side of [0, 1]) for (const [c, r] of TRAPS[side]) TRAP_OWNER.set(`${c},${r}`, side);

function isWater(c, r) { return WATER_SET.has(`${c},${r}`); }
function trapOwnerAt(c, r) { return TRAP_OWNER.has(`${c},${r}`) ? TRAP_OWNER.get(`${c},${r}`) : null; }
function inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

/* ---------- 种子化 RNG（mulberry32，自 puzzle-templates 复制：同 seed 同布置） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 布置与承诺（commit-reveal） ---------- */
// 身份序列：mulberry32(seed) Fisher-Yates 洗 [1..8]，按槽位序同序贴两侧（镜像布置）。
function setupRanks(seed) {
  const rng = mulberry32(seed);
  const ranks = [RAT, CAT, DOG, WOLF, LEOPARD, TIGER, LION, ELEPHANT];
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  return ranks;
}
function setupJson(ranks) { return JSON.stringify({ blue: ranks, red: ranks.slice() }); }
const SETUP_VERSION = 'independent-v2';
function setupFor(seed, version = 'mirror-v1') {
  if (version === SETUP_VERSION) return { blue: setupRanks(seed.blue), red: setupRanks(seed.red) };
  if (version !== 'mirror-v1') throw new Error('Unsupported beast setup version');
  const blue = setupRanks(seed);
  return { blue, red: blue.slice() };
}
// What the published commitment hashes: sha256(salt + '|' + setupPayload(seed, version)). The platform (Node crypto)
// and the plugin (ctx.sha256) hash the same text, so anyone can check a revealed setup.
function setupPayload(seed, version = 'mirror-v1') {
  const setup = setupFor(seed, version);
  return JSON.stringify(version === SETUP_VERSION ? { setupVersion: version, ...setup } : setup);
}

function buildPieces(ranks) {
  const pieces = [];
  for (const side of [0, 1]) {
    SLOTS[side].forEach(([c, r], slot) => {
      const sideRanks = Array.isArray(ranks) ? ranks : ranks[side === 0 ? 'blue' : 'red'];
      pieces.push({ id: `${PIECE_PREFIX[side]}${slot}`, side, slot, rank: sideRanks[slot], c, r, alive: true });
    });
  }
  return pieces;
}

/* ---------- 判定表（纯函数，平台当裁判；test 直接全表驱动） ---------- */
// 返回 'capture'（守方被吃）| 'sacrifice'（攻方阵亡）。
// 规则（按序短路）：
//   1. 守方在攻方陷阱 → 守方等级视为 0，被任意子吃；
//   2. 鼠1 攻象8 → 唯一越级（守方被吃）；
//   3. 攻方等级 ≥ 守方 → 守方被吃（同级攻方胜）；
//   4. 以弱攻强 → 攻方阵亡（暗置下试探有代价：子被吃且双方身份揭示）。
function resolveBattle(atkRank, defRank, defInAtkTrap) {
  if (defInAtkTrap) return 'capture';
  if (atkRank === RAT && defRank === ELEPHANT) return 'capture';
  return atkRank >= defRank ? 'capture' : 'sacrifice';
}

/* ---------- 走子生成（纯几何 + 地形；身份不参与合法性 —— 防试探泄漏） ---------- */
const STEP_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 上右下左（确定性枚举序，自动步用）

function jumpLandings(c, r) {
  // 狮虎跃河：直线跨河，落在河对岸第一块陆地；路径（河面格）有子即阻断（调用方查）。
  const out = [];
  if (r === 2 && (c === 1 || c === 2 || c === 4 || c === 5)) out.push({ to: [c, 6], path: [[c, 3], [c, 4], [c, 5]] });
  if (r === 6 && (c === 1 || c === 2 || c === 4 || c === 5)) out.push({ to: [c, 2], path: [[c, 5], [c, 4], [c, 3]] });
  if (r >= 3 && r <= 5) {
    if (c === 0) out.push({ to: [3, r], path: [[1, r], [2, r]] });
    if (c === 3) { out.push({ to: [0, r], path: [[2, r], [1, r]] }); out.push({ to: [6, r], path: [[4, r], [5, r]] }); }
    if (c === 6) out.push({ to: [3, r], path: [[5, r], [4, r]] });
  }
  return out;
}

// pieces: 全部棋子（含阵亡）。返回 [{from:[c,r], to:[c,r]}]，几何+地形+占位合法。
// 注意：战斗合法性只看水陆屏障（攻/守一在水一在陆 → 禁攻），等级差不构成非法 —— 试探靠代价而非报错。
function legalMovesForPiece(pieces, piece) {
  const moves = [];
  if (!piece || !piece.alive) return moves;
  if (isWater(piece.c, piece.r) && piece.rank !== RAT) return moves; // 非鼠不可居水（防御态：不可动）
  const occ = new Map();
  for (const p of pieces) if (p.alive) occ.set(`${p.c},${p.r}`, p);
  const ownDen = DENS[piece.side];
  const pushTarget = (to) => {
    const [tc, tr] = to;
    if (!inBounds(tc, tr)) return;
    if (tc === ownDen[0] && tr === ownDen[1]) return;         // 不入己穴
    const target = occ.get(`${tc},${tr}`);
    if (target && target.side === piece.side) return;          // 己方占位
    if (!target && isWater(tc, tr) && piece.rank !== RAT) return; // 入水仅鼠
    if (target && isWater(piece.c, piece.r) !== isWater(tc, tr)) return; // 水陆屏障：跨界禁攻
    moves.push({ from: [piece.c, piece.r], to: [tc, tr] });
  };
  for (const [dc, dr] of STEP_DIRS) pushTarget([piece.c + dc, piece.r + dr]);
  if (piece.rank === LION || piece.rank === TIGER) {
    for (const jump of jumpLandings(piece.c, piece.r)) {
      if (jump.path.some(([pc, pr]) => occ.has(`${pc},${pr}`))) continue; // 路径有鼠（任何子）阻断
      pushTarget(jump.to);
    }
  }
  return moves;
}
function allLegalMoves(pieces, side) {
  const out = [];
  for (const p of pieces) if (p.alive && p.side === side) out.push(...legalMovesForPiece(pieces, p));
  return out;
}

// The first legal move by slot order, directions up-right-down-left: the move made for a side whose time ran out.
function firstLegalMove(pieces, side) {
  for (const piece of pieces.filter(p => p.alive && p.side === side).sort((a, b) => a.slot - b.slot)) {
    const moves = legalMovesForPiece(pieces, piece);
    if (moves.length) return moves[0];
  }
  return null;
}
function strengthOf(pieces, side) { return pieces.filter(p => p.alive && p.side === side).reduce((s, p) => s + p.rank, 0); }
function cellName([c, r]) { return `${'ABCDEFG'[c] || '?'}${r + 1}`; }

module.exports = {
  COLS, ROWS, TURN_MS, TURN_CAP, DENS, TRAPS, WATERS, SLOTS,
  RAT, CAT, DOG, WOLF, LEOPARD, TIGER, LION, ELEPHANT,
  RANK_NAMES, RANK_EMOJI,
  isWater, trapOwnerAt, inBounds,
  mulberry32, setupRanks, setupJson, setupPayload, buildPieces, setupFor, SETUP_VERSION,
  resolveBattle, jumpLandings, legalMovesForPiece, allLegalMoves, firstLegalMove, strengthOf, cellName,
};
