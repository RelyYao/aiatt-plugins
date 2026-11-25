// SPDX-License-Identifier: Apache-2.0
'use strict';
// 搭档兵团 (Partner Legion): the rules as pure, deterministic functions. No store, no clock, no I/O.
// Experience review round 4 (docs/engineering/experience/2026-11-20-round4-rooms-games-mobile.md §二.2): an auto-battler
// for up to four camps, each a person and their Agent. A round is a 30 s preparation (buy from a shop of five, sell,
// refresh, place on a 2×4 board, pick a commander's order) and a battle the server resolves from a fixed seed.
// 12 units in 3 cost tiers and 4 traits; three copies of a unit merge into the next star; 6 rounds.
// lib/games/legion/legion.js wires it into a room; the battle and the shop rolls replay exactly from the revealed seed.
const { sha256Bytes } = require('@aiatt/plugin-kit/sha256'); // the same digest as Node's, in the sandbox too

const ROUNDS = 6, START_HP = 30, BENCH = 6, SHOP = 5, REFRESH_COST = 1, ROWS = 2, COLS = 4, MAX_STAR = 3;
const TICKS = 300; // a battle lasts at most 300 ticks (30 s of game time, played back faster)
const POOL = { 1: 12, 2: 9, 3: 6 }; // copies of each unit in the shared pool
const ODDS = [[80, 20, 0], [80, 20, 0], [55, 35, 10], [55, 35, 10], [35, 40, 25], [35, 40, 25]]; // tier odds per round
const TRAITS = ['guard', 'ranger', 'arcane', 'raider'];
const ORDERS = ['rally', 'focus', 'shield'];
// key, tier, trait, hp, atk, range (1 melee, 2 ranged), cd (ticks between attacks), armor
const UNITS = [
  ['shield', 1, 'guard', 620, 38, 1, 10, 6], ['archer', 1, 'ranger', 420, 46, 2, 9, 2],
  ['apprentice', 1, 'arcane', 400, 40, 2, 11, 1], ['scout', 1, 'raider', 450, 50, 1, 8, 2],
  ['ironclad', 2, 'guard', 860, 50, 1, 10, 9], ['crossbow', 2, 'ranger', 560, 66, 2, 10, 3],
  ['warlock', 2, 'arcane', 540, 58, 2, 11, 2], ['assassin', 2, 'raider', 600, 72, 1, 8, 3],
  ['warden', 3, 'guard', 1200, 68, 1, 10, 12], ['marksman', 3, 'ranger', 720, 96, 2, 10, 4],
  ['archmage', 3, 'arcane', 700, 84, 2, 12, 3], ['shadow', 3, 'raider', 800, 100, 1, 8, 4],
].map(([key, tier, trait, hp, atk, range, cd, armor]) => ({ key, tier, trait, hp, atk, range, cd, armor }));
const UNIT = Object.fromEntries(UNITS.map(u => [u.key, u]));
const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.2 };
const COPIES = { 1: 1, 2: 3, 3: 9 };
const CELLS = ['f0', 'f1', 'f2', 'f3', 'b0', 'b1', 'b2', 'b3']; // front row, back row

// ---------- randomness: every draw derives from the committed seed ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function rngFor(...parts) { const d = sha256Bytes(parts.join('|')); return mulberry32((d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0); } // the digest's first four bytes, little-endian

