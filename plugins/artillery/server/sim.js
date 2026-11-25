// SPDX-License-Identifier: Apache-2.0
// plugins/artillery/server/sim.js — 弹道奇兵 · 纯函数物理模拟器（无副作用、无时钟、无随机全局态）
// 契约：同 seed 同风同参数 → 逐 tick 比特级一致（JS double 算术确定；禁 Math.random/Date）。
// 世界坐标系：y 轴向上（地面 y=0），前端渲染时自行翻转屏幕坐标。
//   地形：24 列高度图（整数等级 3..13，1 等级 = 40px），两侧 1/4 处压平炮位平台
//   风序：mulberry32(seed) 独立流派生整数风 -5..+5（每回合一个），开局 sha256(salt|seed) 承诺
//   弹道：固定 dt 步进积分 pos += v*dt; vy -= g*dt; vx += wind*k*dt；与高度图碰撞 → 爆点
//   伤害：<10px 直击 40-55（线性），10-60px 溅射 40→0（线性），self-damage 照算
// 数值推演详见 docs/design/games/弹道奇兵-设计与数值.md
'use strict';

/* ---------- 种子化 RNG（mulberry32，与 lib/games/puzzle/puzzle-templates.js 同源约定） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 世界常量（前端渲染共用同一套比例） ---------- */
const COLS = 24;              // 高度图列数
const LEVELS = 16;            // 垂直等级数
const TILE = 40;              // 1 等级/列宽 = 40px
const WORLD_W = COLS * TILE;  // 960
const WORLD_H = LEVELS * TILE; // 640

const GRAVITY = 320;          // px/s²
const DT = 0.02;              // 固定步长 50Hz
const SPEED_SCALE = 5.6;      // 初速 px/s per 力度点（power 20-100 → 112-560；满力 45° 射程 ≈ 980px ≈ 全图宽）
const WIND_K = 9;             // 风加速度 px/s² per 风级（±5 → ±45）
const MAX_TICKS = 1500;       // 单发最长 30s（防死循环保险）
const POINT_EVERY = 2;        // 每 2 tick 记录一个轨迹点（25Hz）
const MAX_POINTS = 600;       // 单发轨迹点上限

// 炮位平台（两侧 1/4 处压平的列区间）与坦克安放点
const PLATFORM_COLS = [[4, 7], [16, 19]];
const TANK_X = [6 * TILE, 18 * TILE]; // 240 / 720（平台中心）
const TANK_CY = 12;           // 坦克中心离地高（半车高）
const TANK_BODY = 15;         // 弹丸触壳半径（命中壳体立即引爆）
const MUZZLE_FWD = 20;        // 炮口前伸
const MUZZLE_UP = 16;         // 炮口抬升

// 弹药：standard ∞ · triple ×2/队 · heavy ×1/队
const AMMO = {
  standard: { name: '标准弹', spread: 0, speedMult: 1, dmgMult: 1 },
  triple: { name: '三连发', spread: 6, speedMult: 1, dmgMult: 1 },
  heavy: { name: '重锤弹', spread: 0, speedMult: 0.85, dmgMult: 65 / 55 },
};
const DIRECT_R = 10;          // 直击判定半径
const DIRECT_MAX = 55;        // 贴脸伤害
const DIRECT_MIN = 40;        // 直击区外缘伤害
const SPLASH_R = 60;          // 溅射半径（外缘衰减到 0）
const TRIPLE_COUNT = 2;       // 每队 triple 存量
const HEAVY_COUNT = 1;        // 每队 heavy 存量

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- 地形：叠加正弦 + 随机游走，两侧 1/4 压平炮位 ---------- */
function generateTerrain(seed) {
  const rng = mulberry32((seed >>> 0) ^ 0x1F123BB5);
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const amp1 = 2.2 + rng() * 1.6;  // 主波 2.2-3.8 等级
  const amp2 = 0.8 + rng() * 1.0;  // 细波 0.8-1.8 等级
  let walk = 0;
  const heights = [];
  for (let i = 0; i < COLS; i++) {
    walk = walk * 0.78 + (rng() * 2 - 1) * 1.4;
    const h = 7.5
      + amp1 * Math.sin(i * 0.5 + p1)
      + amp2 * Math.sin(i * 1.35 + p2)
      + walk
      + (rng() - 0.5) * 1.2;
    heights.push(Math.max(3, Math.min(13, Math.round(h))));
  }
  // 炮位平台：取区间中位高度整段压平（坦克脚下必须是平的，斜坡上没法摆车）
  for (const [a, b] of PLATFORM_COLS) {
    const seg = heights.slice(a, b + 1).slice().sort((x, y) => x - y);
    const plat = Math.max(4, Math.min(12, seg[Math.floor(seg.length / 2)]));
    for (let i = a; i <= b; i++) heights[i] = plat;
  }
  return heights; // 24 个整数等级
}

