// SPDX-License-Identifier: Apache-2.0
'use strict';
// Conformance check for a room plugin (P2 developer tools: scripts/plugin-dev.mjs simulate, and the gate through
// test/plugins/plugin-conformance.test.js). It plays random matches through the real host: seats between the
// manifest's minimum and maximum, options at their defaults, and at every turn a random action the open decision
// allows, its fields generated from the action's JSON Schema (strings often name a seat, since actions usually
// target one; a decision's first action, its main one, is taken most of the time). Time moves a second a step, now
// and then jumping to the next deadline so timeouts run too; now and then seat 0, the room's host, takes one of the
// manifest's hostActions, and (for a plugin with leave()) a seat leaves for good. It
// reports plugin faults (exceptions, time-outs, malformed answers, states over the limit), matches that stall with
// no open decision, leaks (a value the plugin's secrets(state) says some seats may not see, found in their view or
// the spectators'), and matches whose replay from the seed does not reach the same state.
const crypto = require('node:crypto');
const host = require('./plugin-host');
const FAULTS = new Set(['PLUGIN_ERROR', 'PLUGIN_TIMEOUT', 'PLUGIN_BAD_RESULT', 'PLUGIN_STATE_TOO_LARGE', 'PLUGIN_BAD_EVENTS', 'PLUGIN_BAD_DECISIONS', 'PLUGIN_OUTPUT_TOO_LARGE', 'PLUGIN_FUNCTION_MISSING', 'PLUGIN_NO_TIMEOUT_MOVE']);
function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
// A value for a schema (the subset lib/plugins/plugin-schema.js supports), aiming at valid ones most of the time.
function sample(schema, rng, seats, depth = 0) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return pick(rng, schema.enum);
  const type = Array.isArray(schema.type) ? pick(rng, schema.type) : schema.type || 'string';
  if (type === 'integer' || type === 'number') {
    const lo = schema.minimum ?? -3, hi = schema.maximum ?? Math.max(lo + 20, 20), value = lo + rng() * (hi - lo);
    return type === 'integer' ? Math.floor(lo + rng() * (Math.floor(hi) - Math.ceil(lo) + 1)) : value;
  }
  if (type === 'boolean') return rng() < 0.5;
  if (type === 'null') return null;
  if (type === 'array') { const n = Math.min(schema.maxItems ?? 3, (schema.minItems ?? 0) + Math.floor(rng() * 3)); return Array.from({ length: n }, () => sample(schema.items || {}, rng, seats, depth + 1)); }
  if (type === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(schema.properties || {})) if ((schema.required || []).includes(key) || rng() < 0.5) out[key] = sample(child, rng, seats, depth + 1);
    return out;
  }
  if (seats.length && rng() < 0.7) return pick(rng, seats);
  const lo = schema.minLength ?? 1, hi = Math.min(schema.maxLength ?? 24, lo + 24), n = lo + Math.floor(rng() * (hi - lo + 1));
  return Array.from({ length: n }, () => pick(rng, 'abcdefghij klmnop'.split(''))).join('').trim() || 'a';
}
function simulate(pluginId, { games = 20, maxSteps = 600, seed = 1 } = {}) {
  const manifest = host.manifestFor(pluginId);
  if (!manifest) throw new Error('PLUGIN_NOT_REGISTERED: ' + pluginId);
  const report = { plugin: pluginId, games, finished: 0, steps: 0, faults: [], stalls: [], leaks: [], replayFailures: [] };
  for (let game = 0; game < games; game++) {
    const rng = seeded(seed * 1000 + game), count = manifest.seats.min + Math.floor(rng() * (manifest.seats.max - manifest.seats.min + 1));
    const seats = Array.from({ length: Math.max(count, manifest.category === 'match' ? 1 : 0) }, (_, i) => ({ id: `seat${i}`, kind: 'human', name: `Seat ${i}`, ...(i === 0 ? { owner: true } : {}) }));
    const room = { id: `conformance_${pluginId}_${game}`, state: {} };
    let now = 1_000_000;
    const started = host.start(room, pluginId, { seats, now, seed: crypto.createHash('sha256').update(`${pluginId}:${seed}:${game}`).digest('hex').slice(0, 32) });
    if (started.code) { report.faults.push({ game, step: 0, error: started.error, message: started.message }); continue; }
    const ids = seats.map(s => s.id), leaves = host.hasFunction(pluginId, 'leave');
    for (let step = 0; step < maxSteps; step++) {
      const p = room.state.plugin;
      if (p.result?.done) break;
      if (!p.decisions.length) { if (manifest.category === 'match') report.stalls.push({ game, step }); break; }
      const deadlines = p.decisions.map(d => d.deadlineAt).filter(Number.isFinite);
      const roll = rng();
      if (manifest.hostActions.length && roll < 0.04) {
        const type = pick(rng, manifest.hostActions), done = host.act(room, ids[0], { ...sample(manifest.actions[type], rng, ids), type }, { now, host: true });
        if (done.code && FAULTS.has(done.error)) report.faults.push({ game, step, error: done.error, message: done.message, during: 'host' });
      } else if (leaves && roll < 0.05) {
        const done = host.leave(room, pick(rng, ids), { now });
        if (done.code && FAULTS.has(done.error)) report.faults.push({ game, step, error: done.error, message: done.message, during: 'leave' });
      } else if (deadlines.length && roll < 0.16) {
        now = Math.max(now, Math.min(...deadlines));
        for (const s of host.expire(room, now)) if (s.error && FAULTS.has(s.error)) report.faults.push({ game, step, error: s.error, during: 'timeout' });
      } else {
        // The first action a decision lists is its main one (place, describe…): chosen most of the time, and the
        // timed decision (whose turn it is) before an untimed one (resigning while the other thinks), so random play
        // goes deep instead of resigning at once.
        const timed = p.decisions.filter(d => d.deadlineAt !== null), decision = timed.length && rng() < 0.9 ? pick(rng, timed) : pick(rng, p.decisions), type = rng() < 0.95 ? decision.actions[0] : pick(rng, decision.actions);
        const done = host.act(room, decision.actor, { ...sample(manifest.actions[type] || { type: 'object' }, rng, ids), type }, { now });
        if (done.code && FAULTS.has(done.error)) report.faults.push({ game, step, error: done.error, message: done.message });
      }
      report.steps++; now += 1000;
      const secrets = host.secrets(room);
      if (secrets.code) { report.faults.push({ game, step, error: secrets.error, during: 'secrets' }); continue; }
      for (const viewer of [...ids, null]) {
        const seen = host.view(room, viewer);
        if (seen.code) { report.faults.push({ game, step, error: seen.error, during: 'view' }); continue; }
        const text = JSON.stringify(seen.data.view);
        for (const secret of secrets.data) {
          if (viewer && secret.visibleTo.includes(viewer)) continue;
          // With a path: change the value there and see whether this viewer's view changes (catches derived leaks, and a
          // small number another seat may legitimately also hold is not a false alarm). Without one: search the text.
          const leaked = secret.path ? changes(host, room, secret, viewer, text) : text.includes(JSON.stringify(secret.value));
          if (leaked) report.leaks.push({ game, step, viewer, value: secret.value, ...(secret.path ? { path: secret.path } : {}) });
        }
      }
    }
    if (room.state.plugin.result?.done) report.finished++;
    const replayed = host.replay(room);
    if (replayed.code || !replayed.data.ok) report.replayFailures.push({ game, failedAt: replayed.data?.failedAt ?? null, error: replayed.error || null });
  }
  report.ok = !report.faults.length && !report.stalls.length && !report.leaks.length && !report.replayFailures.length;
  return report;
}
// A value that differs from the secret but keeps its type, so a view that only formats it shows something else.
function probe(value) {
  if (typeof value === 'number') return value + 7919;
  if (typeof value === 'string') return value + '\u2063probe';
  if (typeof value === 'boolean') return !value;
  return { probe: JSON.stringify(value ?? null) };
}
function changes(host, room, secret, viewer, text) {
  const state = structuredClone(room.state.plugin.state);
  let node = state;
  for (const key of secret.path.slice(0, -1)) { if (!node || typeof node !== 'object') return false; node = node[key]; }
  const last = secret.path.at(-1);
  if (!node || typeof node !== 'object' || !Object.hasOwn(node, last)) return false;
  node[last] = probe(node[last]);
  const seen = host.viewOfState(room, state, viewer);
  return !seen.code && JSON.stringify(seen.data) !== text;
}
module.exports = { simulate, sample };
