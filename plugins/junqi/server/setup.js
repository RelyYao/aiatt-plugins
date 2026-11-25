// SPDX-License-Identifier: Apache-2.0
// plugins/junqi/server/setup.js — Junqi's deployment, pure: each side's 25 pieces shuffled within the legal
// constraints from a seed (mulberry32; the flag in a headquarters, mines on the back two rows, bombs off the front
// row), the pieces on the board, the text the published commitment hashes, and the move made for a side whose time
// ran out. The plugin (./index.js) deals with it; lib/games/junqi/junqi.js reads it to check the revealed setup.
'use strict';
const M = require('./map');
const SIDE1_SEED_SALT = 0x9e3779b9; // side1 布阵种子派生异或常量（双方布置独立，防镜像泄旗位）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* ---------- 布阵（约束内洗置，确定性） ---------- */
// 单方布置：返回长度 25 的数组（SLOTS 序 → 等级）。约束按构造满足：
//   ① 军旗落在两个大本营之一；② 3 颗地雷全部落在后两排（lr 5-6，可含另一个大本营）；
//   ③ 2 颗炸弹不在第一排（lr ≠ 1）；④ 其余 19 子 Fisher-Yates 洗入剩余格；5 行营恒空。
function setupLayout(rng) {
  const assign = new Array(M.SLOTS.length).fill(null);
  const taken = new Set();
  // ① 军旗 → 大本营（种子选左/右）
  const hqSlots = M.HQ_SLOT_INDEXES;
  const flagSlot = hqSlots[Math.floor(rng() * hqSlots.length)];
  assign[flagSlot] = M.JUNQI;
  taken.add(flagSlot);
  // ② 地雷 ×3 → 后两排（lr 5-6，跳过军旗格）
  const minePool = [];
  M.SLOTS.forEach((s, i) => { if (s.lr >= 5 && !taken.has(i)) minePool.push(i); });
  for (let k = 0; k < 3; k++) {
    const pick = Math.floor(rng() * minePool.length);
    const slot = minePool.splice(pick, 1)[0];
    assign[slot] = M.DILEI;
    taken.add(slot);
  }
  // ③ 炸弹 ×2 → 非第一排（lr ≠ 1）
  const bombPool = [];
  M.SLOTS.forEach((s, i) => { if (s.lr !== 1 && !taken.has(i)) bombPool.push(i); });
  for (let k = 0; k < 2; k++) {
    const pick = Math.floor(rng() * bombPool.length);
    const slot = bombPool.splice(pick, 1)[0];
    assign[slot] = M.ZHADAN;
    taken.add(slot);
  }
  // ④ 其余 19 子洗入剩余格
  const rest = [];
  for (const [rank, count] of M.RANK_COUNTS) {
    if (rank === M.JUNQI || rank === M.DILEI || rank === M.ZHADAN) continue;
    for (let i = 0; i < count; i++) rest.push(rank);
  }
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  let ri = 0;
  for (let i = 0; i < assign.length; i++) if (assign[i] === null) assign[i] = rest[ri++];
  return assign;
}
function sideSeed(seed, side) { return (seed ^ (side === 0 ? 0x01234567 : SIDE1_SEED_SALT)) >>> 0; }
function layoutsFor(seed) {
  return {
    0: setupLayout(mulberry32(sideSeed(seed, 0))),
    1: setupLayout(mulberry32(sideSeed(seed, 1))),
  };
}
function layoutsJson(layouts) { return JSON.stringify({ s0: layouts[0], s1: layouts[1] }); }

function buildPieces(layouts) {
  const pieces = [];
  for (const side of [0, 1]) {
    M.SLOTS.forEach((slot, slotIdx) => {
      const [c, r] = M.toGlobal(side, slot.c, slot.lr);
      pieces.push({
        id: `${side === 0 ? 'b' : 'r'}${slotIdx}`, side, slot: slotIdx,
        rank: layouts[side][slotIdx], c, r, alive: true,
      });
    });
  }
  return pieces;
}

/* ---------- 布阵约束自检（开局兜底：约束违反拒绝开局） ---------- */
function layoutValid(layout) {
  const flagSlots = [], mineSlots = [], bombSlots = [];
  layout.forEach((rank, i) => {
    if (rank === M.JUNQI) flagSlots.push(i);
    if (rank === M.DILEI) mineSlots.push(i);
    if (rank === M.ZHADAN) bombSlots.push(i);
  });
  if (flagSlots.length !== 1 || !M.HQ_SLOT_INDEXES.includes(flagSlots[0])) return false;
  if (mineSlots.length !== 3 || mineSlots.some(i => M.SLOTS[i].lr < 5)) return false;
  if (bombSlots.length !== 2 || bombSlots.some(i => M.SLOTS[i].lr === 1)) return false;
  return true;
}

// 超时托管：确定性取首个「非自杀」合法步（棋子按槽位序 × 走法按生成序）；非自杀 = 空移或必胜交换（不撞更大子、
// 不触雷、不做对穿）；全盘无非自杀步时退而取首个合法步（决不弃权）。
function timeoutMove(pieces, side) {
  const own = pieces.filter(p => p.alive && p.side === side).sort((a, b) => a.slot - b.slot);
  const safe = (piece, mv) => { const target = pieces.find(p => p.alive && p.c === mv.to[0] && p.r === mv.to[1]); return !target || M.resolveBattle(piece.rank, target.rank) === 'capture'; };
  const pick = filter => { for (const piece of own) for (const mv of M.legalMovesForPiece(pieces, piece)) if (filter(piece, mv)) return mv; return null; };
  return pick(safe) || pick(() => true);
}

module.exports = { SIDE1_SEED_SALT, mulberry32, setupLayout, sideSeed, layoutsFor, layoutsJson, buildPieces, layoutValid, timeoutMove };
