// SPDX-License-Identifier: Apache-2.0
// Partner Legion (搭档兵团) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md). An
// auto-battler for four camps (./sim.js: units, the shared pool, the shop, stars, traits, battles). Every round opens
// a timed preparation: each camp gets its income and a shop drawn from the committed seed, buys, sells, rerolls,
// places units and picks an order, then says it is ready; garrison camps (seats of kind bot) play themselves. When
// every camp is ready or the time is up, the round's battles resolve from the seed and the losers lose HP; a camp at
// 0 is out. After the last round (or when one camp is left) the standings are by HP, then by the army's worth. A
// camp's people may leave: it plays on as a garrison. Who plays a person's camp, and an Agent's advice, are the
// platform's (lib/games/legion/legion.js): it sends `autoplay` (the engine plays the camp) and `plan` (a plan adopted).
const sim = require('./sim');
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const clone = value => JSON.parse(JSON.stringify(value));
const worth = camp => sim.board(camp).reduce((s, u) => s + sim.UNIT[u.key].tier * sim.COPIES[u.star], 0);

function finish(state) {
  const camps = clone(state.camps), ranked = camps.filter(c => c.alive).sort((a, b) => b.hp - a.hp || worth(b) - worth(a));
  ranked.forEach((c, i) => { c.place = i + 1; });
  return { ...state, camps, status: 'finished', phase: null };
}
// A round's preparation: income, a fresh shop, garrisons play; if nobody is left to prepare, it ends at once.
function startPrep(state, now) {
  const camps = clone(state.camps), pool = clone(state.pool), round = state.round + 1;
  for (const camp of camps.filter(c => c.alive)) {
    camp.gold += sim.income(round); camp.ready = false; camp.played = false;
    sim.rollShop(camp, pool, round, state.seed);
    if (camp.bot) { sim.enginePlay(camp, pool, round, state.seed); camp.ready = true; camp.played = true; }
  }
  const next = { ...state, camps, pool, round, phase: 'prep', prepStartedAt: now, prepEndsAt: now + state.prepMs, battles: [] };
  return next.camps.every(c => !c.alive || c.ready) ? endPrep(next, now) : next;
}
// The preparation ends: empty boards are filled from the bench, the battles resolve, the fallen are placed.
function endPrep(state, now) {
  const camps = clone(state.camps);
  for (const camp of camps.filter(c => c.alive)) sim.autoPlace(camp, state.round);
  const battles = sim.resolveRound(camps, state.round, String(state.seed));
  const fallen = camps.filter(c => c.alive && c.hp <= 0), stillAlive = camps.filter(c => c.alive && c.hp > 0).length;
  fallen.sort((a, b) => a.hp - b.hp).forEach((c, i) => { c.alive = false; c.place = stillAlive + fallen.length - i; });
  return { ...state, camps, battles, phase: 'battle', battleEndsAt: now + state.battleMs,
    history: [...state.history, { round: state.round, results: battles.map(b => ({ a: b.a, b: b.b, ghost: b.ghost, winner: b.winner, damage: b.damage })) }] };
}
// The battle's playback is over: the next round, or the end.
function endBattle(state, now) {
  if (state.round >= sim.ROUNDS || state.camps.filter(c => c.alive).length <= 1) return finish(state);
  return startPrep(state, now);
}
// A change to one camp in the preparation; the round ends once every camp is ready.
function changed(state, campId, mutate, now) {
  const camps = clone(state.camps), pool = clone(state.pool), camp = camps.find(c => c.id === campId), out = mutate(camp, pool);
  if (out && out.error) return out;
  const next = { ...state, camps, pool };
  return { state: next.camps.every(c => !c.alive || c.ready) ? endPrep(next, now) : next, events: [] };
}

