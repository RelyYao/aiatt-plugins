// SPDX-License-Identifier: Apache-2.0
// Undercover as a pure room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md). The match
// rules of the game framework's Undercover (lib/games/spy/spy.js), which still runs live rooms until the switch-over
// (P3). Each seat is a squad (a person and their paired Agents are seated as one squad by the platform). Squads are
// shuffled; one undercover squad (two from six squads up) gets the near word, the rest the common one. In turn each
// squad still in describes its word (at most 80 characters); a turn that times out is skipped. Then every squad votes
// (votes can change, not for itself); the room owner may reveal early, everyone else waits for the deadline. A
// single top-voted squad is out (a tie removes no one). No undercover left: civilians win; undercover holding half
// the table: undercover wins; after round five: a draw. Each squad sees only its own word until the end. A squad
// whose people all left the room is out (leave); revealing early is the room host's (hostActions).
// Since P3 the framework's Undercover (lib/games/spy/spy.js) runs its rules here; test/plugins/plugin-spy.test.js
// plays the framework (with its own checks: whose squad, who the host is) beside the bare plugin step by step.
const words = require('./words');
const DESC_LIMIT = 80, ROUNDS_MAX = 5, DESCRIBE_SECONDS = 75, VOTE_SECONDS = 90;
const current = state => state.squads[state.turnIdx % state.squads.length];
const alive = state => state.squads.filter(s => s.alive);
function advance(state, now) {
  const next = { ...state };
  do { next.turnIdx++; } while (next.turnIdx < next.squads.length * 2 && !next.squads[next.turnIdx % next.squads.length].alive);
  const roundDone = alive(next).every(sq => next.spoken.some(s => s.round === next.round && s.squadId === sq.id));
  if (roundDone) return { ...next, phase: 'vote', votes: {}, voteEndsAt: now + VOTE_SECONDS * 1000 };
  return { ...next, turnEndsAt: now + DESCRIBE_SECONDS * 1000 };
}
function finish(state, winner, summary, reason) { return { ...state, status: 'winner', phase: 'result', result: { winner, summary, reason } }; }
// After a squad is out (voted out or left): does the match end?
function decided(state, spiesGone, spiesHalf) {
  const spiesAlive = state.spySquads.filter(id => state.squads.find(s => s.id === id).alive).length;
  if (spiesAlive === 0) return finish(state, 'civilian', ...spiesGone);
  if (spiesAlive >= Math.ceil(alive(state).length / 2)) return finish(state, 'spy', ...spiesHalf(spiesAlive));
  return null;
}
function reveal(state, now) {
  const tally = new Map();
  for (const target of Object.values(state.votes)) tally.set(target, (tally.get(target) || 0) + 1);
  const entries = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.length ? entries[0][1] : 0, topSquads = entries.filter(([, n]) => n === top).map(([id]) => id);
  const nameOf = id => (state.squads.find(s => s.id === id) || {}).name || id;
  const single = topSquads.length === 1 && top > 0;
  const voteRow = { round: state.round, tally: entries.map(([id, n]) => ({ squadId: id, name: nameOf(id), n })), tie: !single, outSquadId: single ? topSquads[0] : null };
  let next = { ...state, voteLog: [...state.voteLog, voteRow] }, eliminated = null;
  if (single) {
    eliminated = state.squads.find(s => s.id === topSquads[0]);
    next.squads = state.squads.map(s => s.id === eliminated.id ? { ...s, alive: false } : s);
    next.revealLog = [...state.revealLog, { squadId: eliminated.id, squadName: eliminated.name, members: [eliminated.name], word: state.wordOf[eliminated.id], isSpy: state.spySquads.includes(eliminated.id), round: state.round, tally: entries.map(([id, n]) => ({ name: nameOf(id), n })) }];
  }
  const ended = decided(next, ['Every undercover squad was found. Civilians win!', 'spies-found'], n => [`Undercover squads survived to half the table (${n}). Undercover wins!`, 'spies-half']);
  if (ended) return ended;
  if (next.round >= ROUNDS_MAX) return finish(next, 'draw', 'Round limit reached. The match ends in a draw.', 'round-limit');
  let idx = next.squads.findIndex(s => s.id === (eliminated || current(state)).id);
  for (let k = 0; k <= next.squads.length; k++) { idx = (idx + 1) % next.squads.length; if (next.squads[idx].alive) break; }
  return { ...next, round: next.round + 1, phase: 'describe', turnIdx: idx, turnEndsAt: now + DESCRIBE_SECONDS * 1000 };
}

