// SPDX-License-Identifier: Apache-2.0
// plugins/guandan/server/combo.js — 掼蛋搭档 · 牌型识别器（本游戏命根：确定性、可枚举、可对拍）
// ------------------------------------------------------------------
// 牌编码（0..107）：
//   普通牌 0..103：card = d*52 + r*4 + s；d=0/1（两副），r=0..12（面值 face=r+2：2..A），
//   s=0..3（♠♥♦♣）。两副共 26×4=104 张普通牌（含 2——见下「2 的定位」）。
//   王 104..107：104/106=小王（两副各一），105/107=大王。
//
// 级牌与序值（orderValue，全部比较都基于它）：
//   2..A → 序值 2..14；级牌（face === level 的所有花色）→ 序值 15（大于 A）；
//   小王 16；大王 17。「级牌主牌概念」简化掉：级牌只是最大点数 + 红桃级牌为逢人配。
//
// 2 的定位：本作按规格用满 108 张（2×54），2 在牌池中存在。
//   2 = 最小点数（序值 2）；不参与顺子/连对/钢板连线（连线下限 3）；可作单张/对子/三张/
//   三带二的翼/炸弹。level=2 时红桃 2 为逢人配（此时 2 的序值为 15）。
//
// 逢人配：红桃级牌（♥face==level）可当任意「非王牌」搭子（可替 2..A 任意面值，
//   不可替王）。识别器对含 wild 的牌组枚举其全部替代解释；legalMoves 枚举采用
//   「自然牌优先、wild 殿后」的规范代表（同型同锚只列一个）。
//
// 牌型（type / 比较规则）：
//   single 单张 | pair 对子 | trio 三张 | trio_pair 三带二(5张，比三条面值) |
//   straight 顺子(≥5 连单，3..A 连线，长度相同才可比) | pair_run 连对(≥3 连对，同长可比) |
//   steel 钢板(恰好连续两个三张，6张，同锚比大小) | bomb 炸弹(4..8 同面，张数优先、面值次之) |
//   rocket 天王炸(4 王，最大，不可被压)。
//   炸弹压一切非炸弹；大炸弹压小炸弹（张数优先）；天王炸 > 一切。
//   顺子/连对/钢板锚点 = 顶面序值（级牌顶 = 15 > A 顶 = 14）。
//
// A 的边界（规则文档同步声明）：10-J-Q-K-A 为最大顺子；A 只能作顺子顶，
//   不与 2/3 回绕（{A,2,3,4,5} 不是顺子——2 不入连线）。
'use strict';

const JOKER_BASE = 104;
const FACE_MIN = 2, FACE_MAX = 14;
const ORDER_LEVEL = 15, ORDER_JOKER_S = 16, ORDER_JOKER_B = 17;
const LEVEL_MIN = 2, LEVEL_MAX = 14; // 级 2..A
const HAND_SIZE = 27, DECK_SIZE = 108;

const RANK_GLYPH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
const TYPE_NAMES = {
  single: '单张', pair: '对子', trio: '三张', trio_pair: '三带二', straight: '顺子',
  pair_run: '连对', steel: '钢板', bomb: '炸弹', rocket: '天王炸',
};
const TYPE_ORDER = ['single', 'pair', 'trio', 'trio_pair', 'straight', 'pair_run', 'steel', 'bomb', 'rocket'];

/* ---------- 基础牌面 ---------- */
// card = d*52 + r*4 + s → 解码时先取 d 内偏移（card % 52），再除 4 取 rank
function faceValue(card) { return card >= 0 && card < JOKER_BASE ? Math.floor((card % 52) / 4) + 2 : 0; }
function suitOf(card) { return card >= 0 && card < JOKER_BASE ? card % 4 : -1; }
function isJoker(card) { return card >= JOKER_BASE && card < DECK_SIZE; }
function jokerOrder(card) { return (card - JOKER_BASE) % 2 === 0 ? ORDER_JOKER_S : ORDER_JOKER_B; } // 16 小王 / 17 大王
function isWild(card, level) { return !isJoker(card) && suitOf(card) === 1 && faceValue(card) === level; }
function orderValue(card, level) { return isJoker(card) ? jokerOrder(card) : (faceValue(card) === level ? ORDER_LEVEL : faceValue(card)); }
function faceOrder(face, level) { return face === level ? ORDER_LEVEL : face; }
function cardName(card) {
  if (isJoker(card)) return (card - JOKER_BASE) % 2 === 0 ? '小王' : '大王';
  return `${RANK_GLYPH[faceValue(card)]}${SUIT_GLYPH[suitOf(card)]}`;
}
function cardsName(cards) { return (cards || []).map(cardName).join(' '); }
function makeDeck() { const d = []; for (let i = 0; i < DECK_SIZE; i++) d.push(i); return d; }

