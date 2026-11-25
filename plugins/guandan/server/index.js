// SPDX-License-Identifier: Apache-2.0
// Guandan Partner (掼蛋搭档) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md). Four
// seats, two teams: seats 0 and 2 (South–North) against 1 and 3 (East–West), playing counter-clockwise. Two decks,
// 27 cards each, shuffled for every deal from the committed seed (sha256 of salt|seed). Cards and combinations are in
// ./combo.js: a seat plays a combination that beats the last one or passes; three passes and the last player (or the
// next one still in) leads a new trick; the hearts of the level are wild. Finishing order ranks the deal; the first
// one's team goes up 3 (partner second: double-down, which ends the deal at once), 2 (partner last) or 1 levels.
// A team at A that wins a deal wins the match; a gap of 6 levels, or 8 deals, ends it by level. A seat that runs out
// of time passes (or leads its first legal move); a seat that leaves forfeits its team. Who sits where (a person and
// their paired Agent) and the coins are the platform's (lib/games/guandan/guandan.js).
const cb = require('./combo');
const { mulberry32, deckOrder, upgradeFor, judgeByLevel } = require('./rules');
const TEAM_NAMES = { A: '南北', B: '东西' };
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const bad = (error, message) => ({ error, message, status: 400 });
const clone = value => JSON.parse(JSON.stringify(value));
const level = state => Math.max(...state.teams.map(t => t.level)); // the deal's level: the higher team's
const teamOf = (state, id) => state.teams.find(t => t.id === id);
const partnerIdx = (state, i) => teamOf(state, state.seats[i].team).seats.find(x => x !== i);
const lastPlay = state => { for (let i = state.trick.length - 1; i >= 0; i--) if (!state.trick[i].pass) return state.trick[i]; return null; };
const target = state => { const lp = lastPlay(state); return lp ? { type: lp.type, anchor: lp.anchor, len: lp.len } : null; };
const nextLive = (state, from) => { for (let step = 1; step <= 4; step++) { const i = (from + step) % 4; if (state.seats[i].rank === 0) return i; } return from; };

