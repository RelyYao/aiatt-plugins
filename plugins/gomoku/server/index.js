// SPDX-License-Identifier: Apache-2.0
// Gomoku as a pure room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md). The same rules as the
// game framework's Gomoku (lib/games/gomoku/game.js), which still runs live rooms until the switch-over (P3):
// 15×15, board[y][x] (0 empty, 1 black, 2 white), black (the first seat) moves first, five or more in a row wins,
// a full board is a draw, a resignation hands the win to the other side. No move clock.
// test/plugins/plugin-gomoku.test.js plays both implementations side by side and compares every step.
const ai = require('./ai');
const SIZE = ai.SIZE;
const LINES = [[1, 0], [0, 1], [1, 1], [1, -1]];
function fiveFrom(board, x, y, color) {
  for (const [dx, dy] of LINES) {
    let count = 1;
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === color) { count++; nx += dx * s; ny += dy * s; }
    }
    if (count >= 5) return true;
  }
  return false;
}
const colorOf = (state, seat) => seat === state.black ? 1 : 2;
const other = (state, seat) => seat === state.black ? state.white : state.black;

module.exports = definePlugin({
  setup({ seats, config }) {
    // config.params: the engine genome for the platform-played seat (the Gomoku boss's champion); absent for everyone else.
    return { board: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)), black: seats[0].id, white: seats[1].id, turn: seats[0].id, moves: [], status: 'playing', winner: null, resultReason: null, ...(config && config.params && typeof config.params === 'object' ? { params: ai.genomeOf(config.params) } : {}) };
  },
  // The player to move places or resigns; the other may resign at any time (as in the framework's Gomoku).
  decisions(state) { return state.status === 'playing' ? [{ actor: state.turn, actions: ['place', 'resign'] }, { actor: other(state, state.turn), actions: ['resign'] }] : []; },
  apply(state, action, { actor }) {
    if (state.status !== 'playing') return { error: 'NO_GAME' };
    if (action.type === 'resign') {
      const winner = other(state, actor);
      return { state: { ...state, winner, status: winner === state.black ? 'black_win' : 'white_win', resultReason: 'resign' }, events: [{ type: 'resigned', actor }] };
    }
    if (state.turn !== actor) return { error: 'NOT_YOUR_TURN' };
    const { x, y } = action;
    if (state.board[y][x] !== 0) return { error: 'CELL_TAKEN', message: 'That point is taken' };
    const color = colorOf(state, actor), board = state.board.map(row => row.slice());
    board[y][x] = color;
    const moves = [...state.moves, { x, y, userId: actor }];
    if (fiveFrom(board, x, y, color)) return { state: { ...state, board, moves, status: color === 1 ? 'black_win' : 'white_win', winner: actor }, events: [{ type: 'placed', actor, x, y, color, won: true }] };
    if (moves.length >= SIZE * SIZE) return { state: { ...state, board, moves, status: 'draw' }, events: [{ type: 'placed', actor, x, y, color, draw: true }] };
    return { state: { ...state, board, moves, turn: other(state, actor) }, events: [{ type: 'placed', actor, x, y, color }] };
  },
  // A seat the platform plays (the built-in Bot, a platform AI): the same engine the framework's Bot uses.
  engine(state, decision, { rng }) {
    if (!decision.actions.includes('place')) return null;
    const move = ai.bestMove(state.board, colorOf(state, decision.actor), rng, state.params || null);
    return { type: 'place', x: move.x, y: move.y };
  },
  view(state) { return state; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    if (state.status === 'draw') return { done: true, ranking: [[state.black, state.white]], summary: `draw after ${state.moves.length} moves` };
    return { done: true, ranking: [[state.winner], [other(state, state.winner)]], summary: `${state.status} in ${state.moves.length} moves${state.resultReason ? ' (' + state.resultReason + ')' : ''}` };
  },
});
