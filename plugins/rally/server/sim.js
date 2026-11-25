// SPDX-License-Identifier: Apache-2.0
// plugins/rally/server/sim.js — 拉力领航 · 纯函数赛道/天气/段结算模拟器（无副作用、无时钟、无随机全局态）
// 契约：同 seed 同参数 → 逐位一致（JS double 算术确定；禁 Math.random/Date）。
// 世界观（WRC 式分段拉力，回合制平台承载）：
//   赛道：mulberry32(trackSeed ^ 0xA11) 独立流——6-9 段，每段 {路面, 弯道半径等级 0-5, 坡度 -3..+3, 跳台}；
//         第 ⌊N/2⌋ 段为维修段（强制平缓：弯道等级 ≥3、坡度 |g|≤1、无跳台）。
//   天气：mulberry32(weatherSeed ^ 0x5AA) 预报流（每段一值 干燥/雨/雪，开局全员公开）+
//         mulberry32(weatherSeed ^ 0xD3VA) 偏差流（每段 20% 概率翻转到下一档：干→雨→雪→干）——
//         实况 = 预报 XOR 偏差位，约 80% 准；开局公布 sha256(salt|weatherSeed) 承诺，实况逐段揭示。
//   结算：time = base(路面,天气,弯,坡,跳) × riskFactor(effDial) − setupBonus(调校匹配)
//          + noise(noiseDraw × span(effDial)) + mishap 罚时 + repairPenalty；
//         mishap：spin（弯道失控）/ jumpCrash（跳台砸车），罚时+损伤；极限磨损按拨盘累计。
//   噪声矩阵：mulberry32(trackSeed ^ 0xDEC1DE) 预生成 [seg][squad] × {noise,spinDraw,crashDraw}，
//         与动作先后序无关——两车组谁先提交都不影响对方结果（纯确定性）。
// 数值推演详见 docs/design/games/拉力领航-设计与数值.md
'use strict';

/* ---------- 种子化 RNG（mulberry32，与 lib/games/artillery/artillery-sim.js 同源约定） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 数值表（前端预算带缓存同一套常量，见 public/game-rally.js RALLY_TABLE） ---------- */
const SEG_MIN = 6, SEG_MAX = 9;
const SEGMENT_MS = 45 * 1000;   // 每段 45s 惰性结算

// 路面：base 基础秒数（干燥/直道/满弯级参考），grip 抓地基数（0-1）
const SURFACES = {
  tarmac: { key: 'tarmac', name: '柏油', base: 92, grip: 0.92, icon: '🛣️' },
  gravel: { key: 'gravel', name: '砂石', base: 104, grip: 0.78, icon: '🪨' },
  snow: { key: 'snow', name: '雪地', base: 118, grip: 0.60, icon: '❄️' },
};
// 天气：mult 时间乘数，grip 附加抓地系数
const WEATHERS = {
  dry: { key: 'dry', name: '干燥', mult: 1.00, grip: 1.00, icon: '☀️' },
  rain: { key: 'rain', name: '雨', mult: 1.06, grip: 0.88, icon: '🌧️' },
  snow: { key: 'snow', name: '雪', mult: 1.12, grip: 0.72, icon: '🌨️' },
};
const WEATHER_KEYS = ['dry', 'rain', 'snow']; // 偏差翻转顺序：干→雨→雪→干
const DEVIATE_P = 0.20;        // 实况偏离预报概率（约 80% 准）

const CURVE_TIME = [1.18, 1.14, 1.10, 1.06, 1.03, 1.00]; // 弯道半径等级 0(发夹)→5(近直)
const GRADE_K = 0.02;          // 坡度每级 ±2%（+3 上坡 +6% / -3 下坡 -6%）
const JUMP_MULT = 1.10;        // 有跳台段 ×1.10

