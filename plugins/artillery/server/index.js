// SPDX-License-Identifier: Apache-2.0
// Artillery Duel (弹道奇兵) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md).
// Two squads, one tank each (HP 100), on terrain grown from the match seed (./sim.js); the wind of every turn comes
// from the same seed and is committed at the start (sha256 of salt|seed), revealed at the end. Squads take turns:
// aim (angle 0–90 mirrored to the squad's side, power 20–100; may be changed), then fire a standard shell (endless),
// a triple (two a match) or a heavy one (one), or pass. A turn not played in 60 s fires the aim held (or 45°/60) as a
// standard shell. A tank at 0 HP loses (both at 0: a draw); after 40 turns the higher HP wins; a squad that leaves
// loses. Each seat is a squad; who in it pulls the trigger on a turn is the platform's (lib/games/artillery).
const sim = require('./sim');
const TURN_MS = 60 * 1000, TURN_MAX = 40, DEFAULT_AIM = { angle: 45, power: 60 };
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const bad = (error, message) => ({ error, message, status: 400 });
const active = state => state.squads[(state.turn - 1) % state.squads.length];
const windOf = state => Number.isInteger(state.windSeq[state.turn - 1]) ? state.windSeq[state.turn - 1] : 0;

// The end: a destroyed tank, or the turn limit (higher HP); `reason` as the reports word it.
function judged(state) {
  const [a, b] = state.squads, hpA = state.tanks[a.id].hp, hpB = state.tanks[b.id].hp;
  const end = (winner, reason) => ({ ...state, status: 'finished', result: { winner: winner ? winner.id : null, reason } });
  if (hpA <= 0 && hpB <= 0) return end(null, '同归于尽');
  if (hpA <= 0) return end(b, `${a.name} 坦克被击毁`);
  if (hpB <= 0) return end(a, `${b.name} 坦克被击毁`);
  if (state.turn > TURN_MAX) return end(hpA === hpB ? null : hpA > hpB ? a : b, `${TURN_MAX} 回合弹药打完，按剩余 HP 结算`);
  return null;
}
// The next turn opens (or the match ends).
function nextTurn(state, now) {
  const next = { ...state, turn: state.turn + 1 };
  return judged(next) || { ...next, activeSquadId: active(next).id, turnEndsAt: now + TURN_MS };
}
// A shot: the volley's damage (self-damage too), the shell spent, the trajectory kept for replay.
function shoot(state, squad, ammo, aim, auto, now) {
  const wind = windOf(state), dir = state.squads.indexOf(squad) === 0 ? 1 : -1;
  const volley = sim.resolveVolley({ heights: state.terrain, tanks: state.tanks, shooterKey: squad.id, dir, angleDeg: aim.angle, power: aim.power, ammo, wind });
  const tanks = Object.fromEntries(Object.entries(state.tanks).map(([id, t]) => [id, { ...t, hp: Math.max(0, t.hp - (volley.dmgByTeam[id] || 0)) }]));
  const ammoLeft = ammo === 'standard' ? state.ammo : { ...state.ammo, [squad.id]: { ...state.ammo[squad.id], [ammo]: Math.max(0, (state.ammo[squad.id][ammo] || 0) - 1) } };
  const lastShot = { turn: state.turn, squadId: squad.id, squadName: squad.name, byName: squad.name, byId: null, ammo, angle: aim.angle, power: aim.power, wind, auto,
    points: volley.shots[0].points, shots: volley.shots, hits: volley.hits, afterHp: Object.fromEntries(state.squads.map(s => [s.id, tanks[s.id].hp])) };
  const fired = { ...state, tanks, ammo: ammoLeft, fireCount: { ...state.fireCount, [squad.id]: (state.fireCount[squad.id] || 0) + 1 }, lastShot,
    history: [...state.history, { turn: state.turn, squadId: squad.id, byName: squad.name, ammo, angle: aim.angle, power: aim.power, wind, dmg: volley.dmgByTeam, pass: false }] };
  return { state: judged(fired) || nextTurn(fired, now), events: [{ type: 'fired', turn: state.turn, squad: squad.id, auto, hits: volley.hits.length }] };
}

