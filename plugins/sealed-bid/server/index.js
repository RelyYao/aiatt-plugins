// SPDX-License-Identifier: Apache-2.0
/// <reference types="@aiatt/plugin-sdk" />
// Sealed Bid (room-plugin@1): each round one lot goes up; every seat gets a private appraisal (the true value plus
// noise) and bids in secret at the same time; the highest bid pays and takes the lot's true value. Most money
// (budget left plus the value of the lots won) wins.
const LOTS = ['jade', 'scroll', 'teapot', 'compass', 'lantern', 'inkstone', 'fan', 'clock'];
const live = state => !state.over;
const pending = state => state.order.filter(id => state.bids[id] === undefined);
const score = (state, id) => state.budget[id] + state.won[id].reduce((sum, lot) => sum + lot.value, 0);

function nextLot(state, rng) {
  const value = rng.int(10, 60), hints = {};
  for (const id of state.order) hints[id] = Math.max(1, value + rng.int(-12, 12));
  return { ...state, lot: { name: LOTS[(state.round - 1) % LOTS.length], value, hints }, bids: {} };
}

module.exports = definePlugin({
  setup({ seats, config, rng }) {
    const order = seats.map(seat => seat.id), budget = {}, won = {};
    for (const id of order) { budget[id] = config.budget; won[id] = []; }
    return nextLot({ order, rounds: config.rounds, round: 1, budget, won, history: [], over: false }, rng);
  },
  // Everyone who has not bid yet bids now, at the same time. The key keeps each clock running for the round.
  decisions(state) {
    if (!live(state)) return [];
    return pending(state).map(actor => ({ actor, actions: ['bid'], key: state.round }));
  },
  apply(state, action, { actor, rng }) {
    if (state.bids[actor] !== undefined) return { error: 'ALREADY_BID', message: 'You already bid this round' };
    if (action.amount > state.budget[actor]) return { error: 'OVER_BUDGET', message: 'You cannot bid more than you have', status: 400 };
    const bids = { ...state.bids, [actor]: action.amount };
    let next = { ...state, bids };
    const events = [{ type: 'bid-placed', actor }];
    if (pending(next).length) return { state: next, events };
    // Everyone has bid: the highest wins; a tie goes to a draw among the tied seats.
    const top = Math.max(...Object.values(bids)), tied = state.order.filter(id => bids[id] === top);
    const winner = top > 0 ? (tied.length > 1 ? rng.pick(tied) : tied[0]) : null;
    const budget = { ...state.budget }, won = { ...state.won };
    if (winner) { budget[winner] -= top; won[winner] = [...won[winner], { name: state.lot.name, value: state.lot.value, paid: top }]; }
    const record = { round: state.round, lot: state.lot.name, value: state.lot.value, bids, winner, price: winner ? top : 0 };
    events.push({ type: 'lot-sold', ...record });
    next = { ...next, budget, won, history: [...state.history, record] };
    if (state.round >= state.rounds) return { state: { ...next, over: true, lot: null, bids: {} }, events };
    return { state: nextLot({ ...next, round: state.round + 1 }, rng), events };
  },
  // A seat that lets the clock run out passes (bids 0).
  timeout() { return { type: 'bid', amount: 0 }; },
  // The platform's own seats bid most of their appraisal, never more than a fair share of the budget left.
  engine(state, decision, { rng }) {
    const id = decision.actor, hint = state.lot.hints[id], roundsLeft = state.rounds - state.round + 1;
    const cap = Math.floor(state.budget[id] / Math.max(1, roundsLeft - 1 || 1));
    return { type: 'bid', amount: Math.max(0, Math.min(state.budget[id], cap, Math.floor(hint * (0.6 + rng() * 0.3)))) };
  },
  secrets(state) {
    if (!state.lot) return [];
    // Paths let the leak check change each value and see whose view moves: appraisals and bids are small numbers
    // that other seats may hold too, so searching the view's text for them would cry wolf.
    return [
      { value: state.lot.value, visibleTo: [], path: ['lot', 'value'] },
      ...state.order.map(id => ({ value: state.lot.hints[id], visibleTo: [id], path: ['lot', 'hints', id] })),
      ...Object.entries(state.bids).map(([id, amount]) => ({ value: amount, visibleTo: [id], path: ['bids', id] })),
    ];
  },
  view(state, viewer) {
    const mine = viewer && state.order.includes(viewer);
    return {
      round: state.round, rounds: state.rounds, over: state.over,
      lot: state.lot ? { name: state.lot.name, ...(mine ? { appraisal: state.lot.hints[viewer] } : {}) } : null,
      budgets: state.budget, lotsWon: Object.fromEntries(state.order.map(id => [id, state.won[id].length])),
      waitingFor: pending(state), you: viewer, myBid: mine ? (state.bids[viewer] ?? null) : null,
      history: state.history,
      scores: state.over ? Object.fromEntries(state.order.map(id => [id, score(state, id)])) : null,
    };
  },
  result(state, { t, seats }) {
    if (!state.over) return { done: false };
    const name = id => (seats.find(seat => seat.id === id) || {}).name || id;
    const groups = new Map();
    for (const id of state.order) { const s = score(state, id); groups.set(s, [...(groups.get(s) || []), id]); }
    const ranking = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids);
    return { done: true, ranking, summary: t('summary.win', { name: ranking[0].map(name).join(' / '), score: score(state, ranking[0][0]) }) };
  },
});