/* ---------- 风序：由 seed 独立流派生；承诺 = sha256(salt|seed) ---------- */
const WIND_TURNS = 40; // 与回合上限一致
function windSeqFor(seed, turns = WIND_TURNS) {
  const rng = mulberry32((seed >>> 0) ^ 0x5F356495);
  const seq = [];
  for (let i = 0; i < turns; i++) seq.push(Math.floor(rng() * 11) - 5); // -5..+5 整数
  return seq;
}

/* ---------- 几何 ---------- */
// 地面表面高度（连续 x 线性插值；y-up 世界坐标，px）
function groundYAt(heights, x) {
  const fx = clamp(x, 0, WORLD_W - 0.001) / TILE;
  const i = Math.floor(fx);
  const t = fx - i;
  const j = Math.min(i + 1, COLS - 1);
  return (heights[i] * (1 - t) + heights[j] * t) * TILE;
}
// 坦克中心（y-up）：平台地上 12px
function tankCenter(squadIdx, heights) {
  const x = TANK_X[squadIdx === 1 ? 1 : 0];
  return { x, y: groundYAt(heights, x) + TANK_CY };
}
// 炮口（前伸 + 抬升，保证出膛点不在自己壳体内）
function muzzleOf(center, dir) {
  return { x: center.x + dir * MUZZLE_FWD, y: center.y + MUZZLE_UP };
}
function dist2d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ---------- 伤害曲线（标准/三连 max55 直击；heavy ×65/55） ---------- */
function shellDamage(ammo, dist) {
  const mult = (AMMO[ammo] || AMMO.standard).dmgMult;
  let base = 0;
  if (dist < DIRECT_R) {
    base = DIRECT_MAX - (DIRECT_MAX - DIRECT_MIN) * (dist / DIRECT_R); // 55 → 40
  } else if (dist <= SPLASH_R) {
    base = DIRECT_MIN * (SPLASH_R - dist) / (SPLASH_R - DIRECT_R);     // 40 → 0
  }
  return Math.max(0, Math.round(base * mult));
}

/* ---------- 单发弹道：固定 dt 步进积分，与高度图碰撞 → 爆点 ---------- */
// opts: { heights, wind, from:{x,y}, angleDeg, power, dir(+1右/-1左), ammo }
function simulateShot(opts) {
  const { heights, wind, from, angleDeg, power, dir } = opts;
  const ammo = AMMO[opts.ammo] ? opts.ammo : 'standard';
  const spec = AMMO[ammo];
  const v0 = clamp(Number(power) || 0, 0, 200) * SPEED_SCALE * spec.speedMult;
  const rad = (Number(angleDeg) || 0) * Math.PI / 180;
  const tanks = Array.isArray(opts.tanks) ? opts.tanks : []; // [{key, x, y}] 壳体碰撞检测
  const w = clamp(Math.round(Number(wind) || 0), -5, 5);
  let x = from.x, y = from.y;
  let vx = Math.cos(rad) * v0 * (dir >= 0 ? 1 : -1);
  let vy = Math.sin(rad) * v0;
  const points = [{ x: r1(x), y: r1(y) }];
  let impact = null;
  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    vy -= GRAVITY * DT;        // 重力
    vx += w * WIND_K * DT;     // 风（水平加速度）
    x += vx * DT;              // pos += v*dt
    y += vy * DT;
    // 触壳：撞上任意坦克本体 → 原地引爆
    for (const t of tanks) {
      if (dist2d({ x, y }, t) <= TANK_BODY) { impact = { x: r1(x), y: r1(y) }; break; }
    }
    if (impact) break;
    // 飞出地图侧边界：按脱靶处理（爆点记在边界，伤害自然为 0）
    if (x < -2 * TILE || x > WORLD_W + 2 * TILE) {
      impact = { x: r1(clamp(x, -2 * TILE, WORLD_W + 2 * TILE)), y: r1(y), out: true };
      break;
    }
    // 触地：爆点吸附到地表
    const gy = groundYAt(heights, x);
    if (y <= gy) { impact = { x: r1(x), y: r1(gy) }; break; }
    // 冲出天顶（几乎不可能，保险）
    if (y > WORLD_H * 6) { impact = { x: r1(x), y: r1(WORLD_H * 6), out: true }; break; }
    if (tick % POINT_EVERY === 0 && points.length < MAX_POINTS) {
      points.push({ x: r1(x), y: r1(y) });
    }
  }
  if (!impact) impact = { x: r1(x), y: r1(y), out: true };
  if (points[points.length - 1].x !== impact.x || points[points.length - 1].y !== impact.y) {
    if (points.length < MAX_POINTS) points.push({ x: impact.x, y: impact.y });
  }
  return { points, impact, ammo, wind: w };
}