// ---------- economy ----------
const income = round => round === 1 ? 4 : 5;
const boardCap = round => Math.min(2 + round, 6);
const sellValue = unit => UNIT[unit.key].tier * COPIES[unit.star];
function newPool() { return Object.fromEntries(UNITS.map(u => [u.key, POOL[u.tier]])); }
function newCamp({ id, name, members = [], bot = false }) {
  return { id, name, members, bot, hp: START_HP, gold: 0, shop: Array(SHOP).fill(null), units: [], order: 'rally', alive: true, place: null, rolls: 0, serial: 0, v: 0 };
}
// Five offers by the round's tier odds, from what is left in the pool (an offer is not reserved until bought).
function rollShop(camp, pool, round, seed) {
  const rng = rngFor(seed, camp.id, round, camp.rolls++), odds = ODDS[Math.min(round, ODDS.length) - 1];
  camp.shop = Array.from({ length: SHOP }, () => {
    let roll = rng() * 100, tier = 1;
    for (let t = 0; t < 3; t++) { if (roll < odds[t]) { tier = t + 1; break; } roll -= odds[t]; }
    for (let t = tier; t >= 1; t--) {
      const keys = UNITS.filter(u => u.tier === t), weights = keys.map(u => pool[u.key]), total = weights.reduce((a, b) => a + b, 0);
      if (!total) continue;
      let pick = rng() * total;
      for (let i = 0; i < keys.length; i++) { if (pick < weights[i]) return keys[i].key; pick -= weights[i]; }
    }
    return null;
  });
  return camp.shop;
}
const bench = camp => camp.units.filter(u => !u.cell);
const board = camp => camp.units.filter(u => u.cell);
const fail = (error, message) => ({ error, message });

// Three copies of a unit at one star become one at the next star, on the board copy's cell when there is one.
function merge(camp) {
  for (let changed = true; changed;) {
    changed = false;
    for (const key of Object.keys(UNIT)) for (let star = 1; star < MAX_STAR; star++) {
      const same = camp.units.filter(u => u.key === key && u.star === star);
      if (same.length < 3) continue;
      const three = [...same.filter(u => u.cell), ...same.filter(u => !u.cell)].slice(0, 3), keep = three[0];
      camp.units = camp.units.filter(u => !three.includes(u) || u === keep);
      keep.star = star + 1; changed = true;
    }
  }
}
const wouldMerge = (camp, key) => camp.units.filter(u => u.key === key && u.star === 1).length >= 2;
function buy(camp, pool, slot) {
  const key = camp.shop[slot];
  if (!Number.isInteger(slot) || !key) return fail('BAD_SLOT', 'Nothing to buy in that slot');
  const tier = UNIT[key].tier;
  if (camp.gold < tier) return fail('NOT_ENOUGH_GOLD', `This unit costs ${tier} gold`);
  if (bench(camp).length >= BENCH && !wouldMerge(camp, key)) return fail('BENCH_FULL', 'The bench is full; sell or place a unit first');
  if (!pool[key]) return fail('SOLD_OUT', 'That unit is sold out');
  camp.gold -= tier; pool[key]--; camp.shop[slot] = null;
  camp.units.push({ uid: `${camp.id}-${++camp.serial}`, key, star: 1, cell: null });
  merge(camp); camp.v++;
  return { ok: true };
}
function sell(camp, pool, uid) {
  const unit = camp.units.find(u => u.uid === uid);
  if (!unit) return fail('NO_UNIT', 'No such unit');
  camp.gold += sellValue(unit); pool[unit.key] += COPIES[unit.star];
  camp.units = camp.units.filter(u => u !== unit); camp.v++;
  return { ok: true };
}
function refresh(camp, pool, round, seed) {
  if (camp.gold < REFRESH_COST) return fail('NOT_ENOUGH_GOLD', `A refresh costs ${REFRESH_COST} gold`);
  camp.gold -= REFRESH_COST; rollShop(camp, pool, round, seed); camp.v++;
  return { ok: true };
}
// Move a unit to a board cell (swapping with whoever is there) or to the bench (cell null).
function move(camp, uid, cell, round) {
  const unit = camp.units.find(u => u.uid === uid);
  if (!unit) return fail('NO_UNIT', 'No such unit');
  if (cell !== null && !CELLS.includes(cell)) return fail('BAD_CELL', 'Pick a board cell');
  if (cell === unit.cell) return { ok: true };
  if (cell === null) {
    if (bench(camp).length >= BENCH) return fail('BENCH_FULL', 'The bench is full');
    unit.cell = null; camp.v++; return { ok: true };
  }
  const there = camp.units.find(u => u.cell === cell);
  if (there) { there.cell = unit.cell; unit.cell = cell; camp.v++; return { ok: true }; }
  if (!unit.cell && board(camp).length >= boardCap(round)) return fail('BOARD_FULL', `Round ${round} fields at most ${boardCap(round)} units`);
  unit.cell = cell; camp.v++;
  return { ok: true };
}
function setOrder(camp, order) {
  if (!ORDERS.includes(order)) return fail('BAD_ORDER', 'order must be rally, focus or shield');
  camp.order = order; camp.v++;
  return { ok: true };
}
const power = u => UNIT[u.key].tier * 10 * STAR_MULT[u.star] + UNIT[u.key].hp / 100;
const frontFirst = u => UNIT[u.key].range === 1 || UNIT[u.key].trait === 'guard';
// Fill empty board cells up to the round's cap with the strongest bench units: melee in front, ranged behind.
// With relayout every unit is reconsidered (the engine's own arrangement); without it placed units stay put.
function autoPlace(camp, round, { relayout = false } = {}) {
  if (relayout) for (const u of camp.units) u.cell = null;
  const cap = boardCap(round), free = CELLS.filter(c => !camp.units.some(u => u.cell === c));
  const waiting = bench(camp).sort((a, b) => power(b) - power(a)).slice(0, Math.max(0, cap - board(camp).length));
  for (const unit of waiting) {
    const want = frontFirst(unit) ? free.filter(c => c[0] === 'f') : free.filter(c => c[0] === 'b');
    const cell = (want.length ? want : free).sort((a, b) => Math.abs(+a[1] - 1.5) - Math.abs(+b[1] - 1.5))[0];
    if (!cell) break;
    unit.cell = cell; free.splice(free.indexOf(cell), 1);
  }
  camp.v++;
}

