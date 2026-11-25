// SPDX-License-Identifier: Apache-2.0
'use strict';
// One match in the local simulator: a room the real host runs, with the seats the author chose, the actions taken so
// far (every step with its rng seed), and the operations the simulator offers: act, advance the clock, rewind to any
// step, reload after the code changed. The match is always rebuildable from (seed, config, seats, action log), which
// is how rewind and reload work: the rebuild replays the recorded actions on the (new) code and stops where one no
// longer applies.
const crypto = require('node:crypto');
const { loadPlugin } = require('./runtime');
const { randomMove, applyEntry } = require('./drive');
const { seeded, hashState, sha256, errorText } = require('./util');
const START = 1_700_000_000_000, TICK = 1000, MAX_STEPS = 5000;
const seedInt = text => parseInt(sha256(String(text)).slice(0, 8), 16);
// The seed the host gives apply() at a step (plugin-host.js: sha256 of "<match seed>:<step>", 32 hex digits).
const stepSeed = (seed, step) => sha256(`${seed}:${step}`).slice(0, 32);
class Session {
  constructor({ dir, graph }) {
    this.dir = dir; this.graph = graph; this.plugin = null; this.error = null; this.revision = 0; this.room = null;
    this.setup = null; this.history = []; this.now = START; this.last = null; this.notes = [];
  }
  // (Re)loads the plugin code. A failure keeps the previously loaded code and says what is wrong.
  load() {
    try { this.plugin = loadPlugin(this.dir, this.graph); this.error = null; return true; }
    catch (error) { this.error = errorText(error); return false; }
    finally { this.revision++; }
  }
  seatList(count, me) { return Array.from({ length: count }, (_, i) => ({ id: `seat${i}`, kind: `seat${i}` === me ? 'human' : 'bot', name: `Seat ${i}`, ...(i === 0 ? { owner: true } : {}) })); }
  start({ seats, me = 'seat0', config = {}, seed } = {}) {
    if (!this.plugin) return { error: 'PLUGIN_NOT_LOADED', message: this.error || 'the plugin is not loaded' };
    const m = this.plugin.manifest, count = Number.isInteger(seats) ? seats : m.seats.min;
    this.setup = { seats: count, me, config: config || {}, seed: seed || crypto.randomBytes(16).toString('hex') };
    return this.restart([]);
  }
  restart(entries, { bots = true } = {}) {
    const { seats, me, config, seed } = this.setup, { host, store } = this.graph;
    store.reset();
    this.room = { id: 'simulator', state: {} }; this.history = []; this.now = START; this.last = null; this.notes = [];
    const started = host.start(this.room, this.plugin.id, { seats: this.seatList(seats, me), config, seed, now: START, match: 'sim' });
    if (started.code) { this.room = null; return started; }
    const result = { replayed: 0, stopped: null };
    for (const entry of entries) {
      const done = applyEntry(this.graph, this.room, entry);
      if (done.code) { result.stopped = { step: entry.step, error: done.error, message: done.message }; break; }
      this.now = entry.at + TICK; result.replayed++; this.record();
    }
    this.record(); if (bots) this.runBots();
    return { data: result };
  }
  record() {
    const p = this.room.state.plugin, known = this.history.at(-1)?.step ?? 0;
    for (const entry of p.log) if (entry.step > known && this.history.length < MAX_STEPS) this.history.push({ ...structuredClone(entry), seed: stepSeed(p.seed, entry.step) });
  }
  // Bots play every open decision of their seats: the plugin's engine() when it has one, else a random legal action.
  runBots() {
    if (!this.room) return;
    const { host } = this.graph, rng = seeded(seedInt(this.setup.seed + ':bots:' + this.room.state.plugin.step));
    for (let guard = 0; guard < 200; guard++) {
      const p = this.room.state.plugin;
      if (p.result?.done) break;
      const bots = new Set(p.seats.filter(s => s.kind === 'bot').map(s => s.id)), open = p.decisions.filter(d => bots.has(d.actor));
      if (!open.length) break;
      this.now += TICK;
      let moved = false;
      if (this.plugin && host.hasFunction(this.plugin.id, 'engine')) {
        const steps = host.autoPlay(this.room, this.now);
        for (const s of steps) if (s.error) this.notes.push(`engine() gave a move the host refused for ${s.actor}: ${s.error}`);
        moved = steps.some(s => !s.error);
      }
      if (!moved) {
        const still = this.room.state.plugin.decisions.filter(d => bots.has(d.actor));
        if (!still.length) break;
        const tried = randomMove(this.graph, this.room, still[0], rng, { now: this.now });
        if (!tried.ok) { this.notes.push(`Bot ${still[0].actor} found no legal action (${tried.last?.error || 'none tried'})`); break; }
        moved = true;
      }
      this.record();
    }
    this.record();
  }
  act(actor, input) {
    if (!this.room) return { error: 'NO_MATCH', code: 409, message: 'start a match first' };
    const p = this.room.state.plugin, seat = p.seats.find(s => s.id === actor);
    this.now += TICK;
    const done = this.graph.host.act(this.room, actor, input, { now: this.now, ...(seat?.owner ? { host: true } : {}) });
    this.last = done.code ? { ok: false, error: done.error, message: done.message, problems: done.problems || null } : { ok: true, step: done.data.step, events: done.data.events };
    if (!done.code) { this.notes = []; this.record(); this.runBots(); }
    return done;
  }
  // The clock jumps to the next deadline and the host plays the plugin's timeout() for whoever ran out.
  advance() {
    if (!this.room) return { error: 'NO_MATCH', code: 409, message: 'start a match first' };
    const deadlines = this.room.state.plugin.decisions.map(d => d.deadlineAt).filter(Number.isFinite);
    if (!deadlines.length) return { error: 'NO_DEADLINE', code: 409, message: 'no open decision has a deadline' };
    this.now = Math.max(this.now, Math.min(...deadlines));
    const steps = this.graph.host.expire(this.room, this.now);
    this.last = steps.length ? { ok: !steps.some(s => s.error), timeouts: steps.map(s => ({ actor: s.actor, action: s.action, error: s.error })) } : { ok: false, error: 'NOTHING_EXPIRED' };
    this.notes = []; this.record(); this.runBots();
    return { data: steps };
  }
  rewind(step) {
    if (!this.room || !Number.isInteger(step) || step < 0 || step > this.room.state.plugin.step) return { error: 'BAD_STEP', code: 400, message: 'no such step' };
    const kept = this.history.filter(entry => entry.step <= step);
    return this.restart(kept, { bots: false });
  }
  // Lets the Bots move now (after a rewind, which leaves them where they were).
  moveBots() { if (!this.room) return { error: 'NO_MATCH', code: 409, message: 'start a match first' }; this.notes = []; this.runBots(); return { data: { step: this.room.state.plugin.step } }; }
  // The code changed: load it again and replay the whole recorded log on it. Returns what survived.
  reload() {
    const loaded = this.load();
    if (!loaded) return { ok: false, error: this.error };
    if (!this.setup) return { ok: true, started: false };
    const entries = this.history.map(({ seed, ...entry }) => entry), before = entries.length, restarted = this.restart(entries);
    if (restarted.code) { this.error = `${restarted.error}: ${restarted.message}`; return { ok: false, error: this.error, restarted: false }; }
    return { ok: true, kept: restarted.data.replayed, dropped: before - restarted.data.replayed, stopped: restarted.data.stopped };
  }
  exportLog() {
    if (!this.room) return null;
    const p = this.room.state.plugin;
    return { format: 'aiatt-plugin-log@1', plugin: p.id, version: p.version, config: p.config, seats: p.seats, seed: p.seed, startedAt: p.startedAt, actions: this.history.map(({ seed, events, ...entry }) => entry), steps: p.step, finalHash: hashState(p.state) };
  }
  snapshot(as) {
    const out = { revision: this.revision, error: this.error, notes: this.notes, last: this.last, plugin: null, setup: this.setup, match: null, history: this.history };
    if (this.plugin) {
      const m = this.plugin.manifest, host = this.graph.host;
      out.plugin = { id: m.id, version: m.version, category: m.category, name: m.name, seats: m.seats, capabilities: m.capabilities, actions: m.actions, hostActions: m.hostActions, config: m.config, engine: host.hasFunction(m.id, 'engine'), timeout: host.hasFunction(m.id, 'timeout') };
    }
    if (this.room) {
      const p = this.room.state.plugin, wanted = as || this.setup?.me, viewer = wanted && wanted !== 'spectator' && p.seats.some(s => s.id === wanted) ? wanted : null, seen = this.graph.host.view(this.room, viewer);
      out.match = { step: p.step, now: this.now, seats: p.seats, seed: p.seed, as: viewer || 'spectator', view: seen.code ? { error: seen.error, message: seen.message } : seen.data.view, decisions: p.decisions, result: p.result, stateBytes: Buffer.byteLength(JSON.stringify(p.state)), stateHash: hashState(p.state), open: viewer ? p.decisions.filter(d => d.actor === viewer).flatMap(d => d.actions) : [] };
    }
    return out;
  }
}
module.exports = { Session, stepSeed, START };