module.exports = definePlugin({
  setup({ seats, config, rng, now, sha256 }) {
    const seed = rng.int(1, 2 ** 31 - 2), salt = hex(rng, 24);
    const camps = seats.map(s => ({ ...sim.newCamp({ id: s.id, name: s.name || s.id, bot: s.kind === 'bot' }), ready: false, played: false }));
    return startPrep({ status: 'playing', seed, salt, commitHash: sha256(`${salt}|${seed}`), prepMs: config.prepMs, battleMs: config.battleMs,
      camps, pool: sim.newPool(), round: 0, phase: null, prepStartedAt: 0, prepEndsAt: 0, battleEndsAt: 0, battles: [], history: [] }, now);
  },
  // In a preparation every camp with people can act until the clock runs out; a battle waits for its playback.
  decisions(state) {
    if (state.status !== 'playing') return [];
    if (state.phase === 'battle') { const first = state.camps.find(c => c.alive); return first ? [{ actor: first.id, actions: ['pass'], deadlineAt: state.battleEndsAt, key: `b:${state.round}` }] : []; }
    return state.camps.filter(c => c.alive && !c.bot).map(c => ({ actor: c.id, actions: ['buy', 'sell', 'refresh', 'move', 'order', 'ready', 'plan', 'autoplay', 'pass'], deadlineAt: state.prepEndsAt, key: `p:${state.round}` }));
  },
  apply(state, action, { actor, now }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER', message: 'The match is over' };
    if (action.type === 'pass') {
      if (state.phase === 'battle') return now < state.battleEndsAt ? { error: 'TOO_EARLY' } : { state: endBattle(state, now), events: [{ type: 'battleOver', round: state.round }] };
      return now < state.prepEndsAt ? { error: 'TOO_EARLY' } : { state: endPrep(state, now), events: [{ type: 'prepOver', round: state.round }] };
    }
    if (state.phase !== 'prep') return { error: 'BATTLE_PHASE', message: 'The battle is on; wait for the next preparation' };
    const played = camp => { camp.played = true; };
    if (action.type === 'ready') return changed(state, actor, camp => { camp.ready = action.ready !== false; }, now);
    if (action.type === 'autoplay') return changed(state, actor, (camp, pool) => { sim.enginePlay(camp, pool, state.round, state.seed); played(camp); camp.ready = action.ready === true; }, now);
    if (action.type === 'plan') return changed(state, actor, (camp, pool) => { sim.applyPlan(camp, pool, state.round, action.plan && typeof action.plan === 'object' ? action.plan : {}); played(camp); }, now);
    return changed(state, actor, (camp, pool) => {
      const r = action.type === 'buy' ? sim.buy(camp, pool, action.slot) : action.type === 'sell' ? sim.sell(camp, pool, action.uid) : action.type === 'refresh' ? sim.refresh(camp, pool, state.round, state.seed)
        : action.type === 'move' ? sim.move(camp, action.uid, action.cell ?? null, state.round) : sim.setOrder(camp, action.order);
      if (r.error) return { error: r.error, message: r.message };
      played(camp);
    }, now);
  },
  timeout() { return { type: 'pass' }; },
  // Everyone behind a camp left: it plays on as a garrison (this round too, if it had not played yet).
  leave(state, seat, { now }) {
    if (state.status !== 'playing') return { state, events: [] };
    return changed(state, seat, (camp, pool) => {
      camp.bot = true;
      if (state.phase === 'prep' && !camp.played) { sim.enginePlay(camp, pool, state.round, state.seed); camp.ready = true; camp.played = true; }
    }, now);
  },
  // Gold, the shop, the bench and the board are a camp's own during a preparation; the seed and salt stay on the
  // server until the end.
  view(state, viewer) {
    const prep = state.status === 'playing' && state.phase === 'prep';
    return { status: state.status, round: state.round, phase: state.phase, prepEndsAt: state.prepEndsAt, battleEndsAt: state.battleEndsAt, commitHash: state.commitHash, battles: state.battles, history: state.history,
      camps: state.camps.map(c => ({ id: c.id, name: c.name, bot: c.bot, hp: c.hp, alive: c.alive, place: c.place, ready: !!c.ready,
        ...(!prep || c.id === viewer ? { gold: c.gold, order: c.order, board: sim.board(c), traits: sim.traits(c) } : {}), ...(c.id === viewer ? { shop: c.shop, bench: sim.bench(c) } : {}) })),
      ...(state.status !== 'playing' ? { reveal: { seed: state.seed, salt: state.salt } } : {}) };
  },
  secrets(state) { return state.status === 'playing' ? [{ value: state.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const byPlace = [...state.camps].sort((a, b) => a.place - b.place);
    return { done: true, ranking: byPlace.map(c => [c.id]), summary: byPlace.map(c => `${c.place}. ${c.name} (${c.hp})`).join(' · ') };
  },
});
