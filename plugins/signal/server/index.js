// SPDX-License-Identifier: Apache-2.0
// Operation Signal (行动代号：信号) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md).
// Red and Blue, 25 words, a hidden key: 9 red words, 8 blue, 7 bystanders and the assassin (./rules.js). Red starts.
// The team to play gives a clue (a word and a number), then guesses up to number + 1 cards; a card of another colour
// ends its turn, passing ends it, the assassin loses the match, finding all of one's own words wins it. Each seat is a
// team, the first Red and the second Blue; who in it gives the clue (an Agent that sees the key) and who guesses is the platform's
// (lib/games/signal/signal.js), and so is a team that can no longer play (it concludes the match).
const R = require('./rules');
const colorOf = (state, team) => state.teams.find(t => t.id === team).color;
const other = (state, team) => state.teams.find(t => t.id !== team).id;
const bad = (error, message) => ({ error, message, status: 400 });
const endTurn = state => ({ ...state, turn: other(state, state.turn), phase: 'clue', clue: null, guessesLeft: 0 });
const finish = (state, winner, reason) => ({ ...state, status: 'finished', phase: 'result', result: { winner, reason } });

module.exports = definePlugin({
  setup({ seats, config, rng }) {
    const [red, blue] = seats;
    return { status: 'playing', phase: 'clue', turn: red.id, teams: [{ id: red.id, color: 'red', remaining: 9 }, { id: blue.id, color: 'blue', remaining: 8 }], cards: R.deal(config.lang, rng.shuffle),
      clue: null, guessesLeft: 0, history: [], result: null };
  },
  decisions(state) {
    if (state.status !== 'playing') return [];
    return [{ actor: state.turn, actions: state.phase === 'clue' ? ['clue'] : ['guess', 'pass'], deadlineAt: null }];
  },
  apply(state, action, { actor }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER' };
    if (action.type === 'clue') {
      const input = R.clueInput(state.cards, action);
      if (input.code) return bad(input.error, input.message);
      return { state: { ...state, clue: { word: input.word, number: input.number }, guessesLeft: input.number + 1, phase: 'guess', history: [...state.history, { type: 'clue', team: actor, word: input.word, number: input.number }] },
        events: [{ type: 'clue', team: actor, word: input.word, number: input.number }] };
    }
    if (action.type === 'pass') return { state: endTurn({ ...state, history: [...state.history, { type: 'pass', team: actor }] }), events: [{ type: 'pass', team: actor }] };
    const index = action.index;
    if (!Number.isInteger(index) || index < 0 || index >= state.cards.length) return bad('BAD_INDEX', 'The card index must be an integer from 0 to 24');
    const card = state.cards[index];
    if (card.state !== 'hidden') return bad('CARD_REVEALED', 'That card is already revealed');
    const cards = state.cards.map(c => c.index === index ? { ...c, state: 'revealed' } : c);
    const teams = state.teams.map(t => t.color === card.team ? { ...t, remaining: t.remaining - 1 } : t), target = teams.find(t => t.color === card.team);
    const next = { ...state, cards, teams, history: [...state.history, { type: 'guess', team: actor, index, word: card.word, role: card.role }] }, events = [{ type: 'guess', team: actor, index, word: card.word, role: card.role }];
    if (card.role === 'assassin') return { state: finish(next, other(state, actor), 'assassin'), events };
    if (target && target.remaining === 0) return { state: finish(next, target.id, 'agents_completed'), events };
    if (card.role === `${colorOf(state, actor)}-agent`) return { state: next.guessesLeft - 1 <= 0 ? endTurn(next) : { ...next, guessesLeft: next.guessesLeft - 1 }, events };
    return { state: endTurn(next), events };
  },
  // The board is public; a card's colour shows once it is revealed (and every card at the end). The key card is for
  // the clue-givers only, which the platform knows; no seat sees it here.
  view(state) {
    const over = state.status !== 'playing';
    return { ...state, cards: state.cards.map(c => over || c.state === 'revealed' ? c : { index: c.index, word: c.word, state: c.state }) };
  },
  result(state) {
    if (state.status === 'playing') return { done: false };
    return { done: true, ranking: [[state.result.winner], [other(state, state.result.winner)]] };
  },
});