// ---------- traits ----------
// A trait counts the distinct units of it on the board: 2 and 3 are the two levels.
function traits(camp) {
  const out = Object.fromEntries(TRAITS.map(t => [t, 0]));
  for (const key of new Set(board(camp).map(u => u.key))) out[UNIT[key].trait]++;
  return out;
}
const level = n => n >= 3 ? 2 : n >= 2 ? 1 : 0;

// ---------- battle ----------
function fighters(camp, side) {
  const t = traits(camp), lv = Object.fromEntries(TRAITS.map(k => [k, level(t[k])]));
  return board(camp).map((u, i) => {
    const base = UNIT[u.key], m = STAR_MULT[u.star], row = u.cell[0] === 'f' ? 0 : 1, col = +u.cell[1];
    let hp = base.hp * m, cd = base.cd, armor = base.armor;
    if (base.trait === 'guard') { armor += [0, 5, 10][lv.guard]; hp *= [1, 1, 1.15][lv.guard]; }
    if (base.trait === 'ranger') cd = Math.max(4, Math.round(cd * [1, 0.8, 0.65][lv.ranger]));
    if (camp.order === 'shield' && row === 0) hp *= 1.2;
    return { ref: `${side}:${u.uid}`, side, key: u.key, star: u.star, tier: base.tier, trait: base.trait, range: base.range, row, col,
      maxHp: Math.round(hp), hp: Math.round(hp), atk: base.atk * m, cd, armor, wait: Math.floor(cd / 2) + (i % 3), hits: 0, dieAt: null,
      arcane: [1, 1.3, 1.6][lv.arcane], crit: [0, 0.2, 0.35][lv.raider], critMult: [1, 2, 2.2][lv.raider], order: camp.order };
  });
}
function pickTarget(f, foes) {
  const alive = foes.filter(x => x.hp > 0);
  if (!alive.length) return null;
  if (f.order === 'focus' && f.range === 2) return alive.reduce((a, b) => b.hp < a.hp ? b : a);
  const rows = f.trait === 'raider' ? [1, 0] : [0, 1];
  for (const row of rows) {
    const line = alive.filter(x => x.row === row);
    if (line.length) return line.reduce((a, b) => Math.abs(b.col - f.col) < Math.abs(a.col - f.col) ? b : a);
  }
  return alive[0];
}
// Resolve one battle. Returns the winner ('a' | 'b' | 'draw'), the ticks it took and each unit's timeline
// (max hp, hp left, the tick it fell) — enough for a client to play it back.
function battle(campA, campB, seed) {
  const rng = rngFor(seed, 'battle', campA.id, campB.id), A = fighters(campA, 'a'), B = fighters(campB, 'b'), all = [...A, ...B];
  let t = 0;
  for (; t < TICKS && A.some(f => f.hp > 0) && B.some(f => f.hp > 0); t++) {
    for (const f of all) {
      if (f.hp <= 0 || --f.wait > 0) continue;
      const foes = f.side === 'a' ? B : A, target = pickTarget(f, foes);
      if (!target) continue;
      f.wait = f.cd; f.hits++;
      let dmg = f.atk * (f.order === 'rally' && t < 50 ? 1.15 : 1);
      if (f.trait === 'arcane') dmg *= f.arcane;
      if (f.crit && rng() < f.crit) dmg *= f.critMult;
      const hit = (x, amount) => { if (x.hp <= 0) return; x.hp -= Math.round(f.trait === 'arcane' ? amount : amount * 100 / (100 + x.armor * 6)); if (x.hp <= 0) { x.hp = 0; x.dieAt = t; } };
      hit(target, dmg);
      if (f.trait === 'arcane' && f.hits % 3 === 0) for (const x of foes) if (x !== target && x.row === target.row) hit(x, dmg * 0.5);
    }
  }
  const left = side => side.reduce((s, f) => s + f.hp / f.maxHp, 0), aAlive = A.some(f => f.hp > 0), bAlive = B.some(f => f.hp > 0);
  let winner = aAlive && !bAlive ? 'a' : bAlive && !aAlive ? 'b' : 'draw';
  if (aAlive && bAlive) { const la = left(A), lb = left(B); winner = Math.abs(la - lb) < 1e-9 ? 'draw' : la > lb ? 'a' : 'b'; }
  const survivors = side => side.filter(f => f.hp > 0).map(f => ({ tier: f.tier, star: f.star }));
  const timeline = all.map(f => ({ ref: f.ref, side: f.side, key: f.key, star: f.star, row: f.row, col: f.col, maxHp: f.maxHp, hp: f.hp, dieAt: f.dieAt }));
  return { winner, ticks: t, timeline, survivors: { a: survivors(A), b: survivors(B) } };
}
// Damage the loser takes: 2, plus half the round, plus each winning survivor's tier and extra stars. A draw costs both 1.
const damageOf = (survivors, round) => 2 + Math.floor(round / 2) + survivors.reduce((s, f) => s + f.tier + f.star - 1, 0);
function resolveRound(camps, round, seed) {
  const alive = camps.filter(c => c.alive), rng = rngFor(seed, 'pairs', round), order = alive.map(c => c.id);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const byId = Object.fromEntries(camps.map(c => [c.id, c])), out = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = byId[order[i]];
    let b = byId[order[i + 1]], ghost = false;
    if (!b) { // odd count: the last camp fights a copy of another camp's board; only the real camp can lose hp
      const others = order.filter(id => id !== a.id);
      if (!others.length) break;
      b = byId[others[Math.floor(rng() * others.length)]]; ghost = true;
    }
    const r = battle(a, b, `${seed}|${round}|${i}`);
    const dmgA = r.winner === 'b' ? damageOf(r.survivors.b, round) : r.winner === 'draw' ? 1 : 0;
    const dmgB = ghost ? 0 : r.winner === 'a' ? damageOf(r.survivors.a, round) : r.winner === 'draw' ? 1 : 0;
    a.hp = Math.max(0, a.hp - dmgA); b.hp = Math.max(0, b.hp - dmgB);
    out.push({ a: a.id, b: b.id, ghost, winner: r.winner === 'a' ? a.id : r.winner === 'b' ? b.id : null, ticks: r.ticks, damage: { [a.id]: dmgA, ...(ghost ? {} : { [b.id]: dmgB }) }, timeline: r.timeline });
  }
  return out;
}