function deal(state, now, leader, events) {
  const s = clone(state), handNo = s.handNo + 1, deck = deckOrder(s.seed, handNo);
  s.seats.forEach((seat, i) => { seat.hand = deck.slice(i * cb.HAND_SIZE, (i + 1) * cb.HAND_SIZE); seat.rank = 0; seat.lastAction = null; });
  Object.assign(s, { handNo, dealRanks: [], trick: [], passStreak: 0, trickSeq: s.trickSeq + 1, betweenDeals: false, leader, turn: leader, actEndsAt: now + s.actMs });
  events.push({ type: 'deal', handNo, leader, wild: level(s) });
  return s;
}
function finishMatch(state, winTeamId, summary, forfeit = false) {
  return { ...state, status: 'finished', betweenDeals: false, turn: -1, actEndsAt: 0, result: { winTeamId, summary, forfeit, levels: { A: state.teams[0].level, B: state.teams[1].level } } };
}
// A deal ends: the first finisher's team goes up; the match may end; otherwise the next deal is scheduled.
function endDeal(s, now, events) {
  const levelsBefore = Object.fromEntries(s.teams.map(t => [t.id, t.level])), ranks = new Map(s.dealRanks.map((si, k) => [si, k + 1]));
  const headIdx = s.dealRanks[0], head = s.seats[headIdx], winTeam = teamOf(s, head.team), mateIdx = partnerIdx(s, headIdx), mateRank = ranks.get(mateIdx) || 4;
  const delta = upgradeFor(mateRank), wasAtA = winTeam.level >= cb.LEVEL_MAX;
  if (!wasAtA) { winTeam.level = Math.min(cb.LEVEL_MAX, winTeam.level + delta); winTeam.reachedAt = s.handNo; }
  const rankLine = s.dealRanks.map((si, k) => `${k + 1}.${s.seats[si].name}`).join(' '), levelDelta = winTeam.level - levelsBefore[winTeam.id];
  const summary = `${rankLine}。${TEAM_NAMES[winTeam.id]}队头游${wasAtA ? '已处 A 级' : `升 ${levelDelta} 级 → ${cb.RANK_GLYPH[winTeam.level] || winTeam.level}`}（${s.seats[mateIdx].name} 第${mateRank}名）`;
  s.handHistories = [...(s.handHistories || []), { summaryCode: 'GUANDAN_HAND_SETTLED', handNo: s.handNo, finishedAt: now, winTeamId: winTeam.id, mateRank,
    ranks: s.dealRanks.map((si, k) => ({ seatId: s.seats[si].id, seatIdx: si, name: s.seats[si].name, team: s.seats[si].team, rank: k + 1 })),
    levelBefore: levelsBefore[winTeam.id], levelAfter: winTeam.level, levelDelta, levelsBefore, levels: Object.fromEntries(s.teams.map(t => [t.id, t.level])), summary }].slice(-5);
  events.push({ type: 'dealEnd', handNo: s.handNo, rankLine, team: winTeam.id, wasAtA, delta, level: winTeam.level, mate: mateIdx, mateRank });
  if (wasAtA) return finishMatch(s, winTeam.id, `${TEAM_NAMES[winTeam.id]}队打过 A，通关获胜！`);
  const gap = Math.abs(s.teams[0].level - s.teams[1].level);
  if (gap >= s.levelGap) { const hi = s.teams[0].level >= s.teams[1].level ? s.teams[0] : s.teams[1]; return finishMatch(s, hi.id, `闪电判定：级差达 ${gap} 级，${TEAM_NAMES[hi.id]}队（${cb.RANK_GLYPH[hi.level] || hi.level} 级）胜`); }
  if (s.handNo >= s.handCap) {
    return finishMatch(s, judgeByLevel(s.teams, s.seed), `闪电判定：${s.handCap} 局未通关，按级差判定终局`);
  }
  Object.assign(s, { betweenDeals: true, nextDealAt: now + s.nextDealMs, leader: headIdx, turn: -1, actEndsAt: 0 });
  events.push({ type: 'next', leader: headIdx });
  return s;
}
// A seat played its last card: its rank; a double-down or the third finisher ends the deal.
function finished(s, i, now, events) {
  s.dealRanks.push(i);
  const rank = s.dealRanks.length, mate = s.seats[partnerIdx(s, i)];
  s.seats[i].rank = rank;
  events.push({ type: 'finished', seat: i, rank });
  if (rank === 2 && mate.rank === 1) {
    const rest = []; for (let step = 1; step <= 4; step++) { const j = (i + step) % 4; if (s.seats[j].rank === 0) rest.push(j); }
    s.seats[rest[0]].rank = 3; s.seats[rest[1]].rank = 4; s.dealRanks.push(rest[0], rest[1]);
    events.push({ type: 'doubleDown', team: s.seats[i].team, third: rest[0], fourth: rest[1] });
    return endDeal(s, now, events);
  }
  if (rank === 3) { const last = s.seats.findIndex(x => x.rank === 0); if (last >= 0) { s.seats[last].rank = 4; s.dealRanks.push(last); } return endDeal(s, now, events); }
  s.turn = nextLive(s, s.turn); s.actEndsAt = now + s.actMs;
  return s;
}