/* ---------- 结构识别（面值计数 → 可能牌型；不含王/wild 语义，纯几何） ---------- */
// counts: Map face→张数（面值 2..14）；total = 总张数。返回 [{type, anchor, len}] 数组（同组牌可多解）。
function structuresFromCounts(counts, total, level) {
  const out = [];
  const faces = [...counts.keys()].sort((a, b) => a - b);
  const top = faces[faces.length - 1];
  const consecutive = faces.every((f, i) => i === 0 || f === faces[i - 1] + 1);
  if (total === 1) {
    out.push({ type: 'single', anchor: faceOrder(faces[0], level), len: 1 });
    return out;
  }
  if (faces.length === 1) {
    if (total === 2) out.push({ type: 'pair', anchor: faceOrder(top, level), len: 1 });
    else if (total === 3) out.push({ type: 'trio', anchor: faceOrder(top, level), len: 1 });
    else if (total >= 4 && total <= 8) out.push({ type: 'bomb', anchor: faceOrder(top, level), len: total });
    return out;
  }
  // 三带二（5 张：两面貌 3+2）
  if (total === 5 && faces.length === 2) {
    const [a, b] = faces;
    if (counts.get(a) === 3 && counts.get(b) === 2) out.push({ type: 'trio_pair', anchor: faceOrder(a, level), len: 1 });
    if (counts.get(a) === 2 && counts.get(b) === 3) out.push({ type: 'trio_pair', anchor: faceOrder(b, level), len: 1 });
  }
  // 顺子（≥5 张全异连续，3 起连到 A；2 不入连线）
  if (total >= 5 && faces.length === total && faces[0] >= 3 && top <= FACE_MAX && consecutive) {
    out.push({ type: 'straight', anchor: faceOrder(top, level), len: total });
  }
  // 连对（≥3 面各恰 2 张，连续，3 起连）
  if (total >= 6 && total % 2 === 0 && faces.every(f => counts.get(f) === 2) && faces[0] >= 3 && consecutive) {
    out.push({ type: 'pair_run', anchor: faceOrder(top, level), len: faces.length });
  }
  // 钢板（恰好两个连续面貌各 3 张）
  if (total === 6 && faces.length === 2 && counts.get(faces[0]) === 3 && counts.get(faces[1]) === 3
    && faces[0] >= 3 && faces[1] === faces[0] + 1) {
    out.push({ type: 'steel', anchor: faceOrder(top, level), len: 2 });
  }
  return out;
}

