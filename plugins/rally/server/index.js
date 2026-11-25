// SPDX-License-Identifier: Apache-2.0
// Rally Navigator (拉力领航) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md).
// Two crews race the same 6–9 stage track (./sim.js: the track, the weather forecast and the actual weather, about
// 80% as forecast, all from public seeds once revealed; the weather seed is committed as sha256 of salt|seed). On
// every stage each crew tunes (tyre pressure, gear ratio), may repair (free on the service stage, +20 s elsewhere)
// and drives (a style and a 0–100 risk dial); when both have driven, or 45 s after the stage opened, the stage runs
// deterministically (a crew that did not drive goes steady at 50). Damage over 60 slows a car. The lower total time
// wins; the same time to the tenth is a draw; a crew that leaves loses. Each seat is a crew; who in it holds the
// wheel on a stage is the platform's (lib/games/rally/rally.js).
const sim = require('./sim');
const DEFAULT_DRIVE = { style: 'steady', riskDial: 50 }, TUNE_PARAMS = ['tirePressure', 'gearRatio'];
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const bad = (error, message) => ({ error, message, status: 400 });
const freshStage = squads => Object.fromEntries(squads.map(s => [s.id, { tune: { tirePressure: null, gearRatio: null }, drive: null, repairDone: false }]));

function finish(state, winnerId, reason = '') { return { ...state, status: 'finished', result: { winner: winnerId, reason } }; }
// Run the stage for both crews, record it, open the next one or end the race.
function runStage(state, auto, now) {
  const segIdx = state.segIdx, seg = state.segments[segIdx], weather = state.actual[segIdx], forecast = state.forecast[segIdx];
  const car = JSON.parse(JSON.stringify(state.car)), runs = { ...state.runs }, per = {};
  state.squads.forEach((squad, si) => {
    const st = state.segState[squad.id], c = car[squad.id];
    const res = sim.runSegment({ seg, weather, tune: st.tune, drive: st.drive || DEFAULT_DRIVE, damage: c.damage, repairDone: st.repairDone, draws: (state.noise[segIdx] || [{}, {}])[si] || { noise: 0, spinDraw: 1, crashDraw: 1 } });
    c.damage = res.dmgEnd; c.totalDs += res.timeDs; runs[squad.id] = (runs[squad.id] || 0) + 1;
    per[squad.id] = { squadId: squad.id, squadName: squad.name, driverName: st.drive ? squad.name : `${squad.name}(托管)`, style: res.style, dial: res.effDial, tune: { ...st.tune }, repairDone: st.repairDone,
      timeDs: res.timeDs, time: res.time, mishap: res.mishap, damageBefore: res.dmgStart, damageAfter: res.dmgEnd, totalDs: c.totalDs, auto: !st.drive };
  });
  const results = [...state.results, { segIdx, surface: seg.surface, service: !!seg.service, weatherForecast: forecast, weatherActual: weather, deviated: forecast !== weather, per }];
  const next = { ...state, car, runs, results, segIdx: segIdx + 1, segState: freshStage(state.squads) }, events = [{ type: 'stage', segIdx, auto }];
  if (next.segIdx < next.segCount) return { state: { ...next, segEndsAt: now + sim.SEGMENT_MS }, events };
  const [a, b] = state.squads, dsA = car[a.id].totalDs, dsB = car[b.id].totalDs;
  return { state: finish(next, dsA === dsB ? null : dsA < dsB ? a.id : b.id, dsA === dsB ? '全程完全同秒' : ''), events };
}
const withStage = (state, squadId, change) => ({ ...state, segState: { ...state.segState, [squadId]: { ...state.segState[squadId], ...change } } });

