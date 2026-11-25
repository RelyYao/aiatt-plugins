// SPDX-License-Identifier: Apache-2.0
'use strict';
// Fuzz: thousands of short random matches through the real host. Every match of a `match` plugin must finish (unless
// `lenient`: random play cannot finish a game that needs specific moves, like a whole Guandan match. It is given by the
// caller, or found here: a plugin without engine() whose first 20 random matches all ran out of steps). A plugin with engine() also plays every tenth match with the engine in every seat, and
// those must finish whatever `lenient` says: that is what shows the game ends. A step
// the host refuses must change nothing (the host promises it; a plugin that mutates module-level state breaks it), a
// plugin must never fault (exception, time-out, malformed answer, state over the limit), and nonsense actions
// (unknown names, wrong types, oversized values) must be refused with a 4xx, never a 5xx. Every tenth match is
// replayed from its seed and log and must reach the same state.
const { seeded, pick, sha256 } = require('./util');
const FAULT = new Set(['PLUGIN_ERROR', 'PLUGIN_TIMEOUT', 'PLUGIN_BAD_RESULT', 'PLUGIN_STATE_TOO_LARGE', 'PLUGIN_BAD_EVENTS', 'PLUGIN_BAD_DECISIONS', 'PLUGIN_OUTPUT_TOO_LARGE', 'PLUGIN_FUNCTION_MISSING', 'PLUGIN_NO_TIMEOUT_MOVE', 'PLUGIN_NO_ENGINE_MOVE']);
const SHOW = 8;
function garbage(rng, manifest) {
  const names = Object.keys(manifest.actions), type = pick(rng, names);
  const forms = [
    () => ({ type: 'no-such-action-' + Math.floor(rng() * 9) }), () => ({ type: 7 }), () => ({}), () => 'text', () => null, () => [1, 2],
    () => ({ type, [`x${Math.floor(rng() * 9)}`]: { deep: [1, 2, 3] } }), () => ({ type, value: 'v'.repeat(70000) }),
    () => ({ type, ...Object.fromEntries(Object.keys(manifest.actions[type].properties || {}).map(key => [key, pick(rng, [null, -1, 1e9, 'x', {}, [], true, NaN])])) }),
  ];
  return pick(rng, forms)();
}
function fuzz(graph, id, { matches = 2000, seed = 1, maxSteps = 800, lenient = false } = {}) {
  const { host, conformance } = graph, manifest = host.manifestFor(id), engine = host.hasFunction(id, 'engine');
  const report = { plugin: id, matches, finished: 0, steps: 0, refused: {}, faults: [], unfinished: [], stalls: [], invariantBreaks: [], replayFailures: [], faultCount: 0, engineMatches: 0, engineFinished: 0, engineUnfinished: [] };
  const note = (list, entry) => { if (list.length < SHOW) list.push(entry); };
  const must = manifest.category === 'match', limit = must ? maxSteps : Math.min(maxSteps, 60), PROBE = 20;
  for (let game = 0; game < matches; game++) {
    if (!lenient && must && !engine && game === PROBE && matches > PROBE && report.finished === 0 && !report.stalls.length) { lenient = true; report.lenientFound = true; report.unfinished = []; }
    const rng = seeded(seed * 100003 + game), count = Math.max(manifest.seats.min + Math.floor(rng() * (manifest.seats.max - manifest.seats.min + 1)), must ? 1 : 0);
    const engineGame = engine && must && game % 10 === 5;
    if (engineGame) report.engineMatches++;
    const bots = new Set(), seats = Array.from({ length: count }, (_, i) => {
      const bot = engineGame || (engine && count > 1 && i === count - 1 && rng() < 0.25);
      if (bot) bots.add(`seat${i}`);
      return { id: `seat${i}`, kind: bot ? 'bot' : 'human', name: `Seat ${i}`, ...(i === 0 ? { owner: true } : {}) };
    });
    const room = { id: `fuzz_${id}_${game}`, state: {} }, matchSeed = sha256(`${id}:${seed}:${game}`).slice(0, 32), ids = seats.map(s => s.id);
    let now = 1_000_000, started = null;
    if (Object.keys(manifest.config.properties || {}).length && rng() < 0.3) started = host.start(room, id, { seats, now, seed: matchSeed, config: conformance.sample(manifest.config, rng, ids) });
    if (!started || started.error === 'PLUGIN_CONFIG_INVALID') started = host.start(room, id, { seats, now, seed: matchSeed });
    if (started.code) { report.faultCount++; note(report.faults, { game, step: 0, error: started.error, message: started.message }); continue; }
    const record = (where, done) => {
      if (!done.code) return;
      report.refused[done.error] = (report.refused[done.error] || 0) + 1;
      if (FAULT.has(done.error) || done.code >= 500) { report.faultCount++; note(report.faults, { game, step: where, error: done.error, message: done.message }); }
    };
    const play = () => { if (engine && bots.size) for (const s of host.autoPlay(room, now)) if (s.error) { report.faultCount++; note(report.faults, { game, error: s.error, during: 'engine' }); } };
    play();
    // Under `lenient` a random match only has to stay sound (no fault, no broken invariant), so it stops sooner.
    for (let step = 0, cap = lenient && !engineGame ? Math.min(limit, 200) : limit; step < cap; step++) {
      const p = room.state.plugin;
      if (p.result?.done) break;
      const open = p.decisions.filter(d => !bots.has(d.actor)), deadlines = p.decisions.map(d => d.deadlineAt).filter(Number.isFinite);
      // Only engine seats are to move: the host's autoPlay plays a bounded number of steps per call, so call it again while
      // it gets somewhere; a call that moves nothing is a stall.
      if (p.decisions.length && !open.length && !deadlines.length && bots.size) { const at = p.step; play(); if (room.state.plugin.step > at) { report.steps++; continue; } }
      if (!p.decisions.length || (!open.length && !deadlines.length)) { if (must) note(report.stalls, { game, step, seed: matchSeed }); break; }
      const before = JSON.stringify(p.state), stepBefore = p.step, roll = rng();
      let done;
      if (!open.length || (deadlines.length && roll < 0.1)) {
        now = Math.max(now, Math.min(...deadlines));
        for (const s of host.expire(room, now)) if (s.error) { report.faultCount++; note(report.faults, { game, step, error: s.error, during: 'timeout' }); }
        done = { };
      } else if (roll < 0.17) {
        const actor = pick(rng, ids), input = garbage(rng, manifest);
        done = host.act(room, actor, input, { now });
        if (done.code >= 500 && !['PLUGIN_STATE_TOO_LARGE', 'PLUGIN_BAD_EVENTS'].includes(done.error)) { report.faultCount++; note(report.faults, { game, step, error: done.error, message: done.message, during: 'nonsense input' }); }
        else report.refused[done.error] = (report.refused[done.error] || 0) + 1;
      } else if (manifest.hostActions.length && roll < 0.2) {
        const type = pick(rng, manifest.hostActions);
        done = host.act(room, ids[0], { ...conformance.sample(manifest.actions[type], rng, ids), type }, { now, host: true });
        record(step, done);
      } else {
        const timed = open.filter(d => d.deadlineAt !== null), decision = timed.length && rng() < 0.9 ? pick(rng, timed) : pick(rng, open), type = rng() < 0.95 ? decision.actions[0] : pick(rng, decision.actions);
        done = host.act(room, decision.actor, { ...conformance.sample(manifest.actions[type] || { type: 'object' }, rng, ids), type }, { now });
        record(step, done);
      }
      if (done.code && (JSON.stringify(room.state.plugin.state) !== before || room.state.plugin.step !== stepBefore)) note(report.invariantBreaks, { game, step, problem: 'a refused step changed the match', error: done.error });
      report.steps++; now += 1000;
      play();
      const seen = host.view(room, rng() < 0.2 ? null : pick(rng, ids));
      if (seen.code) { report.faultCount++; note(report.faults, { game, step, error: seen.error, message: seen.message, during: 'view' }); }
    }
    if (room.state.plugin.result?.done) { report.finished++; if (engineGame) report.engineFinished++; }
    else if (engineGame) note(report.engineUnfinished, { game, seed: matchSeed, steps: room.state.plugin.step });
    else if (must && !report.stalls.some(s => s.game === game)) note(report.unfinished, { game, seed: matchSeed, steps: room.state.plugin.step });
    if (game % 10 === 0) { const replayed = host.replay(room); if (replayed.code || !replayed.data.ok) note(report.replayFailures, { game, failedAt: replayed.data?.failedAt ?? null, error: replayed.error || null }); }
  }
  // `lenient`: random play cannot finish this game (the plugin has no engine() and its own simulation finished no match), so an unfinished match is a warning, not a failure.
  report.lenient = lenient;
  report.ok = !report.faultCount && !report.engineUnfinished.length && (lenient || !report.unfinished.length) && !report.stalls.length && !report.invariantBreaks.length && !report.replayFailures.length && (lenient || !must || report.finished === matches);
  return report;
}
module.exports = { fuzz };
