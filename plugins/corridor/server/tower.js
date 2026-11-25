// SPDX-License-Identifier: Apache-2.0
// plugins/corridor/server/tower.js — Endless Corridor's daily tower, pure and public: the day's seed (FNV-1a of the
// date → mulberry32), each part's seed, the eight-floor tower and the three-floor sprint. Anyone can rebuild a day's
// tower offline; only the salts of the per-part commitments come from the match (`salt()`), hashed by `sha256`
// (ctx.sha256 in the plugin, Node crypto on the platform). lib/games/corridor/corridor.js reads seedOfDay for the
// ladder. The puzzles themselves are the plugin kit's templates.
'use strict';
const templates = require('@aiatt/plugin-kit/puzzle-templates');
const SPRINT_FLOOR_PLAN = Object.freeze([
  Object.freeze({ kind: 'lights', label: '镜像起跑线', template: 'lights', params: { size: 4, clicks: 4 } }),
  Object.freeze({ kind: 'pipes', label: '双生水脉', template: 'pipes', params: { cols: 4, rows: 4, branches: 2 } }),
  Object.freeze({ kind: 'cipher', label: '同步密码厅', template: 'cipher', params: { length: 5, colors: 5 } }),
]);
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 同日全球同塔：日期字符串 → FNV-1a → mulberry32 派生塔种子 [1, 2^31-1]
function seedOfDay(dayStr) {
  let h = 2166136261 >>> 0;
  const s = 'corridor|' + dayStr;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const rng = mulberry32(h);
  return 1 + Math.floor(rng() * 2147483646);
}
const CURSED_POOL = Object.freeze([
  Object.freeze({ template: 'lights', params: { size: 5, clicks: 8 } }),
  Object.freeze({ template: 'pipes', params: { cols: 6, rows: 5, branches: 3 } }),
  Object.freeze({ template: 'cipher', params: { length: 6, colors: 7 } }),
]);
function partSeed(towerSeed, floorIdx, partIdx) {
  const rng = mulberry32((towerSeed ^ Math.imul(floorIdx + 1, 0x9E3779B9) ^ Math.imul(partIdx + 1, 0x85EBCA6B)) >>> 0);
  return 1 + Math.floor(rng() * 2147483646);
}
// One puzzle of a floor: generated from its seed (solvable by the templates' construction), its solution committed.
function part(template, params, seed, { salt, sha256 }) {
  const puzzle = templates.generate(template, params, seed), s = salt();
  return {
    template, params, seed,
    difficulty: puzzle.difficulty, meta: puzzle.meta,
    board: puzzle.board,           // 公开初态（随层进入投影）
    solution: puzzle.solution,     // 私密：仅层通过后随 reveal 公开
    hints: puzzle.hints,           // 私密：提示券逐条转公开
    salt: s, commitHash: sha256(s + '|' + JSON.stringify(puzzle.solution)),
  };
}
function buildTower(dayStr, { salt, sha256 }) {
  const towerSeed = seedOfDay(dayStr);
  const pickRng = mulberry32((towerSeed ^ 0xC0FFEE) >>> 0);
  const cursed = CURSED_POOL[Math.floor(pickRng() * CURSED_POOL.length)];
  const plans = [
    { kind: 'lights', label: '微光门厅', template: 'lights', params: { size: 3, clicks: 2 } },
    { kind: 'pipes', label: '水脉回廊', template: 'pipes', params: { cols: 3, rows: 3, branches: 1 } },
    { kind: 'cipher', label: '密码暗室', template: 'cipher', params: { length: 4, colors: 5 } },
    { kind: 'lights', label: '千灯长阶', template: 'lights', params: { size: 4, clicks: 4 } },
    { kind: 'pipes', label: '九曲管廊', template: 'pipes', params: { cols: 4, rows: 4, branches: 2 } },
    { kind: 'cipher', label: '双锁密码厅', template: 'cipher', params: { length: 5, colors: 6 } },
    { kind: 'mixed', label: '双重回廊', parts: [
      { template: 'lights', params: { size: 4, clicks: 3 } },
      { template: 'pipes', params: { cols: 3, rows: 4, branches: 1 } },
    ] },
    { kind: 'cursed', label: '诅咒之巅', template: cursed.template, params: { ...cursed.params } },
  ];
  const floors = plans.map((plan, i) => {
    const defs = plan.parts || [{ template: plan.template, params: plan.params }];
    const parts = defs.map((def, j) => {
      const seed = partSeed(towerSeed, i, j);
      return part(def.template, def.params, seed, { salt, sha256 });
    });
    return { index: i, kind: plan.kind, label: plan.label, parts };
  });
  return { day: dayStr, seed: towerSeed, floors };
}

function buildSprintTower(dayStr, { salt, sha256 }) {
  const towerSeed = seedOfDay(dayStr);
  const floors = SPRINT_FLOOR_PLAN.map((plan, i) => {
    const seed = partSeed(towerSeed, i, 0);
    return { index: i, kind: plan.kind, label: plan.label, parts: [part(plan.template, plan.params, seed, { salt, sha256 })] };
  });
  return { day: dayStr, seed: towerSeed, floors };
}

function cloneBoard(b) {
  if (!b) return b;
  const out = { ...b };
  if (b.cells) out.cells = b.cells.slice();
  if (b.rots) out.rots = b.rots.slice();
  if (b.masks) out.masks = b.masks.slice();
  if (b.guesses) out.guesses = b.guesses.map(g => ({ ...g, seq: g.seq.slice() }));
  return out;
}
module.exports = { SPRINT_FLOOR_PLAN, CURSED_POOL, mulberry32, seedOfDay, partSeed, buildTower, buildSprintTower, cloneBoard };