// ---------- the engine: Bots, platform AIs and advice ----------
function favouredTrait(camp) {
  const weight = Object.fromEntries(TRAITS.map(t => [t, 0]));
  for (const u of camp.units) weight[UNIT[u.key].trait] += UNIT[u.key].tier * COPIES[u.star];
  return TRAITS.reduce((a, b) => weight[b] > weight[a] ? b : a, 'guard');
}
function pickOrder(camp) {
  const on = board(camp).map(u => UNIT[u.key]);
  return on.filter(u => u.range === 2).length >= 2 ? 'focus' : on.filter(u => u.trait === 'guard').length >= 2 ? 'shield' : 'rally';
}
// What the engine would buy this preparation, best first (merges, then the favoured trait, then cost).
function shopChoices(camp, pool) {
  const trait = favouredTrait(camp), picks = [], sim = { ...camp, gold: camp.gold, units: camp.units.map(u => ({ ...u })), shop: [...camp.shop] };
  for (;;) {
    let best = null;
    sim.shop.forEach((key, slot) => {
      if (!key || UNIT[key].tier > sim.gold || !pool[key] || (bench(sim).length >= BENCH && !wouldMerge(sim, key))) return;
      const score = (wouldMerge(sim, key) ? 10 : sim.units.some(u => u.key === key) ? 5 : 0) + (UNIT[key].trait === trait ? 4 : 0) + UNIT[key].tier * 2;
      if (!best || score > best.score) best = { slot, key, score };
    });
    if (!best) return picks;
    picks.push(best.slot); sim.gold -= UNIT[best.key].tier; sim.shop[best.slot] = null;
    sim.units.push({ uid: 'x' + picks.length, key: best.key, star: 1, cell: null }); merge(sim);
  }
}
// A plan the advising Agent shows its person: the slots to buy, then an automatic arrangement and an order.
function plan(camp, pool, round) {
  const buys = shopChoices(camp, pool), sim = JSON.parse(JSON.stringify(camp)), simPool = { ...pool };
  for (const slot of buys) buy(sim, simPool, slot);
  autoPlace(sim, round, { relayout: true });
  return { buys, buyKeys: buys.map(s => camp.shop[s]), arrange: 'auto', order: pickOrder(sim), layout: board(sim).map(u => ({ key: u.key, star: u.star, cell: u.cell })) };
}
// Carry out a plan on the real camp (offers already taken are skipped).
function applyPlan(camp, pool, round, p) {
  for (const slot of p.buys || []) buy(camp, pool, slot);
  for (const uid of p.sells || []) sell(camp, pool, uid);
  if (p.arrange === 'auto' || !Array.isArray(p.layout)) autoPlace(camp, round, { relayout: true });
  else {
    for (const u of camp.units) u.cell = null;
    for (const want of p.layout) { const u = camp.units.find(x => !x.cell && x.key === want.key && (!want.star || x.star === want.star)); if (u && CELLS.includes(want.cell) && board(camp).length < boardCap(round) && !camp.units.some(x => x.cell === want.cell)) u.cell = want.cell; }
  }
  if (ORDERS.includes(p.order)) camp.order = p.order;
  camp.v++;
}
// The engine plays a whole preparation: buy, refresh once when rich from round 3, arrange, order.
function enginePlay(camp, pool, round, seed) {
  applyPlan(camp, pool, round, plan(camp, pool, round));
  if (round >= 3 && camp.gold >= 4 && refresh(camp, pool, round, seed).ok) applyPlan(camp, pool, round, plan(camp, pool, round));
}

module.exports = { ROUNDS, START_HP, BENCH, SHOP, REFRESH_COST, ROWS, COLS, CELLS, TICKS, TRAITS, ORDERS, UNITS, UNIT, STAR_MULT, COPIES, POOL, ODDS,
  income, boardCap, sellValue, newPool, newCamp, rollShop, bench, board, merge, buy, sell, refresh, move, setOrder, autoPlace, traits, level,
  battle, damageOf, resolveRound, plan, applyPlan, enginePlay, rngFor };
