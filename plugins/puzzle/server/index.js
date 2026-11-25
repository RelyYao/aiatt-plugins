// SPDX-License-Identifier: Apache-2.0
// Puzzle Exchange (谜题交易所) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md).
// Two sides, two rounds. In round 1 the first side sets a puzzle (lights, pipes or cipher, from the shared templates
// in the plugin kit) and the second solves it; in round 2 they swap. The puzzle's solution is committed
// (sha256 of salt|solution) when it is set and revealed when the round ends, so anyone can check it was not changed.
// Solving scores the solvers 2 + difficulty − hints used (at least 1) and the setters the difficulty; an unsolved
// puzzle (time up, out of guesses, forfeited) scores the setters 5 and the solvers 1. A setter that runs out of time
// gets a standard lights puzzle. A house side (a seat the platform plays) sets a random template and, solving, makes
// one attempt whose odds fall with the difficulty. The higher total after two rounds wins; a side that leaves loses.
const T = require('@aiatt/plugin-kit/puzzle-templates');
const DESIGN_MS = 120 * 1000;
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const setterOf = state => state.squads.find(s => s.id === state.setterSquad);
const solverOf = state => state.squads.find(s => s.id === state.solverSquad);
const house = (seats, id) => seats.some(s => s.id === id && (s.kind === 'bot' || s.engine));
const fail = (error, message, status) => ({ error, message, ...(status ? { status } : {}) });
const bad = (error, message) => fail(error, message, 400); // the input itself is malformed

function finish(state, winner, summary) {
  return { ...state, status: 'finished', phase: 'result', result: { winner: winner ? winner.id : null, winnerName: winner ? winner.name : null, summary } };
}
// The round ends: reveal, score, then swap sides or end the match.
function settleRound(state, solved, reason, by, { now, sha256 }) {
  const p = state.puzzle, d = p.difficulty, setter = setterOf(state), solver = solverOf(state);
  const solveSec = Math.max(1, Math.round((now - (state.solveEndsAt - T.solveWindowSec(p.template, d) * 1000)) / 1000));
  const reveal = { salt: p.salt, seed: p.seed, solution: p.solution, hints: p.hints, verified: sha256(p.salt + '|' + JSON.stringify(p.solution)) === p.commitHash };
  const solvedBy = solved ? { id: by?.id || null, name: by?.name || 'Solvers' } : null;
  const solverDelta = solved ? Math.max(1, 2 + d - p.hintsUsed) : 1, setterDelta = solved ? d : 5;
  const scores = { ...state.scores, [solver.id]: state.scores[solver.id] + solverDelta, [setter.id]: state.scores[setter.id] + setterDelta };
  const history = [...state.history, { round: state.round, template: p.template, difficulty: d, solved, reason, byName: solvedBy ? solvedBy.name : null, hintsUsed: p.hintsUsed, solveSec,
    setterSquad: setter.id, solverSquad: solver.id, delta: { [solver.id]: solverDelta, [setter.id]: setterDelta }, reveal }];
  const events = [{ type: 'settled', round: state.round, solved, reason, seconds: solveSec, hints: p.hintsUsed, verified: reveal.verified, setterDelta, solverDelta }];
  const next = { ...state, puzzle: { ...p, reveal, solvedBy }, scores, history };
  if (state.round === 1) {
    events.push({ type: 'swapped' });
    return { state: { ...next, round: 2, setterSquad: solver.id, solverSquad: setter.id, puzzle: null, phase: 'design', designEndsAt: now + DESIGN_MS }, events };
  }
  const [a, b] = state.squads, scoreA = scores[a.id] || 0, scoreB = scores[b.id] || 0, winner = scoreA === scoreB ? null : scoreA > scoreB ? a : b;
  const summary = winner ? `Two-round score ${Math.max(scoreA, scoreB)} : ${Math.min(scoreA, scoreB)}, ${winner.name} wins` : `Two-round score ${scoreA} : ${scoreB}, a draw`;
  return { state: finish(next, winner, summary), events };
}
function design(state, action, { now, rng, sha256 }) {
  const template = String(action.template || '').trim();
  if (!T.TEMPLATES[template]) return bad('BAD_TEMPLATE', `Puzzle template must be one of ${Object.keys(T.TEMPLATES).join('/')}`);
  const norm = T.normalizeParams(template, action.params);
  if (norm.code) return bad(norm.error, norm.message);
  const asked = Number(action.seed), seed = Number.isFinite(asked) && asked >= 1 && asked <= 2147483647 ? Math.round(asked) : rng.int(1, 2147483646);
  const puzzle = T.generate(template, norm.params, seed), salt = hex(rng, 16), commitHash = sha256(salt + '|' + JSON.stringify(puzzle.solution));
  const seconds = T.solveWindowSec(template, puzzle.difficulty);
  return { state: { ...state, phase: 'solve', solveEndsAt: now + seconds * 1000,
    puzzle: { template, params: norm.params, seed, difficulty: puzzle.difficulty, meta: puzzle.meta, commitHash, salt, board: puzzle.board, solution: puzzle.solution, hints: puzzle.hints, hintsRevealed: [], hintsUsed: 0, solvedBy: null, reveal: null } },
  events: [{ type: 'locked', round: state.round, template, difficulty: puzzle.difficulty, commit: commitHash.slice(0, 8), seconds }] };
}

