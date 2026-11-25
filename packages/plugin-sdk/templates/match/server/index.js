// SPDX-License-Identifier: Apache-2.0
/// <reference types="@aiatt/plugin-sdk" />
// __NAME__ (room-plugin@1): the rules are pure functions of the state. The platform checks the seat, the turn and the
// action's fields against plugin.json before apply() runs, and keeps the clock, the log and who sees what.
// Not allowed here: process, timers, Date, Math.random, eval, network, files. Randomness is ctx.rng(), time is ctx.now.
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const other = (state, seat) => state.order.find(id => id !== seat);
const free = board => board.map((value, index) => (value === null ? index : -1)).filter(index => index >= 0);

module.exports = definePlugin({
  // Start of a match: seats (in seating order), config (the options from plugin.json), rng, now.
  setup({ seats, config, rng }) {
    const order = seats.map(seat => seat.id);
    if (config.first === 'seat2' || (config.first === 'random' && rng() < 0.5)) order.reverse();
    return { board: Array(9).fill(null), marks: { [order[0]]: 'X', [order[1]]: 'O' }, order, turn: order[0], winner: null, draw: false };
  },
  // Who may do what now. The first action listed is the main one. `key` makes the clock restart every move.
  decisions(state) {
    if (state.winner || state.draw) return [];
    return [{ actor: state.turn, actions: ['place', 'resign'], key: state.board.filter(Boolean).length }];
  },
  // One action by ctx.actor: return { state, events } or { error, message } (the step is refused, the state kept).
  apply(state, action, { actor }) {
    if (action.type === 'resign') return { state: { ...state, winner: other(state, actor) }, events: [{ type: 'resigned', actor }] };
    if (state.turn !== actor) return { error: 'NOT_YOUR_TURN' };
    if (state.board[action.cell] !== null) return { error: 'CELL_TAKEN', message: 'That cell is taken' };
    const board = state.board.slice();
    board[action.cell] = state.marks[actor];
    const won = LINES.some(line => line.every(index => board[index] === state.marks[actor]));
    return { state: { ...state, board, turn: other(state, actor), winner: won ? actor : null, draw: !won && board.every(Boolean) }, events: [{ type: 'placed', actor, cell: action.cell }] };
  },
  // The deadline passed: the move the platform makes for that seat.
  timeout(state, decision, { rng }) { return { type: 'place', cell: rng.pick(free(state.board)) }; },
  // A seat the platform plays itself (a Bot): take a winning cell, block one, else the centre, else any.
  engine(state, decision, { rng }) {
    if (!decision.actions.includes('place')) return null;
    const mine = state.marks[decision.actor], theirs = state.marks[other(state, decision.actor)];
    for (const mark of [mine, theirs]) {
      for (const line of LINES) {
        const cells = line.map(index => state.board[index]);
        if (cells.filter(value => value === mark).length === 2 && cells.includes(null)) return { type: 'place', cell: line[cells.indexOf(null)] };
      }
    }
    return { type: 'place', cell: state.board[4] === null ? 4 : rng.pick(free(state.board)) };
  },
  // What `viewer` (a seat id, or null for a spectator) may see. Everything is public here; with hidden information
  // leave it out of the view and list it in secrets() so the leak check can find it.
  view(state, viewer) { return { board: state.board, turn: state.turn, marks: state.marks, you: viewer, winner: state.winner, draw: state.draw }; },
  result(state, { t, seats }) {
    const name = id => (seats.find(seat => seat.id === id) || {}).name || id;
    if (state.winner) return { done: true, ranking: [[state.winner], [other(state, state.winner)]], summary: t('summary.win', { name: name(state.winner) }) };
    if (state.draw) return { done: true, ranking: [state.order], summary: t('summary.draw') };
    return { done: false };
  },
});