// 风险拨盘 → 时间因子：0 = 保守 ×1.12（慢而稳），100 = 激进 ×0.90（快而险）
const RISK_HI = 1.12, RISK_SPAN = 0.22;
// 噪声：noiseDraw ∈ [-1,1] × span(effDial)；span = 2.0 + 0.06·effDial（拨盘越大方差越大）
const NOISE_BASE = 2.0, NOISE_K = 0.06;

// 事故：spin 弯道失控 / jumpCrash 跳台砸车
const SPIN_TIME = 10, SPIN_DMG = 16;
const CRASH_TIME = 30, CRASH_DMG = 35;
const SPIN_CAP = 0.50;
const JUMP_RISK_START = 70;    // 拨盘 <70 跳台稳过
const JUMP_CRASH_SPAN = 0.009; // (effDial-70)×0.009 → limit 档 0.27

// 损伤与维修
const WEAR_THRESHOLD = 60;     // >60 → 全段基础时间 ×1.15
const DMG_TIME_MULT = 1.15;
const WEAR_K = 0.10;           // 极限磨损：max(0, effDial-60)×0.10/段（拨盘 100 → +4/段）
const REPAIR_AMOUNT = 40;      // 维修量（常量，规格指定）
const REPAIR_PENALTY = 20;     // 非维修段修车罚时

// 调校匹配：每参数最多 3.5s，|v-ideal|×0.1 线性衰减（≥35 全无）
const TUNE_BONUS_MAX = 3.5, TUNE_FALL_OFF = 0.1;
const TIRE_IDEAL = { tarmac: 68, gravel: 46, snow: 28 };
const TIRE_WEATHER_ADJ = { dry: 0, rain: -8, snow: -12 };

