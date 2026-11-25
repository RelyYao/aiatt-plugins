// SPDX-License-Identifier: Apache-2.0
// plugins/junqi/server/map.js — 军棋棋盘拓扑与判定表（纯函数、零状态；插件与 lib/games/junqi/junqi.js、测试共同引用）
// 棋盘：每方 6 排 × 5 列，双方镜像拼成 12 排 × 5 列竖盘（global c∈0..4, r∈0..11，r=0 顶）。
// side0 = 蓝方（下方 r6-11，先手）；side1 = 红方（上方 r0-5）。
// 局地坐标 (c, lr)：c 1..5（己方视角左→右），lr 1..6（1=前线 … 6=后排大本营行）。
//   side0: global = [c-1, 5+lr]   side1: global = [5-c, 6-lr]（列翻转 = 180° 旋转镜像）
// 特殊格：行营×5/方（第2排 (2,2)(4,2)、第3排 (3,3)、第4排 (2,4)(4,4)）、大本营×2/方（末排 (2,6)(4,6)）。
// 线路：
//   公路 —— 每行横向相邻；纵向相邻（1-2/2-3/3-4/4-5 排间；第 5-6 排间仅有纵向无斜线）；
//           中界 B/C/D 列直通；行营 4 条斜线（斜线只存在于第 1-5 排间 → 行营恰 8 邻）。
//   铁路 —— 双方前线（lr=1）与第 5 排（lr=5）横向全长 + 两侧第 1、5 列（c=1/5）纵向贯通
//           （含中界 A/E 列直通）。非工兵直线任意滑行（路径无阻挡），工兵可沿铁路网拐弯。
'use strict';

const COLS = 5, ROWS = 12, SIDE_ROWS = 6;

/* ---------- 等级与判定表常量 ---------- */
const SILING = 40, JUNZHANG = 39, SHIZHANG = 38, LVZHANG = 37, TUANZHANG = 36,
  YINGZHANG = 35, LIANZHANG = 34, PAIZHANG = 33, GONGBING = 32,
  JUNQI = 0, ZHADAN = 98, DILEI = 99; // 98/99 永不进入等级比较（判定表短路处理）

const RANK_NAMES = {
  40: '司令', 39: '军长', 38: '师长', 37: '旅长', 36: '团长', 35: '营长',
  34: '连长', 33: '排长', 32: '工兵', 0: '军旗', 98: '炸弹', 99: '地雷',
};
// 每方 25 子的固定清单（等级 → 数量）
const RANK_COUNTS = [
  [SILING, 1], [JUNZHANG, 1], [SHIZHANG, 2], [LVZHANG, 2], [TUANZHANG, 2],
  [YINGZHANG, 2], [LIANZHANG, 3], [PAIZHANG, 3], [GONGBING, 3],
  [DILEI, 3], [ZHADAN, 2], [JUNQI, 1],
];
// 封盘结算子力值：常规子=等级；炸弹 36、地雷 37（略高于团长/旅长，未挖的雷是真实威慑）；军旗 0
function pieceValue(rank) {
  if (rank === ZHADAN) return 36;
  if (rank === DILEI) return 37;
  return rank || 0;
}

/* ---------- 坐标 ---------- */
function inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }
function toGlobal(side, c, lr) { return side === 0 ? [c - 1, 5 + lr] : [5 - c, 6 - lr]; }
const key = (c, r) => `${c},${r}`;
const parseKey = (k) => k.split(',').map(Number);

/* ---------- 特殊格（global） ---------- */
const HQ_LOCAL = [[2, 6], [4, 6]];
const CAMP_LOCAL = [[2, 2], [4, 2], [3, 3], [2, 4], [4, 4]];
const HQS = { 0: HQ_LOCAL.map(([c, lr]) => toGlobal(0, c, lr)), 1: HQ_LOCAL.map(([c, lr]) => toGlobal(1, c, lr)) };
const CAMPS = [];
for (const side of [0, 1]) for (const [c, lr] of CAMP_LOCAL) CAMPS.push(toGlobal(side, c, lr));

const CAMP_SET = new Set(CAMPS.map(([c, r]) => key(c, r)));
const HQ_OWNER = new Map(); // "c,r" → side
for (const side of [0, 1]) for (const [c, r] of HQS[side]) HQ_OWNER.set(key(c, r), side);

function isCamp(c, r) { return CAMP_SET.has(key(c, r)); }
function hqOwnerAt(c, r) { return HQ_OWNER.get(key(c, r)); } // undefined → 非 HQ

