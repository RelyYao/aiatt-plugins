// SPDX-License-Identifier: Apache-2.0
// Puzzle Forge (造物擂台) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md): one
// challenge. A squad attempts a level another squad built (its puzzle, solution and hints come with the match's
// config; the platform keeps the level library, the ladder and the coins — lib/games/forge/forge.js). The squad
// toggles cells or guesses a code (the plugin kit's templates), may take two hints, may give up, and has until the
// level's solving window runs out. The end reveals the solution, checked against the level's published commitment.
// Without a level in the config (developer tools, a practice table) it builds a lights level of its own.
const T = require('@aiatt/plugin-kit/puzzle-templates');
const HINTS = T.HINTS_PER_ROUND;
const bad = (error, message) => ({ error, message, status: 400 });
const clone = value => JSON.parse(JSON.stringify(value));
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
// A practice level: a seeded lights puzzle, committed as a built level is.
function practiceLevel(rng, sha256) {
  const seed = rng.int(1, 2147483646), params = { size: 4, clicks: 3 }, puzzle = T.generate('lights', params, seed), salt = hex(rng, 16);
  return { template: 'lights', params, seed, difficulty: puzzle.difficulty, board: puzzle.board, solution: puzzle.solution, hints: puzzle.hints, salt, commitHash: sha256(salt + '|' + JSON.stringify(puzzle.solution)) };
}

const ints = (list, n) => Array.isArray(list) && list.length === n && list.every(Number.isInteger);
const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
// A level from the library is trusted only when it has the shape its template plays on (board, solution, hints,
// commitment); anything else (an empty or half-built object) is not a level, and the table gets a practice one.
function usableLevel(lv) {
  if (!lv || typeof lv !== 'object' || Array.isArray(lv) || typeof lv.salt !== 'string' || typeof lv.commitHash !== 'string') return false;
  const { board, solution, hints } = lv;
  if (!board || typeof board !== 'object' || !solution || typeof solution !== 'object' || !Array.isArray(hints) || !hints.every(h => h && typeof h === 'object')) return false;
  if (lv.template === 'lights') return whole(board.size, 1, 8) && ints(board.cells, board.size ** 2) && Array.isArray(solution.cells);
  if (lv.template === 'pipes') return whole(board.cols, 1, 12) && whole(board.rows, 1, 12) && ints(board.rots, board.cols * board.rows) && ints(board.masks, board.cols * board.rows);
  if (lv.template === 'cipher') return whole(board.length, 1, 12) && whole(board.colors, 1, 12) && whole(board.maxGuesses, 1, 100) && Array.isArray(board.guesses) && Array.isArray(solution.secret);
  return false;
}

function settle(state, solved, reason, { now, sha256 }) {
  const lv = state.level, verified = sha256(lv.salt + '|' + JSON.stringify(lv.solution)) === lv.commitHash;
  return { ...state, status: 'finished', result: { solved, reason, solveSec: Math.max(1, Math.round((now - state.startedAt) / 1000)), reveal: { salt: lv.salt, seed: lv.seed, solution: lv.solution, hints: lv.hints, verified } } };
}

module.exports = definePlugin({
  setup({ config, now, rng, sha256 }) {
    const lv = usableLevel(config.level) ? config.level : practiceLevel(rng, sha256);
    return { status: 'playing', level: clone(lv), template: lv.template, board: clone(lv.board), hintsUsed: 0, hintsRevealed: [], startedAt: now, solveEndsAt: now + config.solveMs, result: null };
  },
  decisions(state, { seats }) {
    if (state.status !== 'playing') return [];
    return [{ actor: seats[0].id, actions: [state.template === 'cipher' ? 'guess' : 'toggle', 'hint', 'giveup', 'pass'], deadlineAt: state.solveEndsAt }];
  },
  apply(state, action, ctx) {
    if (state.status !== 'playing') return { error: 'GAME_OVER' };
    if (action.type === 'pass') return ctx.now < state.solveEndsAt ? { error: 'TOO_EARLY', message: "This challenge hasn't expired yet; nothing to settle" } : { state: settle(state, false, 'timeout', ctx), events: [{ type: 'settled' }] };
    if (action.type === 'giveup') return { state: settle(state, false, 'giveup', ctx), events: [{ type: 'settled' }] };
    if (action.type === 'hint') {
      if (state.hintsUsed >= HINTS || state.hintsUsed >= state.level.hints.length) return { error: 'HINT_EXHAUSTED', message: `No hints left for this attempt (${HINTS} per attempt)` };
      return { state: { ...state, hintsUsed: state.hintsUsed + 1, hintsRevealed: [...state.hintsRevealed, T.describeHint(state.level.hints[state.hintsUsed])] }, events: [{ type: 'hint', index: state.hintsUsed }] };
    }
    if (action.type === 'toggle') {
      const b = state.board, n = state.template === 'lights' ? b.size ** 2 : b.cols * b.rows, idx = action.idx;
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) return bad('BAD_INDEX', `Cell index must be an integer from 0 to ${n - 1}`);
      const board = T.applyMove(state.template, b, { idx });
      return T.isSolved(state.template, board) ? { state: settle({ ...state, board }, true, 'solved', ctx), events: [{ type: 'settled' }] } : { state: { ...state, board }, events: [] };
    }
    const { length, colors } = state.board, seq = Array.isArray(action.seq) ? action.seq : [];
    if (seq.length !== length || seq.some(v => !Number.isInteger(v) || v < 0 || v >= colors)) return bad('BAD_PARAMS', `A guess must be ${length} color numbers from 0 to ${colors - 1}`);
    const board = T.applyGuess(state.board, state.level.solution.secret, seq);
    if (T.isSolved('cipher', board)) return { state: settle({ ...state, board }, true, 'solved', ctx), events: [{ type: 'settled' }] };
    if (T.isFailed('cipher', board)) return { state: settle({ ...state, board }, false, 'exhausted', ctx), events: [{ type: 'settled' }] };
    return { state: { ...state, board }, events: [] };
  },
  timeout() { return { type: 'pass' }; },
  // The level's solution, seed, salt and unused hints stay on the server until the challenge ends.
  view(state) {
    const { level, ...rest } = state;
    return { ...rest, level: { template: level.template, params: level.params, difficulty: level.difficulty, commitHash: level.commitHash } };
  },
  secrets(state) { return state.status === 'playing' ? [{ value: state.level.salt, visibleTo: [] }] : []; },
  // One squad against a level: the outcome is solved or not (the builder is no seat here).
  result(state, { seats }) {
    if (state.status === 'playing') return { done: false };
    return { done: true, ranking: [[seats[0].id]], summary: state.result.solved ? 'solved' : state.result.reason };
  },
});