// 驾驶风格：shift 叠加到拨盘（clamp 0-100），acc 事故率乘数
const STYLE = {
  steady: { key: 'steady', name: '稳健', shift: 0, acc: 0.85 },
  push: { key: 'push', name: '进取', shift: 8, acc: 1.00 },
  limit: { key: 'limit', name: '搏命', shift: 20, acc: 1.25 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- 赛道生成（确定性） ---------- */
function generateTrack(trackSeed) {
  const rng = mulberry32((trackSeed >>> 0) ^ 0xA11);
  const n = SEG_MIN + Math.floor(rng() * (SEG_MAX - SEG_MIN + 1)); // 6..9
  const segments = [];
  for (let i = 0; i < n; i++) {
    const sr = rng();
    const surface = sr < 0.38 ? 'tarmac' : sr < 0.75 ? 'gravel' : 'snow';
    const curve = Math.floor(rng() * 6);            // 0..5
    const grade = Math.floor(rng() * 7) - 3;        // -3..+3
    const jump = rng() < 0.22;
    segments.push({ surface, curve, grade, jump, service: false });
  }
  // 维修段：第 ⌊N/2⌋ 段（0 基），强制平缓好修车
  const svc = Math.floor(n / 2);
  const s = segments[svc];
  s.service = true; s.jump = false;
  if (s.curve < 3) s.curve = 3 + Math.floor(rng() * 3); // 3..5
  s.grade = Math.max(-1, Math.min(1, s.grade));
  return { segCount: n, segments, serviceIdx: svc };
}

/* ---------- 天气序列：预报（公开）+ 实况（预报 XOR 偏差位，逐段揭示） ---------- */
function weatherForecast(weatherSeed, segCount) {
  const rng = mulberry32((weatherSeed >>> 0) ^ 0x5AA);
  const seq = [];
  for (let i = 0; i < segCount; i++) seq.push(WEATHER_KEYS[Math.floor(rng() * 3)]);
  return seq;
}
function weatherDeviations(weatherSeed, segCount) {
  const rng = mulberry32((weatherSeed >>> 0) ^ 0xD3CA);
  const bits = [];
  for (let i = 0; i < segCount; i++) bits.push(rng() < DEVIATE_P ? 1 : 0);
  return bits;
}
function weatherActual(weatherSeed, segCount) {
  const fc = weatherForecast(weatherSeed, segCount);
  const dev = weatherDeviations(weatherSeed, segCount);
  return fc.map((w, i) => dev[i] ? WEATHER_KEYS[(WEATHER_KEYS.indexOf(w) + 1) % 3] : w);
}

/* ---------- 噪声矩阵：[seg][squad] = {noise, spinDraw, crashDraw}（与提交顺序无关） ---------- */
function noiseMatrix(trackSeed, segCount, squadCount = 2) {
  const rng = mulberry32((trackSeed >>> 0) ^ 0xDEC1DE);
  const m = [];
  for (let i = 0; i < segCount; i++) {
    const row = [];
    for (let s = 0; s < squadCount; s++) {
      row.push({ noise: rng() * 2 - 1, spinDraw: rng(), crashDraw: rng() });
    }
    m.push(row);
  }
  return m;
}

/* ---------- 调校理想值（Agent 路书换算公式；人类公开视图只给图标） ---------- */
function idealTire(surface, weather) {
  return clamp((TIRE_IDEAL[surface] || 46) + (TIRE_WEATHER_ADJ[weather] || 0), 0, 100);
}
function idealGear(seg) {
  const tightness = (5 - seg.curve) / 5;
  return clamp(Math.round(15 + tightness * 60 + Math.max(0, seg.grade) * 8 + (seg.jump ? 12 : 0)), 0, 100);
}
function tuneBonusValue(value, ideal) {
  if (!Number.isFinite(value) || value == null) return 0;
  return Math.max(0, TUNE_BONUS_MAX - Math.abs(value - ideal) * TUNE_FALL_OFF);
}

/* ---------- 风险与事故曲线（测试单调性/边界；前端预算带同式复算） ---------- */
function effectiveDial(style, dial) {
  const st = STYLE[style] || STYLE.steady;
  return clamp(Math.round(dial) + st.shift, 0, 100);
}
function riskFactor(effDial) { return Math.round((RISK_HI - RISK_SPAN * (effDial / 100)) * 1000) / 1000; } // 1.12 → 0.90
function noiseSpan(effDial) { return NOISE_BASE + NOISE_K * effDial; }          // ±2s → ±8s
function gripOf(surface, weather) {
  return (SURFACES[surface] || SURFACES.gravel).grip * (WEATHERS[weather] || WEATHERS.dry).grip;
}
function spinChance(seg, weather, effDial, style) {
  const acc = (STYLE[style] || STYLE.steady).acc;
  const tightness = (5 - seg.curve) / 5;
  const v = Math.pow(effDial / 100, 2.2) * (1.15 - gripOf(seg.surface, weather)) * (0.35 + 0.75 * tightness) * acc;
  return clamp(v, 0, SPIN_CAP);
}
function jumpCrashChance(seg, effDial, style) {
  if (!seg.jump || effDial < JUMP_RISK_START) return 0;
  const acc = (STYLE[style] || STYLE.steady).acc;
  return Math.min(0.5, (effDial - JUMP_RISK_START) * JUMP_CRASH_SPAN * acc);
}
function baseTime(seg, weather) {
  return (SURFACES[seg.surface] || SURFACES.gravel).base
    * (WEATHERS[weather] || WEATHERS.dry).mult
    * CURVE_TIME[clamp(seg.curve, 0, 5)]
    * (1 + seg.grade * GRADE_K)
    * (seg.jump ? JUMP_MULT : 1);
}

/* ---------- 单段确定性结算 ---------- */
// inputs: { seg, weather, tune:{tirePressure,gearRatio}, drive:{style,riskDial}, damage,
//           repairDone, draws:{noise,spinDraw,crashDraw} }
// return: { timeDs, time, parts:{base,risk,setup,noise,mishap,repairPen,dmgMult},
//           mishap:'none'|'spin'|'jumpCrash', dmgStart, dmgEnd, wear }
function runSegment(inputs) {
  const { seg, weather, tune, drive, damage } = inputs;
  const style = STYLE[drive && STYLE[drive.style] ? drive.style : 'steady'];
  const dial = drive && Number.isFinite(drive.riskDial) ? clamp(Math.round(drive.riskDial), 0, 100) : 50;
  const eff = effectiveDial(style.key, dial);
  const draws = inputs.draws || { noise: 0, spinDraw: 1, crashDraw: 1 };

  const base = baseTime(seg, weather);
  const risk = riskFactor(eff);
  const setup = tuneBonusValue(tune && tune.tirePressure, idealTire(seg.surface, weather))
    + tuneBonusValue(tune && tune.gearRatio, idealGear(seg));

  // 维修：段内修车先回血再跑（损伤惩罚按修后值判定）
  const repairDone = !!inputs.repairDone;
  const dmgStart = repairDone ? Math.max(0, damage - REPAIR_AMOUNT) : damage;
  const dmgMult = dmgStart > WEAR_THRESHOLD ? DMG_TIME_MULT : 1;

  const nSpan = noiseSpan(eff);
  const noise = (draws.noise || 0) * nSpan;

  let time = base * risk * dmgMult - setup + noise;
  const wear = Math.max(0, eff - WEAR_THRESHOLD) * WEAR_K;

  // 事故判定（同一次 draw 序列：spin 优先）
  let mishap = 'none', mishapTime = 0, mishapDmg = 0;
  const sp = spinChance(seg, weather, eff, style.key);
  const jp = jumpCrashChance(seg, eff, style.key);
  if (draws.spinDraw < sp) {
    mishap = 'spin'; mishapTime = SPIN_TIME; mishapDmg = SPIN_DMG;
  } else if (draws.crashDraw < jp) {
    mishap = 'jumpCrash'; mishapTime = CRASH_TIME; mishapDmg = CRASH_DMG;
  }
  time += mishapTime;
  const repairPen = repairDone && !seg.service ? REPAIR_PENALTY : 0;
  time += repairPen;

  const dmgEnd = clamp(Math.round((dmgStart + wear + mishapDmg) * 10) / 10, 0, 100);
  const timeDs = Math.max(100, Math.round(time * 10)); // 10 秒以下物理不可能；deci-seconds 整数（平局口径）
  return {
    timeDs, time: timeDs / 10,
    parts: {
      base: Math.round(base * 10) / 10, risk: Math.round(risk * 1000) / 1000,
      setup: Math.round(setup * 10) / 10, noise: Math.round(noise * 10) / 10,
      mishap, mishapTime, repairPen,
      dmgMult: dmgMult > 1 ? DMG_TIME_MULT : 1,
    },
    mishap, dmgStart, dmgEnd, wear: Math.round(wear * 10) / 10,
    effDial: eff, style: style.key, dial,
  };
}

/* ---------- 快照指纹（测试：确定性校验） ---------- */
function fingerprint(obj) { return JSON.stringify(obj); }

module.exports = {
  mulberry32, generateTrack, weatherForecast, weatherDeviations, weatherActual, noiseMatrix,
  idealTire, idealGear, tuneBonusValue,
  effectiveDial, riskFactor, noiseSpan, gripOf, spinChance, jumpCrashChance, baseTime,
  runSegment, fingerprint,
  SEG_MIN, SEG_MAX, SEGMENT_MS, WEATHER_KEYS, DEVIATE_P,
  SURFACES, WEATHERS, CURVE_TIME, GRADE_K, JUMP_MULT,
  RISK_HI, RISK_SPAN, NOISE_BASE, NOISE_K,
  SPIN_TIME, SPIN_DMG, CRASH_TIME, CRASH_DMG, SPIN_CAP, JUMP_RISK_START, JUMP_CRASH_SPAN,
  WEAR_THRESHOLD, DMG_TIME_MULT, WEAR_K, REPAIR_AMOUNT, REPAIR_PENALTY,
  TUNE_BONUS_MAX, TUNE_FALL_OFF, TIRE_IDEAL, TIRE_WEATHER_ADJ, STYLE,
};
