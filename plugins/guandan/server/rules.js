// SPDX-License-Identifier: Apache-2.0
// plugins/guandan/server/rules.js — Guandan's deal order and match rules, pure: the seeded shuffle of every deal, the
// first finisher's team's upgrade, and the judgement by level. The plugin (./index.js) plays by them and
// lib/games/guandan/guandan.js reads them (its checks of a revealed match, its tests). Cards are in ./combo.js.
'use strict';
const cb = require('./combo');
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Every deal's order: the seed and the deal's number, Fisher–Yates over 108 cards; anyone can redo it once revealed.
function deckOrder(seed, handNo) {
  const rng = mulberry32(((seed >>> 0) + Math.imul(handNo | 0, 0x9E3779B1)) >>> 0), deck = cb.makeDeck();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
// The first finisher's team goes up by its partner's place: second (double-down) +3, last +2, third +1.
function upgradeFor(mateRank) { return mateRank === 2 ? 3 : mateRank === 4 ? 2 : 1; }
// Judged by level: the higher level; the same level, the team that reached it first; still even, a coin from the seed.
function judgeByLevel(teams, seed) {
  const [a, b] = teams;
  if (a.level !== b.level) return a.level > b.level ? 'A' : 'B';
  if (a.reachedAt !== b.reachedAt) return a.reachedAt < b.reachedAt ? 'A' : 'B';
  return mulberry32(seed ^ 0xC0FFEE)() < 0.5 ? 'A' : 'B';
}
module.exports = { mulberry32, deckOrder, upgradeFor, judgeByLevel };
