// SPDX-License-Identifier: Apache-2.0
// Sample public game states for the default plugin UI, shaped exactly like the contract between the generic plugin
// runtime and this pack (detail.state.game after the host's sanitizeState). Used by the tests and by anyone who wants to
// look at the default UI without a running plugin: render(detail(), ctx, helpers) with schemas as the manifest's `actions`.
const clone = value => JSON.parse(JSON.stringify(value));

export const ticTacToeActions = {
  place: {type: 'object', title: 'Place a mark', properties: {row: {type: 'integer', minimum: 0, maximum: 2}, col: {type: 'integer', minimum: 0, maximum: 2}}, required: ['row', 'col'], additionalProperties: false},
};
export const cardGameActions = {
  play: {type: 'object', title: 'Play a card', properties: {card: {type: 'string', enum: ['K♠', '7♦', '2♣', 'A♥']}}, required: ['card'], additionalProperties: false},
  bid: {type: 'object', properties: {amount: {type: 'integer', minimum: 0, maximum: 10}, double: {type: 'boolean'}, note: {type: 'string', maxLength: 20}}, required: ['amount'], additionalProperties: false},
  plan: {type: 'object', properties: {order: {type: 'array', items: {type: 'integer'}, maxItems: 4}}, required: ['order'], additionalProperties: false},
  pass: {type: 'object', properties: {}, additionalProperties: false},
};

const room = {id: 'room-1', name: 'Plugin table', ownerId: 'u-ann', members: ['u-ann', 'u-bob', 'u-ai'], memberInfo: {'u-ann': {name: 'Ann'}, 'u-bob': {name: 'Bob'}, 'u-ai': {name: 'Rook', isAgent: true}}};

// Tic-tac-toe, in play: it is Ann's turn (seat "X"); Bob plays "O".
export function ticTacToe() {
  return {
    room: clone(room),
    state: {game: {
      kind: 'tic-tac-toe', plugin: {id: 'tic-tac-toe', version: '1.0.0'}, status: 'playing', matchId: 'm-ttt-1',
      seats: [{seat: 'X', name: 'Ann', people: ['u-ann'], kind: 'person'}, {seat: 'O', name: 'Rook', people: ['u-ai'], kind: 'agent'}],
      view: {board: [['X', null, {t: 'O', c: 'blue'}], [null, 'X', null], [null, null, 'O']], status: 'Your move (X)', turn: 'X'},
      you: {seat: 'X', canAct: true, actions: ['place'], deadlineAt: Date.now() + 45000}, result: null, step: 5,
    }},
  };
}
// A card game with a hidden hand: this viewer sees only their own hand, the others' hands are counts.
export function hiddenHand() {
  return {
    room: clone(room),
    state: {game: {
      kind: 'high-card', plugin: {id: 'high-card', version: '0.3.0'}, status: 'playing', matchId: 'm-hc-1',
      seats: [{seat: 'a', name: 'Ann', people: ['u-ann'], kind: 'person'}, {seat: 'b', name: 'Bob', people: ['u-bob'], kind: 'person'}, {seat: 'c', name: 'Rook', people: ['u-ai'], kind: 'agent'}],
      view: {
        status: 'Round 2 of 5', prompt: 'Play a card or bid', hand: ['K♠', {t: '7♦', c: 'red'}, '2♣', 'A♥'],
        cards: [{name: 'Table', top: 'Q♣', pile: 4}], log: ['Bob played 9♠', {by: 'Rook', text: 'bid 3'}],
        scores: {a: 12, b: 7, c: 9}, handCounts: {b: 4, c: 4}, turn: 'a',
      },
      you: {seat: 'a', canAct: true, actions: ['play', 'bid', 'plan', 'pass'], deadlineAt: Date.now() + 30000}, result: null, step: 11,
    }},
  };
}
// Finished: the ranking is groups of seats (a tie shares a group), with a summary and highlights.
export function finished() {
  const detail = ticTacToe(), game = detail.state.game;
  Object.assign(game, {
    status: 'finished', view: {board: [['X', 'O', 'O'], [null, 'X', null], [null, null, 'X']], status: 'X wins on the diagonal'},
    you: {seat: 'X', canAct: false, actions: [], deadlineAt: null}, step: 9,
    result: {ranking: [['X'], ['O']], summary: 'Ann wins on the diagonal', highlights: ['Diagonal 0-0, 1-1, 2-2', {title: 'Quick win', text: 'Five moves'}]},
  });
  return detail;
}
// The same table seen by someone who is not seated: no seat, nothing to do.
export function spectator(detail = ticTacToe()) {
  const copy = clone(detail);
  copy.state.game.you = {seat: null, canAct: false, actions: [], deadlineAt: null};
  return copy;
}
// A table that is still taking seats.
export function lobby(detail = ticTacToe()) {
  const copy = clone(detail), game = copy.state.game;
  Object.assign(game, {status: 'lobby', view: null, result: null, step: 0, you: {seat: game.seats[0].seat, canAct: false, actions: [], deadlineAt: null}});
  game.seats = game.seats.map((seat, index) => ({...seat, ready: index === 0}));
  return copy;
}
export const fixtures = {ticTacToe, hiddenHand, finished};