module.exports = definePlugin({
  setup({ seats, config, rng, now }) {
    const squads = rng.shuffle(seats.map(s => ({ id: s.id, name: s.name || s.id, alive: true })));
    const spySquads = squads.slice(0, squads.length >= 6 ? 2 : 1).map(s => s.id);
    const pair = words.pickWordPair(config.difficulty, { lang: config.lang, rng });
    const wordOf = Object.fromEntries(squads.map(s => [s.id, spySquads.includes(s.id) ? pair.spy : pair.civilian]));
    return { status: 'playing', squads, wordOf, spySquads, phase: 'describe', round: 1, turnIdx: 0, turnEndsAt: now + DESCRIBE_SECONDS * 1000,
      spoken: [], votes: {}, voteEndsAt: 0, revealLog: [], voteLog: [], result: null, difficulty: pair.difficulty, lang: config.lang };
  },
  decisions(state) {
    if (state.status !== 'playing') return [];
    // The clocks are the state's own, so a match taken over mid-way keeps its deadlines.
    if (state.phase === 'describe') return [{ actor: current(state).id, actions: ['describe', 'pass'], deadlineAt: state.turnEndsAt, key: `d:${state.round}:${state.turnIdx}` }];
    // Squads still in vote; the room host reveals early with ctx.host, seated or not (hostActions).
    return alive(state).map(s => ({ actor: s.id, actions: ['vote', 'reveal'], deadlineAt: state.voteEndsAt, key: `v:${state.round}` }));
  },
  apply(state, action, { actor, now, host }) {
    if (state.status !== 'playing') return { error: 'NO_GAME' };
    const squad = state.squads.find(s => s.id === actor);
    if (action.type === 'describe' || action.type === 'pass') {
      if (state.phase !== 'describe') return { error: 'BAD_PHASE' };
      if (current(state).id !== actor) return { error: 'NOT_YOUR_TURN' };
      if (action.type === 'pass') {
        if (now < state.turnEndsAt) return { error: 'TOO_EARLY' };
        return { state: advance({ ...state, spoken: [...state.spoken, { round: state.round, squadId: actor, squadName: squad.name, text: '(skipped: timed out)', skipped: true }] }, now), events: [{ type: 'skipped', actor }] };
      }
      if (now >= state.turnEndsAt) return { error: 'TURN_EXPIRED' };
      const text = String(action.text || '').trim();
      if (!text) return { error: 'EMPTY_DESC', status: 400 };
      if (text.length > DESC_LIMIT) return { error: 'MESSAGE_TOO_LONG', status: 400 };
      return { state: advance({ ...state, spoken: [...state.spoken, { round: state.round, squadId: actor, squadName: squad.name, text, skipped: false }] }, now), events: [{ type: 'described', actor, text }] };
    }
    if (state.phase !== 'vote') return { error: 'BAD_PHASE' };
    if (action.type === 'vote') {
      if (now >= state.voteEndsAt) return { error: 'VOTE_EXPIRED' };
      const target = state.squads.find(s => s.id === action.seat);
      if (!target || !target.alive) return { error: 'BAD_TARGET', status: 400 };
      if (target.id === actor) return { error: 'SELF_VOTE', status: 400 };
      return { state: { ...state, votes: { ...state.votes, [actor]: target.id } }, events: [{ type: 'voted', actor }] };
    }
    if (now < state.voteEndsAt && !host) return { error: 'OWNER_ONLY', status: 403 };
    if (!Object.keys(state.votes).length && now < state.voteEndsAt) return { error: 'NO_VOTES' };
    const next = reveal(state, now), out = next.voteLog.at(-1).outSquadId;
    return { state: next, events: [{ type: 'revealed', round: state.round, out, ...(next.result ? { winner: next.result.winner } : {}) }] };
  },
  // Every person behind a squad left the room: the squad is out, its word shown. The match may end there; if it was
  // that squad's turn to describe, the next squad's turn begins.
  leave(state, seat, { now }) {
    const squad = state.squads.find(s => s.id === seat);
    if (!squad?.alive || state.status !== 'playing') return { state, events: [] };
    const next = { ...state, squads: state.squads.map(s => s.id === seat ? { ...s, alive: false } : s),
      revealLog: [...state.revealLog, { squadId: seat, squadName: squad.name, members: [], word: state.wordOf[seat], isSpy: state.spySquads.includes(seat), round: state.round, tally: [] }] };
    const events = [{ type: 'disbanded', seat }];
    const ended = decided(next, ['The undercover squad left after unbinding. Civilians win!', 'spy-left'], () => ['A civilian squad left and undercover now holds half the table. Undercover wins!', 'civilian-left']);
    if (ended) return { state: ended, events };
    return { state: next.phase === 'describe' && current(next).id === seat ? advance(next, now) : next, events };
  },
  // A describe turn that runs out is skipped; a vote that runs out is revealed.
  timeout(state, decision) { return decision.actions.includes('describe') ? { type: 'pass' } : { type: 'reveal' }; },
  view(state, viewer) {
    const ended = state.status !== 'playing';
    return {
      status: state.status, phase: state.phase, round: state.round, difficulty: state.difficulty, lang: state.lang,
      seats: state.squads.map((s, i) => ({ id: s.id, no: i + 1, name: s.name, alive: s.alive })),
      turnSeatId: state.phase === 'describe' && !ended ? current(state).id : null, turnEndsAt: state.turnEndsAt, voteEndsAt: state.voteEndsAt,
      spoken: state.spoken, revealLog: state.revealLog, voteLog: state.voteLog, voteCount: Object.keys(state.votes).length, aliveCount: alive(state).length, result: state.result,
      rules: { descLimit: DESC_LIMIT, voteWindowSec: VOTE_SECONDS, roundsMax: ROUNDS_MAX },
      ...(ended ? { wordOf: state.wordOf, spySeats: state.spySquads } : {}),
      ...(viewer && state.wordOf[viewer] !== undefined ? { mine: { word: state.wordOf[viewer], votedSeatId: state.phase === 'vote' ? state.votes[viewer] || null : null } } : {}),
    };
  },
  // For the leak check (lib/plugins/plugin-conformance.js): while the match runs, a word not yet revealed (an
  // eliminated squad's word is shown to everyone) may be seen only by the squads that hold it.
  secrets(state) {
    if (state.status !== 'playing') return [];
    const revealed = new Set(state.revealLog.map(r => r.word)), holders = {};
    for (const [seat, word] of Object.entries(state.wordOf)) if (!revealed.has(word)) (holders[word] ||= []).push(seat);
    return Object.entries(holders).map(([value, visibleTo]) => ({ value, visibleTo }));
  },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const spies = state.spySquads, civilians = state.squads.map(s => s.id).filter(id => !spies.includes(id)), winner = state.result.winner;
    const ranking = winner === 'draw' ? [[...civilians, ...spies]] : winner === 'spy' ? [spies, civilians] : [civilians, spies];
    return { done: true, ranking, summary: state.result.summary };
  },
});