/* ---------- 解读一组已出的牌（含 wild 替代枚举；测试与防御性校验用） ---------- */
// 返回全部解释 [{type, name, anchor, len, size, cards}]（cards 即入参原序），
// 解释按 TYPE_ORDER → anchor → len 确定性排序。空数组 = 不构成任何合法牌型。
function interpret(cards, level) {
  if (!Array.isArray(cards) || !cards.length || !cards.every(c => Number.isInteger(c) && c >= 0 && c < DECK_SIZE)) return [];
  const jokers = cards.filter(isJoker);
  const wilds = cards.filter(c => isWild(c, level));
  const naturals = cards.filter(c => !isJoker(c) && !isWild(c, level));
  const found = [];
  const seen = new Set();
  const push = (st) => {
    const key = `${st.type}|${st.anchor}|${st.len}|${cards.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ type: st.type, name: TYPE_NAMES[st.type], anchor: st.anchor, len: st.len, size: cards.length, cards: cards.slice() });
  };
  if (jokers.length === cards.length) {
    // 纯王：天王炸 / 单王 / 对王（王不可由 wild 替代，王也不能混入其它牌型）
    if (cards.length === 4) push({ type: 'rocket', anchor: ORDER_JOKER_B, len: 1 });
    else if (cards.length === 1) push({ type: 'single', anchor: jokerOrder(cards[0]), len: 1 });
    else if (cards.length === 2 && jokerOrder(cards[0]) === jokerOrder(cards[1])) {
      push({ type: 'pair', anchor: jokerOrder(cards[0]), len: 1 });
    }
    return sortFound(found);
  }
  if (jokers.length) return sortFound(found); // 王与普通牌混出 → 无解释（王不能搭任何牌型）
  // 非王牌组：wild 枚举替代（每张 wild 可替 2..A 任一面值）
  const base = new Map();
  for (const c of naturals) base.set(faceValue(c), (base.get(faceValue(c)) || 0) + 1);
  const W = wilds.length;
  const faceOptions = [];
  for (let f = FACE_MIN; f <= FACE_MAX; f++) faceOptions.push(f);
  const assignments = [[]];
  for (let w = 0; w < W; w++) {
    const next = [];
    for (const prefix of assignments) for (const f of faceOptions) next.push(prefix.concat(f));
    assignments.length = 0;
    assignments.push(...next);
  }
  for (const assign of assignments) {
    const counts = new Map(base);
    for (const f of assign) counts.set(f, (counts.get(f) || 0) + 1);
    for (const st of structuresFromCounts(counts, cards.length, level)) push(st);
  }
  return sortFound(found);
}
function sortFound(found) {
  return found.sort((a, b) =>
    TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.anchor - b.anchor || a.len - b.len);
}

/* ---------- 同型比较：mv 能否压过 target ---------- */
// target 为 null/undefined 表示领出（任意牌型合法）。
function beats(mv, target, level) { // level 仅用于未来扩展，比较已折入 anchor
  if (!mv || !mv.type) return false;
  if (!target) return true;
  if (mv.type === 'rocket') return true;
  if (target.type === 'rocket') return false;
  if (target.type === 'bomb') {
    if (mv.type !== 'bomb') return false;
    return mv.len > target.len || (mv.len === target.len && mv.anchor > target.anchor);
  }
  if (mv.type === 'bomb') return true;
  if (mv.type !== target.type) return false;
  if ((mv.type === 'straight' || mv.type === 'pair_run' || mv.type === 'steel') && mv.len !== target.len) return false;
  return mv.anchor > target.anchor;
}

/* ---------- 合法动作枚举（平台代拼牌型：LLM 只选 id） ---------- */
// hand: 手牌数组；ctx: null=领出（全枚举），否则 {type, anchor, len}（须能压过）。
// 返回 [{id:'m0', type, name, anchor, len, size, cards}]，确定性排序（单张→对→三→三带二→
// 顺→连对→钢板→炸弹→天王炸，同类锚点升序），moves[0] = 最弱单张（超时托管安全牌）。
function enumerateMoves(hand, level, ctx) {
  const nat = new Map();   // face → 非王非 wild 的牌（升序）
  const jokers = { s: [], b: [] };
  const wilds = [];
  for (const c of hand || []) {
    if (!Number.isInteger(c) || c < 0 || c >= DECK_SIZE) continue;
    if (isJoker(c)) { ((c - JOKER_BASE) % 2 === 0 ? jokers.s : jokers.b).push(c); continue; }
    if (isWild(c, level)) { wilds.push(c); continue; }
    const f = faceValue(c);
    if (!nat.has(f)) nat.set(f, []);
    nat.get(f).push(c);
  }
  for (const list of nat.values()) list.sort((a, b) => a - b);
  wilds.sort((a, b) => a - b);
  const natLen = f => (nat.get(f) || []).length;
  const usable = f => f <= FACE_MAX ? natLen(f) + wilds.length : natLen(f); // wild 不可替王
  const fill = (f, n) => {
    // 规范选牌：自然牌优先（升序取前 n 张），不足用 wild 殿后补齐
    const out = (nat.get(f) || []).slice(0, n);
    for (const w of wilds) { if (out.length >= n) break; out.push(w); }
    return out;
  };
  const moves = [];
  const seen = new Set();
  const add = (type, anchor, len, cards) => {
    const key = `${type}|${anchor}|${len}|${cards.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    moves.push({ type, name: TYPE_NAMES[type], anchor, len, size: cards.length, cards: cards.slice().sort((a, b) => a - b) });
  };
  // 单张：每面值一张规范牌 + wild 单张（天然就是级牌单张）
  for (let f = FACE_MIN; f <= FACE_MAX; f++) {
    const list = nat.get(f);
    if (list && list.length) add('single', faceOrder(f, level), 1, [list[0]]);
    if (f === level && wilds.length) add('single', ORDER_LEVEL, 1, [wilds[0]]);
  }
  if (jokers.s.length) add('single', ORDER_JOKER_S, 1, [jokers.s[0]]);
  if (jokers.b.length) add('single', ORDER_JOKER_B, 1, [jokers.b[0]]);
  // 对子
  for (let f = FACE_MIN; f <= FACE_MAX; f++) if (usable(f) >= 2) add('pair', faceOrder(f, level), 1, fill(f, 2));
  if (jokers.s.length >= 2) add('pair', ORDER_JOKER_S, 1, [jokers.s[0], jokers.s[1]]);
  if (jokers.b.length >= 2) add('pair', ORDER_JOKER_B, 1, [jokers.b[0], jokers.b[1]]);
  // 三张
  for (let f = FACE_MIN; f <= FACE_MAX; f++) if (usable(f) >= 3) add('trio', faceOrder(f, level), 1, fill(f, 3));
  // 三带二（三条 fv + 翼对 fw；wild 预算 = 不足额之和）
  for (let fv = FACE_MIN; fv <= FACE_MAX; fv++) {
    if (usable(fv) < 3) continue;
    for (let fw = FACE_MIN; fw <= ORDER_JOKER_B; fw++) {
      if (fw === fv) continue;
      const needW = Math.max(0, 2 - natLen(fw));
      if (fw > FACE_MAX && needW > 0) continue;               // 翼为王只能纯对王
      const needV = Math.max(0, 3 - natLen(fv));
      if (needV + needW > wilds.length) continue;
      add('trio_pair', faceOrder(fv, level), 1, fill(fv, 3).concat(fill(fw, 2)));
    }
  }
  // 顺子（长度 5..12；2 不入连线；wild 补缺面）
  for (let len = 5; len <= 12; len++) {
    for (let s = 3; s + len - 1 <= FACE_MAX; s++) {
      let miss = 0;
      for (let f = s; f < s + len; f++) if (natLen(f) === 0) miss++;
      if (miss > wilds.length) continue;
      const cards = [];
      for (let f = s; f < s + len; f++) cards.push(...fill(f, 1));
      add('straight', faceOrder(s + len - 1, level), len, cards);
    }
  }
  // 连对（长度 3..12）
  for (let len = 3; len <= 12; len++) {
    for (let s = 3; s + len - 1 <= FACE_MAX; s++) {
      let short = 0;
      for (let f = s; f < s + len; f++) short += Math.max(0, 2 - natLen(f));
      if (short > wilds.length) continue;
      const cards = [];
      for (let f = s; f < s + len; f++) cards.push(...fill(f, 2));
      add('pair_run', faceOrder(s + len - 1, level), len, cards);
    }
  }
  // 钢板（连续两个三张）
  for (let s = 3; s + 1 <= FACE_MAX; s++) {
    const short = Math.max(0, 3 - natLen(s)) + Math.max(0, 3 - natLen(s + 1));
    if (short > wilds.length) continue;
    add('steel', faceOrder(s + 1, level), 2, fill(s, 3).concat(fill(s + 1, 3)));
  }
  // 炸弹（4..8 同面）
  for (let f = FACE_MIN; f <= FACE_MAX; f++) {
    for (let n = 4; n <= 8; n++) {
      if (usable(f) >= n) add('bomb', faceOrder(f, level), n, fill(f, n));
    }
  }
  // 天王炸
  if (jokers.s.length >= 2 && jokers.b.length >= 2) {
    add('rocket', ORDER_JOKER_B, 1, [jokers.s[0], jokers.s[1], jokers.b[0], jokers.b[1]]);
  }
  const list = ctx ? moves.filter(mv => beats(mv, ctx, level)) : moves;
  return list.map((mv, i) => ({ ...mv, id: `m${i}` }));
}

module.exports = {
  JOKER_BASE, FACE_MIN, FACE_MAX, ORDER_LEVEL, ORDER_JOKER_S, ORDER_JOKER_B,
  LEVEL_MIN, LEVEL_MAX, HAND_SIZE, DECK_SIZE,
  RANK_GLYPH, SUIT_GLYPH, TYPE_NAMES, TYPE_ORDER,
  faceValue, suitOf, isJoker, isWild, orderValue, faceOrder, cardName, cardsName, makeDeck,
  structuresFromCounts, interpret, beats, enumerateMoves,
};