module.exports = definePlugin({
  setup({ seats, now }) {
    const squads = seats.map(s => ({ id: s.id, name: s.name || s.id }));
    return { status: 'playing', phase: 'design', round: 1, squads, setterSquad: squads[0].id, solverSquad: squads[1].id, puzzle: null,
      designEndsAt: now + DESIGN_MS, solveEndsAt: 0, scores: { [squads[0].id]: 0, [squads[1].id]: 0 }, history: [], result: null };
  },
  // The setter designs before its deadline; the solver plays the puzzle (or a house side makes its one attempt).
  decisions(state, { seats }) {
    if (state.status !== 'playing') return [];
    if (state.phase === 'design') return [{ actor: state.setterSquad, actions: ['design'], deadlineAt: state.designEndsAt, key: `d:${state.round}` }];
    const solving = house(seats, state.solverSquad) ? ['attempt', 'pass'] : [state.puzzle.template === 'cipher' ? 'guess' : 'toggle', 'hint', 'forfeit', 'pass'];
    return [{ actor: state.solverSquad, actions: solving, deadlineAt: state.solveEndsAt, key: `s:${state.round}` }];
  },
  apply(state, action, ctx) {
    if (state.status !== 'playing') return fail('GAME_OVER', 'The match is over');
    if (action.type === 'design') return design(state, action, ctx);
    const p = state.puzzle, by = { id: ctx.actor, name: (state.squads.find(s => s.id === ctx.actor) || {}).name };
    if (action.type === 'pass') return ctx.now < state.solveEndsAt ? fail('TOO_EARLY', "This phase hasn't expired yet; nothing to settle") : settleRound(state, false, 'timeout', null, ctx);
    if (action.type === 'forfeit') return settleRound(state, false, 'forfeit', null, ctx);
    if (action.type === 'attempt') {
      if (!house(ctx.seats, ctx.actor)) return fail('NOT_HOUSE', 'Only a house side attempts a puzzle this way');
      const solved = ctx.rng.int(0, 99) < Math.max(15, 80 - 15 * (p.difficulty || 1));
      return settleRound(state, solved, solved ? 'solved' : 'forfeit', by, ctx);
    }
    if (action.type === 'hint') {
      if (p.hintsUsed >= T.HINTS_PER_ROUND) return fail('HINT_EXHAUSTED', `No hints left this round (${T.HINTS_PER_ROUND} per round)`);
      const next = p.hints[p.hintsUsed];
      return { state: { ...state, puzzle: { ...p, hintsUsed: p.hintsUsed + 1, hintsRevealed: [...p.hintsRevealed, T.describeHint(next)] } }, events: [{ type: 'hint', index: p.hintsUsed }] };
    }
    if (action.type === 'toggle') {
      const n = p.template === 'lights' ? p.board.size ** 2 : p.board.cols * p.board.rows, idx = action.idx;
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) return bad('BAD_INDEX', `Cell index must be an integer from 0 to ${n - 1}`);
      const board = T.applyMove(p.template, p.board, { idx }), next = { ...state, puzzle: { ...p, board } };
      return T.isSolved(p.template, board) ? settleRound(next, true, 'solved', by, ctx) : { state: next, events: [] };
    }
    // guess (cipher)
    const seq = Array.isArray(action.seq) ? action.seq : [], { length, colors } = p.params;
    if (seq.length !== length || seq.some(v => !Number.isInteger(v) || v < 0 || v >= colors)) return bad('BAD_PARAMS', `A guess must be ${length} color numbers from 0 to ${colors - 1}`);
    const board = T.applyGuess(p.board, p.solution.secret, seq), next = { ...state, puzzle: { ...p, board } };
    if (T.isSolved('cipher', board)) return settleRound(next, true, 'solved', by, ctx);
    if (T.isFailed('cipher', board)) return settleRound(next, false, 'exhausted', null, ctx);
    return { state: next, events: [] };
  },
  // A setter out of time gets a standard lights puzzle; a solver out of time has not solved it.
  timeout(state) { return state.phase === 'design' ? { type: 'design', template: 'lights' } : { type: 'pass' }; },
  // A house side: a random template to set, one attempt to solve.
  engine(state, decision, { rng }) {
    if (decision.actions.includes('design')) return { type: 'design', template: rng.pick(Object.keys(T.TEMPLATES)) };
    return decision.actions.includes('attempt') ? { type: 'attempt' } : null;
  },
  leave(state, seat) {
    const other = state.squads.find(s => s.id !== seat);
    if (state.status !== 'playing' || !other) return { state, events: [] };
    return { state: finish(state, other, `${other.name} wins: the other side left`), events: [{ type: 'left', seat }] };
  },
  // The solution, the seed, the salt and the hints not yet used stay on the server until the round ends.
  view(state) {
    const p = state.puzzle;
    return { ...state, puzzle: p && { template: p.template, params: p.params, difficulty: p.difficulty, meta: p.meta, commitHash: p.commitHash, board: p.board,
      hintsUsed: p.hintsUsed, hintsRevealed: p.hintsRevealed, solvedBy: p.solvedBy, ...(p.reveal ? { reveal: p.reveal } : {}) },
    history: state.history };
  },
  secrets(state) { return state.puzzle && !state.puzzle.reveal ? [{ value: state.puzzle.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const [a, b] = state.squads, w = state.result.winner;
    return { done: true, ranking: w === null ? [[a.id, b.id]] : [[w], [w === a.id ? b.id : a.id]], summary: state.result.summary };
  },
});