/* ---------- 线路（global 无向边） ---------- */
const ROAD_EDGES = [];
const RAIL_EDGES = [];
(function buildEdges() {
  // 公路：12 行横向全长
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 1; c++) ROAD_EDGES.push([[c, r], [c + 1, r]]);
  // 公路：纵向（半场内第 1-5 排间全 5 列；第 5-6 排间只有纵向、无斜线）
  for (const r of [0, 1, 2, 3, 4, 6, 7, 8, 9, 10]) for (let c = 0; c < COLS; c++) ROAD_EDGES.push([[c, r], [c, r + 1]]);
  // 公路：中界 B/C/D 列直通（A/E 列归铁路）
  for (const c of [1, 2, 3]) ROAD_EDGES.push([[c, 5], [c, 6]]);
  // 公路：斜线（只在第 1-5 排间 → 行营恰 8 邻；大本营行无斜线）
  for (const r of [1, 2, 3, 4, 6, 7, 8, 9]) {
    for (let c = 0; c < COLS - 1; c++) {
      ROAD_EDGES.push([[c, r], [c + 1, r + 1]]);
      ROAD_EDGES.push([[c + 1, r], [c, r + 1]]);
    }
  }
  // 铁路：双方前线（r5/r6）与第 5 排（r1/r10）横向全长
  for (const r of [1, 5, 6, 10]) for (let c = 0; c < COLS - 1; c++) RAIL_EDGES.push([[c, r], [c + 1, r]]);
  // 铁路：两侧第 1、5 列（global c=0/4）纵向贯通（含中界直通）
  for (const c of [0, 4]) {
    for (let r = 1; r <= 4; r++) RAIL_EDGES.push([[c, r], [c, r + 1]]);   // side1 lr1-5
    for (let r = 6; r <= 9; r++) RAIL_EDGES.push([[c, r], [c, r + 1]]);   // side0 lr1-5
  }
  RAIL_EDGES.push([[0, 5], [0, 6]]);
  RAIL_EDGES.push([[4, 5], [4, 6]]);
})();

function edgeKeys(a, b) { return `${key(a[0], a[1])}|${key(b[0], b[1])}`; }
function pairKey(a, b) {
  const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
const RAIL_EDGE_SET = new Set(RAIL_EDGES.map(([a, b]) => pairKey(a, b)));
const ROAD_EDGE_SET = new Set(ROAD_EDGES.map(([a, b]) => pairKey(a, b)));
function hasRailEdge(a, b) { return RAIL_EDGE_SET.has(pairKey(a, b)); }
function hasRoadEdge(a, b) { return ROAD_EDGE_SET.has(pairKey(a, b)); }

function buildAdj(edges) {
  const adj = new Map();
  for (const [a, b] of edges) {
    const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push([b[0], b[1]]);
    adj.get(kb).push([a[0], a[1]]);
  }
  return adj;
}
const ROAD_ADJ = buildAdj(ROAD_EDGES);
const RAIL_ADJ = buildAdj(RAIL_EDGES);

/* ---------- 布阵槽位（local，固定模板） ---------- */
// 25 个非行营格：lr1×5 + lr2×3 + lr3×4 + lr4×3 + lr5×5 + lr6×5（(2,6)(4,6) 为大本营）
const SLOTS = [];
(function buildSlots() {
  const rows = [
    [1, 2, 3, 4, 5],
    [1, 3, 5],
    [1, 2, 4, 5],
    [1, 3, 5],
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5],
  ];
  rows.forEach((cols, i) => {
    for (const c of cols) {
      const lr = i + 1;
      const isHq = lr === 6 && (c === 2 || c === 4);
      SLOTS.push({ c, lr, kind: isHq ? 'hq' : 'normal' });
    }
  });
})();
const HQ_SLOT_INDEXES = SLOTS.map((s, i) => (s.kind === 'hq' ? i : -1)).filter(i => i >= 0); // [21, 23]

/* ---------- 判定表（确定性，平台当裁判；返回 'capture'|'both'|'sacrifice'） ---------- */
// 按序短路：
//   1. 任一方为炸弹 → 同归于尽（含炸弹碰地雷）；
//   2. 守方为地雷 → 工兵挖雷（守亡攻存）；其余攻方触雷阵亡（雷存）；
//   3. 攻方等级 > 守方 → 守亡攻占；= → 同归于尽；< → 攻亡守存。
function resolveBattle(atkRank, defRank) {
  if (atkRank === ZHADAN || defRank === ZHADAN) return 'both';
  if (defRank === DILEI) return atkRank === GONGBING ? 'capture' : 'sacrifice';
  if (atkRank > defRank) return 'capture';
  if (atkRank === defRank) return 'both';
  return 'sacrifice';
}