module.exports = definePlugin({
  setup({ seats, config, rng, now, sha256 }) {
    const seed = rng.int(1, 2147483646), salt = hex(rng, 24);
    const base = { status: 'playing', seed, salt, commitHash: sha256(`${salt}|${seed}`), actMs: config.actMs, nextDealMs: config.nextDealMs, handCap: config.handCap, levelGap: config.levelGap,
      seats: seats.map((s, i) => ({ id: s.id, name: s.name || s.id, isAgent: s.kind !== 'human', team: i % 2 === 0 ? 'A' : 'B', hand: [], rank: 0, lastAction: null })),
      teams: [{ id: 'A', name: TEAM_NAMES.A, seats: [0, 2], level: 2, reachedAt: 0 }, { id: 'B', name: TEAM_NAMES.B, seats: [1, 3], level: 2, reachedAt: 0 }],
      handNo: 0, leader: -1, turn: -1, trick: [], passStreak: 0, trickSeq: 0, actEndsAt: 0, betweenDeals: false, nextDealAt: 0, dealRanks: [], handHistories: [], result: null };
    // The first deal's lead goes to the team the committed seed picks.
    const aFirst = mulberry32(seed ^ 0x51ab)() < 0.5;
    return deal(base, now, aFirst ? 0 : 1, []);
  },
  decisions(state) {
    if (state.status !== 'playing') return [];
    if (state.betweenDeals) return [{ actor: state.seats[state.leader].id, actions: ['deal'], deadlineAt: state.nextDealAt, key: `d:${state.handNo}` }];
    return [{ actor: state.seats[state.turn].id, actions: ['play', 'pass'], deadlineAt: state.actEndsAt, key: `t:${state.handNo}:${state.trickSeq}` }];
  },
  apply(state, action, { actor, now, system }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER', message: '对局已结束' };
    const events = [];
    if (action.type === 'deal') return now < state.nextDealAt ? { error: 'TOO_EARLY', message: '下一局还没到时间' } : { state: deal(state, now, state.leader, events), events };
    const i = state.seats.findIndex(x => x.id === actor), s = clone(state), seat = s.seats[i], auto = system === true;
    if (action.type === 'pass') {
      if (!target(state)) return bad('MUST_LEAD', '本轮无人出牌，你必须领出（不可过）');
      seat.lastAction = { type: 'pass', name: '过', cards: [], at: now, auto };
      s.trick.push({ seat: i, pass: true, auto }); s.passStreak++; s.trickSeq++;
      events.push({ type: 'pass', seat: i, auto });
      if (s.passStreak >= 3) {
        // Three passes: the last player leads again (or, if out, the next one still in).
        let lead = lastPlay(s).seat;
        if (s.seats[lead].rank > 0) lead = nextLive(s, lead);
        Object.assign(s, { trick: [], passStreak: 0, trickSeq: s.trickSeq + 1, leader: lead, turn: lead, actEndsAt: now + s.actMs });
        events.push({ type: 'lead', seat: lead });
        return { state: s, events };
      }
      s.turn = nextLive(s, s.turn); s.actEndsAt = now + s.actMs;
      return { state: s, events };
    }
    const mv = cb.enumerateMoves(seat.hand, level(state), target(state)).find(m => m.id === String(action.combo || ''));
    if (!mv) return bad('BAD_MOVE', `combo id 无效（${action.combo || '空'}）——只可选 privateView.legalMoves 中的 id`);
    seat.hand = seat.hand.filter(c => !mv.cards.includes(c));
    seat.lastAction = { type: mv.type, name: mv.name, cards: mv.cards.slice(), at: now, auto };
    s.trick.push({ seat: i, type: mv.type, name: mv.name, cards: mv.cards.slice(), anchor: mv.anchor, len: mv.len, size: mv.size, auto });
    s.passStreak = 0; s.trickSeq++;
    events.push({ type: 'play', seat: i, name: mv.name, cards: mv.cards, combo: mv.type, auto, led: !target(state) });
    if (!seat.hand.length) return { state: finished(s, i, now, events), events };
    s.turn = nextLive(s, s.turn); s.actEndsAt = now + s.actMs;
    return { state: s, events };
  },
  // Time ran out: the next deal; or a pass if passing is allowed, else the seat's first legal lead.
  timeout(state, decision) {
    if (decision.actions.includes('deal')) return { type: 'deal' };
    if (target(state)) return { type: 'pass' };
    const seat = state.seats[state.turn], mv = cb.enumerateMoves(seat.hand, level(state), null)[0];
    return mv ? { type: 'play', combo: mv.id } : null;
  },
  // A seat that leaves forfeits its team.
  leave(state, seat) {
    const s = state.seats.find(x => x.id === seat);
    if (state.status !== 'playing' || !s) return { state, events: [] };
    const foe = s.team === 'A' ? 'B' : 'A';
    return { state: finishMatch(state, foe, `${TEAM_NAMES[s.team]}队整队退赛，${TEAM_NAMES[foe]}队判胜`, true), events: [{ type: 'forfeit', seat }] };
  },
  // Each seat sees its own hand; everyone sees the table, the trick and how many cards each holds.
  view(state, viewer) {
    return { ...state, seed: undefined, salt: undefined, seats: state.seats.map(s => ({ ...s, hand: s.id === viewer ? s.hand : undefined, cards: s.hand.length })),
      ...(state.status !== 'playing' ? { reveal: { seed: state.seed, salt: state.salt } } : {}) };
  },
  secrets(state) { return state.status === 'playing' ? [{ value: state.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const win = teamOf(state, state.result.winTeamId), lose = state.teams.find(t => t !== win);
    return { done: true, ranking: [win.seats.map(i => state.seats[i].id), lose.seats.map(i => state.seats[i].id)], summary: state.result.summary };
  },
});