module.exports = definePlugin({
  setup({ seats, rng, now, sha256 }) {
    const seed = rng.int(1, 2147483646), salt = hex(rng, 16), terrain = sim.generateTerrain(seed), squads = seats.map(s => ({ id: s.id, name: s.name || s.id }));
    const each = value => Object.fromEntries(squads.map(s => [s.id, typeof value === 'function' ? value(s) : value]));
    return { status: 'playing', seed, salt, windCommitHash: sha256(`${salt}|${seed}`), windSeq: sim.windSeqFor(seed, TURN_MAX), terrain, turn: 1, turnEndsAt: now + TURN_MS, squads,
      activeSquadId: squads[0].id, tanks: each(s => ({ hp: 100, ...sim.tankCenter(squads.indexOf(s), terrain) })), ammo: each(() => ({ triple: sim.TRIPLE_COUNT, heavy: sim.HEAVY_COUNT })),
      pending: each(null), fireCount: each(0), lastShot: null, history: [], result: null };
  },
  decisions(state) {
    if (state.status !== 'playing') return [];
    return [{ actor: state.activeSquadId, actions: ['fire', 'aim', 'pass', 'autofire'], deadlineAt: state.turnEndsAt, key: `t:${state.turn}` }];
  },
  apply(state, action, { actor, now }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER' };
    const squad = state.squads.find(s => s.id === actor);
    if (action.type === 'aim') {
      const { angle, power } = action;
      if (!Number.isFinite(angle) || angle < 0 || angle > 90) return bad('BAD_ANGLE', '仰角需为 0-90（按己方朝向自动镜像）');
      if (!Number.isFinite(power) || power < 20 || power > 100) return bad('BAD_POWER', '力度需为 20-100');
      return { state: { ...state, pending: { ...state.pending, [actor]: { angle: Math.round(angle * 10) / 10, power: Math.round(power * 10) / 10, at: now } } }, events: [] };
    }
    if (action.type === 'pass') {
      const passed = { ...state, fireCount: { ...state.fireCount, [actor]: (state.fireCount[actor] || 0) + 1 }, lastShot: null, history: [...state.history, { turn: state.turn, squadId: actor, byName: squad.name, pass: true, wind: windOf(state) }] };
      return { state: nextTurn(passed, now), events: [{ type: 'passed', turn: state.turn, squad: actor }] };
    }
    // Time ran out: the aim held (or the default) as a standard shell.
    if (action.type === 'autofire') return now < state.turnEndsAt ? { error: 'TOO_EARLY', message: '本回合尚未超时，无需托管结算' } : shoot(state, squad, 'standard', state.pending[actor] || DEFAULT_AIM, true, now);
    const ammo = action.ammo || 'standard';
    if (!sim.AMMO[ammo]) return bad('BAD_AMMO', '弹药仅支持 standard/triple/heavy');
    if (ammo !== 'standard' && !(state.ammo[actor][ammo] > 0)) return { error: 'AMMO_EMPTY', message: `${sim.AMMO[ammo].name}已打光（每队限量）` };
    if (!state.pending[actor]) return bad('NEED_AIM', '先瞄准（aim）再开炮');
    return shoot(state, squad, ammo, state.pending[actor], false, now);
  },
  timeout() { return { type: 'autofire' }; },
  leave(state, seat) {
    const other = state.squads.find(s => s.id !== seat);
    if (state.status !== 'playing' || !other) return { state, events: [] };
    return { state: { ...state, status: 'finished', result: { winner: other.id, reason: '对方整队离场，判负' } }, events: [{ type: 'left', seat }] };
  },
  // The terrain and the wind of the turn being played are public; the wind to come, the seed and the salt stay on
  // the server until the end; a squad sees its own aim.
  view(state, viewer) {
    const over = state.status !== 'playing';
    return { status: state.status, windCommitHash: state.windCommitHash, wind: windOf(state), terrain: state.terrain, turn: state.turn, turnEndsAt: state.turnEndsAt, squads: state.squads,
      activeSquadId: state.activeSquadId, tanks: state.tanks, ammo: state.ammo, lastShot: state.lastShot, history: state.history, result: state.result,
      ...(state.pending[viewer] !== undefined ? { aim: state.pending[viewer] } : {}),
      ...(over ? { reveal: { salt: state.salt, seed: state.seed, windSeq: state.windSeq } } : {}) };
  },
  secrets(state) { return state.status === 'playing' ? [{ value: state.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const ids = state.squads.map(s => s.id), w = state.result.winner;
    return { done: true, ranking: w === null ? [ids] : [[w], ids.filter(id => id !== w)] };
  },
});