/* ---------- 走子生成（纯几何 + 拓扑 + 庇护/冻结；等级只用于工兵分支，不泄漏给公开面） ---------- */
// pieces: 全部棋子（含阵亡）。返回 [{from:[c,r], to:[c,r]}]，确定性枚举序。
function legalMovesForPiece(pieces, piece) {
  const out = [];
  if (!piece || !piece.alive) return out;
  if (piece.rank === DILEI) return out;                 // 地雷不可移动
  if (hqOwnerAt(piece.c, piece.r) !== undefined) return out; // 大本营内进子后不可再动
  const occ = new Map();
  for (const p of pieces) if (p.alive) occ.set(key(p.c, p.r), p);
  const from = [piece.c, piece.r];
  const seen = new Set();
  const push = (tc, tr) => {
    const k = key(tc, tr);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ from, to: [tc, tr] });
  };
  const tryTarget = (tc, tr) => {
    if (!inBounds(tc, tr)) return;
    const t = occ.get(key(tc, tr));
    if (t && t.side === piece.side) return;              // 己方占位
    if (t && CAMP_SET.has(key(tc, tr))) return;          // 行营庇护：不可被攻击
    push(tc, tr);
  };
  // 1) 公路一步（含行营斜线）
  for (const [nc, nr] of (ROAD_ADJ.get(key(piece.c, piece.r)) || [])) tryTarget(nc, nr);
  // 2) 铁路
  const railHere = RAIL_ADJ.has(key(piece.c, piece.r)) && (RAIL_ADJ.get(key(piece.c, piece.r)) || []).length > 0;
  if (railHere) {
    if (piece.rank === GONGBING) {
      // 工兵：沿铁路网任意连通可达（路径无子阻挡；BFS 只穿越空格）
      const visited = new Set([key(piece.c, piece.r)]);
      const queue = [key(piece.c, piece.r)];
      while (queue.length) {
        const cur = queue.shift();
        for (const [nc, nr] of (RAIL_ADJ.get(cur) || [])) {
          const nk = key(nc, nr);
          const t = occ.get(nk);
          if (!t) {
            if (!visited.has(nk)) { visited.add(nk); push(nc, nr); queue.push(nk); }
          } else if (t.side !== piece.side && !CAMP_SET.has(nk)) {
            push(nc, nr); // 铁路端点攻击
          }
        }
      }
    } else {
      // 非工兵：直线任意滑行（路径无子阻挡；不可拐弯）
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        let cc = piece.c, cr = piece.r;
        while (true) {
          const nc = cc + dc, nr = cr + dr;
          if (!hasRailEdge([cc, cr], [nc, nr])) break;
          const t = occ.get(key(nc, nr));
          if (!t) { push(nc, nr); cc = nc; cr = nr; continue; }
          if (t.side !== piece.side && !CAMP_SET.has(key(nc, nr))) push(nc, nr);
          break;
        }
      }
    }
  }
  return out;
}

function allLegalMoves(pieces, side) {
  const out = [];
  for (const p of pieces) if (p.alive && p.side === side) out.push(...legalMovesForPiece(pieces, p));
  return out;
}

// 场上剩余子力（封盘结算用）
function strengthOf(pieces, side) {
  return pieces.filter(p => p.alive && p.side === side).reduce((s, p) => s + pieceValue(p.rank), 0);
}

// 军旗棋子（给定方）
function flagOf(pieces, side) { return pieces.find(p => p.side === side && p.rank === JUNQI) || null; }

// 走子记录坐标名（A1 左下起，r11=第 1 行 … r0=第 12 行）
function cellName([c, r]) { return `${'ABCDE'[c] || '?'}${ROWS - r}`; }

module.exports = {
  COLS, ROWS, SIDE_ROWS,
  SILING, JUNZHANG, SHIZHANG, LVZHANG, TUANZHANG, YINGZHANG, LIANZHANG, PAIZHANG, GONGBING,
  JUNQI, ZHADAN, DILEI,
  RANK_NAMES, RANK_COUNTS, pieceValue,
  HQS, CAMPS, HQ_LOCAL, CAMP_LOCAL, SLOTS, HQ_SLOT_INDEXES,
  ROAD_EDGES, RAIL_EDGES, ROAD_ADJ, RAIL_ADJ, RAIL_EDGE_SET,
  inBounds, toGlobal, key, parseKey, isCamp, hqOwnerAt, hasRailEdge,
  resolveBattle, legalMovesForPiece, allLegalMoves, strengthOf, flagOf, cellName,
};