module.exports = definePlugin({
  setup({ seats, rng, now, sha256 }) {
    const trackSeed = rng.int(1, 2147483646), weatherSeed = rng.int(1, 2147483646), salt = hex(rng, 16), track = sim.generateTrack(trackSeed);
    const squads = seats.map(s => ({ id: s.id, name: s.name || s.id }));
    return { status: 'playing', trackSeed, weatherSeed, salt, commitHash: sha256(`${salt}|${weatherSeed}`), segCount: track.segCount, serviceIdx: track.serviceIdx, segments: track.segments,
      forecast: sim.weatherForecast(weatherSeed, track.segCount), actual: sim.weatherActual(weatherSeed, track.segCount), noise: sim.noiseMatrix(trackSeed, track.segCount, 2),
      segIdx: 0, segEndsAt: now + sim.SEGMENT_MS, squads, car: Object.fromEntries(squads.map(s => [s.id, { damage: 0, totalDs: 0 }])), segState: freshStage(squads),
      runs: Object.fromEntries(squads.map(s => [s.id, 0])), results: [], result: null };
  },
  // Both crews tune, repair and drive the open stage until it runs; a drive may be changed until then.
  decisions(state) {
    if (state.status !== 'playing') return [];
    return state.squads.map(s => ({ actor: s.id, actions: ['drive', 'tune', 'repair', 'pass'], deadlineAt: state.segEndsAt, key: `s:${state.segIdx}` }));
  },
  apply(state, action, { actor, now }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER' };
    const st = state.segState[actor];
    if (action.type === 'pass') return now < state.segEndsAt ? { error: 'TOO_EARLY', message: '本段尚未超时且对手未提交，无需托管结算' } : runStage(state, true, now);
    if (action.type === 'tune') {
      if (!TUNE_PARAMS.includes(action.param)) return bad('BAD_PARAM', '调校参数仅支持 tirePressure / gearRatio');
      const value = action.value;
      if (!Number.isFinite(value) || value < 0 || value > 100) return bad('BAD_VALUE', '调校值需为 0-100');
      return { state: withStage(state, actor, { tune: { ...st.tune, [action.param]: Math.round(value) } }), events: [] }; // the last value set counts
    }
    if (action.type === 'repair') {
      if (st.repairDone) return { error: 'REPAIR_DONE', message: '本段已经修过车了（每段限一次）' };
      return { state: withStage(state, actor, { repairDone: true }), events: [{ type: 'repair', squad: actor, service: !!state.segments[state.segIdx].service }] };
    }
    if (!sim.STYLE[action.style]) return bad('BAD_STYLE', '驾驶风格仅支持 steady/push/limit');
    const dial = action.riskDial;
    if (!Number.isFinite(dial) || dial < 0 || dial > 100) return bad('BAD_RISK', '风险拨盘需为 0-100');
    const driven = withStage(state, actor, { drive: { style: action.style, riskDial: Math.round(dial), at: now } });
    // The second crew to drive starts the stage.
    return driven.squads.every(s => driven.segState[s.id].drive) ? runStage(driven, false, now) : { state: driven, events: [] };
  },
  timeout() { return { type: 'pass' }; },
  leave(state, seat) {
    const other = state.squads.find(s => s.id !== seat);
    if (state.status !== 'playing' || !other) return { state, events: [] };
    return { state: finish(state, other.id, '对方整队离场，判负'), events: [{ type: 'left', seat }] };
  },
  // The track and the forecast are public; the actual weather of a stage shows once it ran; the seeds, the salt, the
  // noise and the other crew's tune and drive stay on the server until the end.
  view(state, viewer) {
    const over = state.status !== 'playing';
    return { status: state.status, commitHash: state.commitHash, segCount: state.segCount, serviceIdx: state.serviceIdx, segments: state.segments, forecast: state.forecast,
      actual: over ? state.actual : state.actual.slice(0, state.segIdx), segIdx: state.segIdx, segEndsAt: state.segEndsAt, squads: state.squads, car: state.car, results: state.results, result: state.result,
      ...(state.segState[viewer] ? { mine: state.segState[viewer] } : {}),
      ...(over ? { reveal: { salt: state.salt, trackSeed: state.trackSeed, weatherSeed: state.weatherSeed } } : {}) };
  },
  secrets(state) { return state.status === 'playing' ? [{ value: state.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const ids = state.squads.map(s => s.id), w = state.result.winner;
    return { done: true, ranking: w === null ? [ids] : [[w], ids.filter(id => id !== w)] };
  },
});