/* ---------- 整轮齐射：standard/heavy 1 发；triple 三连扇形 ±6°（每发独立结算伤害） ---------- */
// opts: { heights, tanks:{[key]:{x,y}}, shooterKey, dir, angleDeg, power, ammo, wind }
// 返回 { shots:[{angleDeg, from, points, impact, wind}], hits:[{team,damage,x,y}], dmgByTeam:{[key]:n} }
function resolveVolley(opts) {
  const { heights, shooterKey, dir, angleDeg, power, ammo } = opts;
  const key = AMMO[ammo] ? ammo : 'standard';
  const spec = AMMO[key];
  const tankList = Object.entries(opts.tanks || {}).map(([k, v]) => ({ key: k, x: v.x, y: v.y }));
  const shooter = tankList.find(t => t.key === shooterKey);
  if (!shooter) throw new Error('shooter tank not found');
  const from = muzzleOf(shooter, dir >= 0 ? 1 : -1);
  const baseAngle = clamp(Number(angleDeg) || 0, 0, 90);
  const angles = spec.spread > 0
    ? [baseAngle - spec.spread, baseAngle, baseAngle + spec.spread] // 三连扇形 ±6°
    : [baseAngle];
  const shots = [];
  const hits = [];
  const dmgByTeam = {};
  for (const ang of angles) {
    const sim = simulateShot({
      heights, wind: opts.wind, from, angleDeg: ang, power, dir, ammo: key,
      tanks: tankList.filter(t => t.key !== shooterKey), // 出膛瞬间不与炮手自身壳体碰撞
    });
    shots.push({ angleDeg: ang, from: { x: r1(from.x), y: r1(from.y) }, points: sim.points, impact: sim.impact, wind: sim.wind, ammo: key });
    if (!sim.impact.out) {
      for (const t of tankList) { // self-damage 照算：打自己脚 = 真扣
        const d = shellDamage(key, dist2d(sim.impact, t));
        if (d > 0) {
          hits.push({ team: t.key, damage: d, x: sim.impact.x, y: sim.impact.y });
          dmgByTeam[t.key] = (dmgByTeam[t.key] || 0) + d;
        }
      }
    }
  }
  return { shots, hits, dmgByTeam };
}

/* ---------- 快照指纹（测试用：轨迹确定性校验） ---------- */
function fingerprint(obj) {
  return JSON.stringify(obj);
}

module.exports = {
  mulberry32, generateTerrain, windSeqFor,
  groundYAt, tankCenter, muzzleOf, dist2d, shellDamage,
  simulateShot, resolveVolley, fingerprint,
  COLS, LEVELS, TILE, WORLD_W, WORLD_H, GRAVITY, DT, SPEED_SCALE, WIND_K,
  DIRECT_R, DIRECT_MAX, DIRECT_MIN, SPLASH_R, TANK_X, TANK_CY, TANK_BODY,
  PLATFORM_COLS, AMMO, TRIPLE_COUNT, HEAVY_COUNT, WIND_TURNS,
};
