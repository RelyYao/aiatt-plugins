// SPDX-License-Identifier: Apache-2.0
'use strict';
// The room plugin host (docs/design/platform/房间插件化底层设计-2026-11-24.md P0; interface:
// docs/design/platform/房间插件接口-room-plugin-v1.md). A plugin is pure logic; the host owns everything else: it
// checks seats, turns and every action against the manifest's schema before the plugin sees it, gives the plugin
// a per-step seed and the platform's clock, keeps the state's size within the manifest's limit, records every step
// in an action log (old steps move to the ledger archive, lib/store/store.js), turns expired deadlines into the
// plugin's own timeout action, and shows each person only plugin.view(state, them). A failed step changes nothing.
// The room keeps `room.state.plugin` = { id, version, seed, step, seats, config, state, decisions, result, log }.
// Callers run inside a store transaction; the host marks the change with store.save().
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store-shim');
const manifests = require('./plugin-manifest');
const schema = require('./plugin-schema');
const { createSandbox } = require('./plugin-sandbox');
const LOG_KEEP = 200, EVENT_BYTES = 4096;
const fail = (code, error, message, extra = {}) => ({ code, error, message: message || error, ...extra });
const registry = new Map();
const resultListeners = new Set();
const bytesOf = value => Buffer.byteLength(JSON.stringify(value) ?? '');
function register({ manifest: input, source, filename = 'plugin.js', phrases = {} }) {
  const checked = manifests.check(input);
  if (checked.problems) throw Object.assign(new Error('PLUGIN_MANIFEST_INVALID: ' + checked.problems.join('; ')), { code: 'PLUGIN_MANIFEST_INVALID', problems: checked.problems });
  // A legacy bridge (P1): catalog and capability answers only; its game framework module runs the matches.
  if (checked.manifest.runtime === 'legacy') { registry.set(checked.manifest.id, { manifest: checked.manifest, legacy: true, phrases }); return checked.manifest; }
  const manifest = checked.manifest, sandbox = createSandbox({ source, filename, callMs: manifest.limits.callMs });
  for (const name of ['decisions', 'apply', 'view', 'result']) if (!sandbox.has(name)) throw Object.assign(new Error(`PLUGIN_INCOMPLETE: ${manifest.id} has no ${name}()`), { code: 'PLUGIN_INCOMPLETE' });
  if (manifest.category === 'match' && !sandbox.has('setup')) throw Object.assign(new Error(`PLUGIN_INCOMPLETE: ${manifest.id} has no setup()`), { code: 'PLUGIN_INCOMPLETE' });
  registry.set(manifest.id, { manifest, sandbox, phrases, has: name => sandbox.has(name) });
  return manifest;
}
// Bundled plugins: <dir>/<id>/plugin.json + server/index.js and the files it requires (+ locales/<locale>.json for
// ctx.t). A legacy bridge (runtime: legacy) is registered from its manifest alone.
function loadDirectory(dir) {
  const loaded = [];
  if (!fs.existsSync(dir)) return loaded;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(dir, entry.name), manifestFile = path.join(root, 'plugin.json'), serverFile = path.join(root, 'server', 'index.js');
    if (!fs.existsSync(manifestFile)) continue;
    const raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (raw.runtime === 'legacy') { loaded.push(register({ manifest: raw })); continue; }
    if (!fs.existsSync(serverFile)) continue;
    const phrases = {};
    for (const locale of ['zh-CN', 'zh-TW', 'en']) { const file = path.join(root, 'locales', locale + '.json'); if (fs.existsSync(file)) phrases[locale] = JSON.parse(fs.readFileSync(file, 'utf8')); }
    // server/ may be several files: bundled into one (relative requires inside the plugin only, plugin-bundle.js).
    loaded.push(register({ manifest: raw, source: require('./plugin-bundle').bundle(root).source, filename: path.relative(dir, serverFile), phrases }));
  }
  return loaded;
}
function unregister(id) { registry.delete(id); }
// Whether a registered (non-legacy) plugin defines an optional function (leave, engine, timeout…).
function hasFunction(id, name) { const entry = registry.get(id); return !!entry && !entry.legacy && entry.has(name); }
// What the room picker and y-admin show: every registered plugin's public manifest.
function catalog(locale = 'zh-CN') {
  return [...registry.values()].map(({ manifest: m }) => ({ id: m.id, version: m.version, category: m.category, name: m.name[locale] || m.name.en, names: m.name, icon: m.icon, tone: m.tone,
    author: m.author, license: m.license, seats: m.seats, capabilities: m.capabilities, timing: m.timing, ai: m.ai, config: m.config, actions: Object.keys(m.actions), runtime: m.runtime || 'sandbox' }));
}
// Capability questions the core asks instead of naming a game (P1): the manifest of a plugin or bridged game key.
function manifestFor(key) { return registry.get(key)?.manifest || [...registry.values()].find(e => e.manifest.bridge?.game === key)?.manifest || null; }
function has(key, capability) { return !!manifestFor(key)?.capabilities.includes(capability); }
const entryOf = p => { const entry = p && registry.get(p.id); return entry && !entry.legacy && entry.manifest.version === p.version ? entry : null; };
const seedFor = (p, step, use = '') => crypto.createHash('sha256').update(`${p.seed}:${step}${use}`).digest('hex').slice(0, 32);
const context = (entry, p, extra, locale = 'zh-CN') => ({ now: extra.now, seats: p.seats, config: p.config, phrases: entry.phrases[locale] || entry.phrases.en || {}, ...extra });
// engine() moves are the platform's own bounded search, given limits.engineMs; every other call gets limits.callMs.
function run(entry, name, args, ctx) {
  try { return { value: entry.sandbox.call(name, args, ctx, name === 'engine' ? { timeoutMs: entry.manifest.limits.engineMs } : undefined).value }; }
  catch (error) { return { error: fail(error.code === 'PLUGIN_TIMEOUT' ? 504 : 500, error.code || 'PLUGIN_ERROR', error.message) }; }
}
// The open decisions after a step: who acts, which actions, until when. A decision that stays the same — same actor,
// same actions and, when the plugin gives one, the same `key` (e.g. the round and turn) — keeps its deadline; a new
// one starts its clock now. A plugin that keeps its own clock in its state names the moment itself (`deadlineAt`, ms),
// so its rules and the host's deadline agree, also for a match taken over mid-way.
function decisionsFor(entry, p, now) {
  const out = run(entry, 'decisions', [p.state], context(entry, p, { now }));
  if (out.error) return out;
  if (!Array.isArray(out.value) || out.value.length > 64) return { error: fail(500, 'PLUGIN_BAD_DECISIONS', 'decisions() must return a list') };
  const identity = d => d.actor + '\u0000' + d.actions.join(',') + '\u0000' + (d.key ?? '');
  const seatIds = new Set(p.seats.map(s => s.id)), previous = new Map((p.decisions || []).map(d => [identity(d), d.deadlineAt]));
  const decisions = [];
  for (const d of out.value) {
    const actions = Array.isArray(d?.actions) ? d.actions : [];
    if (!seatIds.has(d?.actor) || !actions.length || actions.some(a => !entry.manifest.actions[a])) return { error: fail(500, 'PLUGIN_BAD_DECISIONS', 'a decision names an unknown seat or action') };
    const seconds = Number.isFinite(d.deadlineSeconds) ? Math.max(1, Math.min(86400, d.deadlineSeconds)) : entry.manifest.capabilities.includes('deadlines') ? entry.manifest.timing.turnSeconds : null;
    const key = typeof d.key === 'string' || Number.isFinite(d.key) ? String(d.key).slice(0, 80) : null;
    // deadlineAt: a time (ms) the plugin keeps itself, or null for a decision that never runs out (e.g. resigning
    // while the opponent thinks); left out, the host keeps the clock.
    const fixed = Number.isSafeInteger(d.deadlineAt) && d.deadlineAt >= 0 ? d.deadlineAt : null, untimed = d.deadlineAt === null;
    decisions.push({ actor: d.actor, actions: [...actions], ...(key !== null ? { key } : {}), deadlineAt: untimed ? null : fixed ?? (seconds === null ? null : previous.get(identity({ actor: d.actor, actions, key })) ?? now + seconds * 1000) });
  }
  return { value: decisions };
}
function checkResult(p, value) {
  if (!value || typeof value !== 'object' || value.done !== true) return { done: false };
  const seatIds = new Set(p.seats.map(s => s.id));
  const ranking = Array.isArray(value.ranking) ? value.ranking.filter(group => Array.isArray(group)).map(group => group.filter(id => seatIds.has(id))) : [];
  return { done: true, ranking, summary: typeof value.summary === 'string' ? value.summary.slice(0, 500) : null, highlights: Array.isArray(value.highlights) ? value.highlights.slice(0, 20) : [] };
}
function record(room, p, entry) {
  p.log.push(entry);
  if (p.log.length > LOG_KEEP) {
    const moved = p.log.splice(0, p.log.length - LOG_KEEP);
    store.archive('pluginActions', moved.map(row => ({ id: `${room.id}:${p.match}:${row.step}`, at: row.at, room: room.id, subjects: row.actor ? [row.actor] : [], value: { ...row, plugin: p.id, version: p.version, match: p.match } })));
  }
}
// The seats a match is played by, checked against the manifest. Returns the normalized seats or a failure.
function seatsFor(m, seats) {
  if (!Array.isArray(seats) || seats.length < m.seats.min || seats.length > m.seats.max) return fail(400, 'PLUGIN_SEATS', `This plugin seats ${m.seats.min}–${m.seats.max}`);
  const seatIds = new Set();
  for (const s of seats) { if (!s || typeof s.id !== 'string' || !s.id || seatIds.has(s.id) || !['human', 'agent', 'bot'].includes(s.kind)) return fail(400, 'PLUGIN_SEATS', 'Each seat needs a unique id and a kind (human, agent or bot)'); seatIds.add(s.id); }
  return { data: seats.map(s => ({ id: s.id, kind: s.kind, ...(s.team !== undefined ? { team: String(s.team) } : {}), ...(s.name ? { name: String(s.name).slice(0, 40) } : {}), ...(s.engine === true ? { engine: true } : {}), ...(s.owner === true ? { owner: true } : {}) })) };
}
// `match` names the match (a game framework module passes its own match id); otherwise the host makes one.
function start(room, pluginId, { seats = [], config = {}, now = Date.now(), seed = crypto.randomBytes(16).toString('hex'), match = null } = {}) {
  const entry = registry.get(pluginId);
  if (!entry) return fail(404, 'PLUGIN_NOT_FOUND', 'No such room plugin');
  if (entry.legacy) return fail(409, 'PLUGIN_LEGACY', 'This game still runs in the game framework');
  const m = entry.manifest, seated = seatsFor(m, seats);
  if (seated.code) return seated;
  const options = schema.withDefaults(m.config, config || {}), problems = schema.validate(m.config, options);
  if (problems.length) return fail(400, 'PLUGIN_CONFIG_INVALID', 'Room options do not match the plugin', { problems });
  const p = { id: m.id, version: m.version, api: m.api, category: m.category, match: typeof match === 'string' && match ? match.slice(0, 80) : crypto.randomBytes(6).toString('hex'), seed, step: 0,
    seats: seated.data, config: options, state: null, decisions: [], result: null, startedAt: now, finishedAt: null, log: [] };
  const setup = entry.has('setup') ? run(entry, 'setup', [], context(entry, p, { now, seed: seedFor(p, 0) })) : { value: {} };
  if (setup.error) return setup.error;
  if (bytesOf(setup.value) > m.limits.stateBytes) return fail(500, 'PLUGIN_STATE_TOO_LARGE', 'setup() returned a state over the manifest limit');
  p.state = setup.value;
  const decisions = decisionsFor(entry, p, now); if (decisions.error) return decisions.error;
  p.decisions = decisions.value;
  const result = run(entry, 'result', [p.state], context(entry, p, { now })); if (result.error) return result.error;
  p.result = checkResult(p, result.value).done ? checkResult(p, result.value) : null;
  record(room, p, { step: 0, at: now, actor: null, action: { type: '$setup' }, events: [] });
  room.state ||= {}; room.state.plugin = p; store.save();
  return { data: { match: p.match, step: 0, decisions: p.decisions } };
}
// One step: `input` is { type, ...fields }. `system` marks the host's own moves (a timeout, an engine seat); the plugin
// sees ctx.system (to mark a move as made for the seat). `host` is the platform
// vouching that the actor is the room's host (who that is — the owner, anyone at a quick-match table — is the
// platform's rule): an action the manifest lists in hostActions is then taken whether or not the actor has a seat or
// an open decision, and the plugin sees ctx.host.
function act(room, actorId, input, { now = Date.now(), system = false, host = false } = {}) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  if (!entry) return fail(503, 'PLUGIN_VERSION_UNAVAILABLE', 'This plugin version is not loaded');
  if (p.result?.done) return fail(409, 'PLUGIN_FINISHED', 'This match is over');
  const m = entry.manifest, asHost = host === true && typeof actorId === 'string' && m.hostActions.includes(input?.type);
  if (!asHost && !p.seats.some(s => s.id === actorId)) return fail(403, 'PLUGIN_NOT_SEATED', 'You have no seat here');
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string' || !m.actions[input.type]) return fail(400, 'PLUGIN_UNKNOWN_ACTION', 'Unknown action');
  const { type, ...fields } = input, problems = schema.validate(m.actions[type], fields);
  if (problems.length) return fail(400, 'PLUGIN_ACTION_INVALID', 'The action does not match its description', { problems });
  if (!asHost && m.capabilities.includes('turns') && !p.decisions.some(d => d.actor === actorId && d.actions.includes(type))) return fail(409, 'NOT_YOUR_TURN', 'It is not your turn for that');
  const step = p.step + 1, action = { type, ...fields };
  const applied = run(entry, 'apply', [p.state, action], context(entry, p, { now, actor: actorId, seed: seedFor(p, step), ...(asHost ? { host: true } : {}), ...(system ? { system: true } : {}) }));
  if (applied.error) return applied.error;
  return commit(room, p, entry, applied.value, { step, now, actor: actorId, action, extra: { ...(system ? { system: true } : {}), ...(asHost ? { host: true } : {}) } });
}
// A seat leaves the match for good (everyone behind it left the room): the plugin's leave(state, seat, ctx) says what
// that does to the match. A plugin without leave() leaves it to the platform (conclude). Logged as a $leave step.
function leave(room, seatId, { now = Date.now() } = {}) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  if (!entry) return fail(503, 'PLUGIN_VERSION_UNAVAILABLE', 'This plugin version is not loaded');
  if (p.result?.done) return fail(409, 'PLUGIN_FINISHED', 'This match is over');
  if (!entry.has('leave')) return fail(409, 'PLUGIN_NO_LEAVE', 'This plugin does not handle a seat leaving');
  if (!p.seats.some(s => s.id === seatId)) return fail(403, 'PLUGIN_NOT_SEATED', 'No such seat');
  const step = p.step + 1, action = { type: '$leave', seat: seatId };
  const applied = run(entry, 'leave', [p.state, seatId], context(entry, p, { now, seed: seedFor(p, step) }));
  if (applied.error) return applied.error;
  return commit(room, p, entry, applied.value, { step, now, actor: null, action, extra: {} });
}
// A seat joins a match under way (a person sitting in at a standing table): the plugin's join(state, seat, ctx) says
// whether and how (say, between two hands). The seat is added to the match's seats; logged as a $join step.
function join(room, seat, { now = Date.now() } = {}) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  if (!entry) return fail(503, 'PLUGIN_VERSION_UNAVAILABLE', 'This plugin version is not loaded');
  if (p.result?.done) return fail(409, 'PLUGIN_FINISHED', 'This match is over');
  if (!entry.has('join')) return fail(409, 'PLUGIN_NO_JOIN', 'This plugin does not take seats during a match');
  const seated = seatsFor({ seats: { min: 1, max: entry.manifest.seats.max } }, [...p.seats, seat]);
  if (seated.code) return seated;
  const added = seated.data.at(-1), step = p.step + 1, action = { type: '$join', seat: added };
  const applied = run(entry, 'join', [p.state, added], context(entry, { ...p, seats: seated.data }, { now, seed: seedFor(p, step) }));
  if (applied.error) return applied.error;
  if (applied.value && typeof applied.value.error === 'string') return fail(409, applied.value.error.slice(0, 64), typeof applied.value.message === 'string' ? applied.value.message.slice(0, 200) : applied.value.error.slice(0, 64));
  const seats = p.seats;
  p.seats = seated.data;
  const done = commit(room, p, entry, applied.value, { step, now, actor: null, action, extra: {} });
  if (done.code) p.seats = seats;
  return done;
}
// The checks and the commit shared by act(), leave() and join(): `out` is what the plugin returned.
function commit(room, p, entry, out, { step, now, actor, action, extra }) {
  const m = entry.manifest;
  // A refusal is 409 (not allowed now); a plugin may say 400 (the input is malformed) or 403 (not this seat's to do).
  if (out && typeof out.error === 'string') return fail([400, 403, 409].includes(out.status) ? out.status : 409, out.error.slice(0, 64), typeof out.message === 'string' ? out.message.slice(0, 200) : out.error.slice(0, 64));
  if (!out || typeof out !== 'object' || !Object.hasOwn(out, 'state')) return fail(500, 'PLUGIN_BAD_RESULT', 'apply() must return { state, events } or { error }');
  if (bytesOf(out.state) > m.limits.stateBytes) return fail(500, 'PLUGIN_STATE_TOO_LARGE', 'The new state is over the manifest limit');
  const events = Array.isArray(out.events) ? out.events : [];
  if (events.length > m.limits.eventsPerAction || events.some(e => !e || typeof e !== 'object' || typeof e.type !== 'string' || bytesOf(e) > EVENT_BYTES)) return fail(500, 'PLUGIN_BAD_EVENTS', 'Events must be small objects with a type');
  // Everything below only commits once every check passed: a failed step leaves the room as it was.
  const next = { ...p, state: out.state, step };
  const decisions = decisionsFor(entry, next, now); if (decisions.error) return decisions.error;
  const result = run(entry, 'result', [next.state], context(entry, next, { now })); if (result.error) return result.error;
  const finished = checkResult(next, result.value);
  p.state = out.state; p.step = step; p.decisions = finished.done ? [] : decisions.value;
  if (finished.done) { p.result = finished; p.finishedAt = now; }
  record(room, p, { step, at: now, actor, action, events, ...extra });
  store.save();
  if (finished.done) store.afterCommit(() => { for (const listener of resultListeners) { try { listener(room, p); } catch (error) { console.error('[plugins] result listener:', error.message); } } });
  return { data: { step, events, decisions: p.decisions, result: p.result } };
}
// Takes over a match a game framework module started before its rules moved into the plugin (the switch-over, P3):
// the plugin's state is given as it stands; the log starts here (a replay covers the steps from this point).
function adopt(room, pluginId, { seats = [], state, config = {}, now = Date.now(), match = null, seed = crypto.randomBytes(16).toString('hex') } = {}) {
  const entry = registry.get(pluginId);
  if (!entry || entry.legacy) return fail(404, 'PLUGIN_NOT_FOUND', 'No such room plugin');
  const seated = seatsFor(entry.manifest, seats); if (seated.code) return seated;
  if (bytesOf(state) > entry.manifest.limits.stateBytes) return fail(500, 'PLUGIN_STATE_TOO_LARGE', 'The adopted state is over the manifest limit');
  state = JSON.parse(JSON.stringify(state ?? null)); // a plugin's state is JSON (no undefined fields), as the sandbox hands it
  const p = { id: entry.manifest.id, version: entry.manifest.version, api: entry.manifest.api, category: entry.manifest.category, match: typeof match === 'string' && match ? match.slice(0, 80) : crypto.randomBytes(6).toString('hex'), seed, step: 0,
    seats: seated.data, config: schema.withDefaults(entry.manifest.config, config || {}), state, origin: structuredClone(state), decisions: [], result: null, startedAt: now, finishedAt: null, adopted: true, log: [] };
  room.state ||= {}; room.state.plugin = p;
  record(room, p, { step: 0, at: now, actor: null, action: { type: '$adopt' }, events: [] });
  const synced = resync(room, now);
  return synced.code ? synced : { data: { match: p.match, decisions: p.decisions, result: p.result } };
}
// The platform ends a match itself (a player left, an administrator voided it, an Agent execution stopped): the
// plugin is not asked; the result says why. `ranking` is null for a match that counts for no one.
function conclude(room, { ranking = null, reason = 'platform', now = Date.now() } = {}) {
  const p = room?.state?.plugin;
  if (!p) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  if (p.result?.done) return { data: { result: p.result, unchanged: true } };
  const seatIds = new Set(p.seats.map(s => s.id));
  p.result = { done: true, ranking: Array.isArray(ranking) ? ranking.map(group => group.filter(id => seatIds.has(id))) : [], summary: null, highlights: [], imposed: String(reason).slice(0, 60) };
  p.decisions = []; p.finishedAt = now;
  record(room, p, { step: p.step + 1, at: now, actor: null, action: { type: '$conclude', reason: p.result.imposed }, events: [] });
  p.step++;
  store.save();
  return { data: { result: p.result } };
}
// A bundled plugin by id (plugins/<id>), loaded on first use: a game framework module that runs its rules in the
// plugin needs it whether or not the server loaded the directory (tests, scripts).
function ensureBundled(id) {
  const entry = registry.get(id);
  if (entry && !entry.legacy) return entry.manifest;
  const root = path.join(__dirname, '..', '..', 'plugins', id), raw = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  if (raw.runtime === 'legacy') throw Object.assign(new Error(`PLUGIN_LEGACY: ${id} is still run by the game framework`), { code: 'PLUGIN_LEGACY' });
  return register({ manifest: raw, source: require('./plugin-bundle').bundle(root).source, filename: `plugins/${id}` });
}
// After the platform changed a plugin's state outside a step (a version migration, an administrator's repair): the
// open decisions and the result are worked out again from the state as it now is.
function resync(room, now = Date.now()) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p || !entry) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  const decisions = decisionsFor(entry, p, now); if (decisions.error) return decisions.error;
  const result = run(entry, 'result', [p.state], context(entry, p, { now })); if (result.error) return result.error;
  const finished = checkResult(p, result.value);
  p.decisions = finished.done ? [] : decisions.value; p.result = finished.done ? finished : null;
  store.save();
  return { data: { decisions: p.decisions, result: p.result } };
}
// Deadlines that have passed become the plugin's own timeout move for that seat (or a pass the plugin defines);
// the match always moves on. Returns the steps taken.
function expire(room, now = Date.now()) {
  const steps = [];
  for (let guard = 0; guard < 16; guard++) {
    const p = room?.state?.plugin, entry = entryOf(p);
    if (!p || !entry || p.result?.done) break;
    const due = p.decisions.find(d => d.deadlineAt !== null && d.deadlineAt <= now);
    if (!due) break;
    const chosen = entry.has('timeout') ? run(entry, 'timeout', [p.state, due], context(entry, p, { now, seed: seedFor(p, p.step + 1, ':timeout') })) : { value: null };
    const move = !chosen.error && chosen.value && typeof chosen.value.type === 'string' ? chosen.value : null;
    const done = move ? act(room, due.actor, move, { now, system: true }) : chosen.error || fail(500, 'PLUGIN_NO_TIMEOUT_MOVE', 'timeout() gave no valid action');
    steps.push({ actor: due.actor, action: move, error: done.code ? done.error : null });
    if (done.code) { due.deadlineAt = null; store.save(); break; }
  }
  return steps;
}
// Seats the platform plays itself (kind 'bot', or `engine: true`: the built-in Bot, a house side), when the plugin
// defines engine(state, decision, ctx) — whatever ai.mode says about Agent seats: each such open decision gets the plugin's engine move, as a system step.
// engine() returns null for a decision it leaves alone (e.g. an optional resignation). Returns the steps taken; stops
// at the first refusal so a broken engine cannot loop.
function autoPlay(room, now = Date.now()) {
  const steps = [];
  for (let guard = 0; guard < 64; guard++) {
    const p = room?.state?.plugin, entry = entryOf(p);
    if (!p || !entry || p.result?.done || !entry.has('engine')) break;
    const engineSeats = new Set(p.seats.filter(s => s.kind === 'bot' || s.engine === true).map(s => s.id));
    let due = null, chosen = null;
    for (const decision of p.decisions.filter(d => engineSeats.has(d.actor))) {
      chosen = run(entry, 'engine', [p.state, decision], context(entry, p, { now, seed: seedFor(p, p.step + 1, ':engine') }));
      if (chosen.error || chosen.value !== null) { due = decision; break; }
    }
    if (!due) break;
    const move = !chosen.error && chosen.value && typeof chosen.value.type === 'string' ? chosen.value : null;
    const done = move ? act(room, due.actor, move, { now, system: true }) : chosen.error || fail(500, 'PLUGIN_NO_ENGINE_MOVE', 'engine() gave no valid action');
    steps.push({ actor: due.actor, action: move, error: done.code ? done.error : null });
    if (done.code) break;
  }
  return steps;
}
// What one person (or a spectator, viewerId null) sees: the plugin's view of the state for them, plus the open
// decisions (other seats' allowed actions hidden) and the result.
function view(room, viewerId = null) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  if (!entry) return fail(503, 'PLUGIN_VERSION_UNAVAILABLE', 'This plugin version is not loaded');
  const seated = p.seats.some(s => s.id === viewerId) ? viewerId : null;
  const seen = run(entry, 'view', [p.state, seated], context(entry, p, { now: Date.now() }));
  if (seen.error) return seen.error;
  return { data: { plugin: { id: p.id, version: p.version }, match: p.match, step: p.step, seats: p.seats, me: seated, view: seen.value,
    decisions: p.decisions.map(d => ({ actor: d.actor, deadlineAt: d.deadlineAt, ...(d.actor === seated ? { actions: d.actions } : {}) })), result: p.result } };
}
// The values the plugin says only some seats may see (optional secrets(state) → [{ value, visibleTo: [seat ids] }]),
// for the leak check (lib/plugins/plugin-conformance.js) and audits. A plugin without secrets() declares none.
function secrets(room) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p || !entry) return fail(404, 'PLUGIN_NOT_RUNNING', 'This room has no plugin');
  if (!entry.has('secrets')) return { data: [] };
  const out = run(entry, 'secrets', [p.state], context(entry, p, { now: Date.now() }));
  if (out.error) return out.error;
  if (!Array.isArray(out.value) || out.value.some(s => !s || !Array.isArray(s.visibleTo))) return fail(500, 'PLUGIN_BAD_RESULT', 'secrets() must list { value, visibleTo }');
  return { data: out.value.map(s => ({ value: s.value, visibleTo: s.visibleTo.filter(id => typeof id === 'string') })) };
}
// Replays the match from its seed and action log (archived steps included) and checks it ends in the same state.
function replay(room) {
  const p = room?.state?.plugin, entry = entryOf(p);
  if (!p || !entry) return fail(404, 'PLUGIN_NOT_RUNNING', 'Nothing to replay');
  const archived = [];
  for (let before = null, page; (page = store.archived({ ledger: 'pluginActions', room: room.id, before, limit: 1000 })).length; before = [page.at(-1).at, page.at(-1).id]) archived.push(...page.filter(r => r.value.match === p.match).map(r => r.value));
  const log = [...archived, ...p.log].sort((a, b) => a.step - b.step);
  // Seats that joined during the match were not at the table when it started: they come back in with their $join.
  const joined = new Set(log.filter(row => row.action?.type === '$join').map(row => row.action.seat.id));
  const copy = { ...p, seats: p.seats.filter(s => !joined.has(s.id)), state: null, decisions: [], log: [] };
  // An adopted match starts from the state it was taken over in; platform entries change no state ($conclude) or
  // are the plugin's own answer to them ($leave).
  const setup = p.adopted ? { value: structuredClone(p.origin) } : entry.has('setup') ? run(entry, 'setup', [], context(entry, copy, { now: p.startedAt, seed: seedFor(p, 0) })) : { value: {} };
  if (setup.error) return setup.error;
  let state = setup.value;
  for (const row of log) {
    const type = String(row.action?.type);
    if (row.step === 0 || (type.startsWith('$') && type !== '$leave' && type !== '$join')) continue;
    if (type === '$join') copy.seats = [...copy.seats, row.action.seat];
    const out = type === '$leave' ? run(entry, 'leave', [state, row.action.seat], context(entry, copy, { now: row.at, seed: seedFor(p, row.step) }))
      : type === '$join' ? run(entry, 'join', [state, row.action.seat], context(entry, copy, { now: row.at, seed: seedFor(p, row.step) }))
      : run(entry, 'apply', [state, row.action], context(entry, copy, { now: row.at, actor: row.actor, seed: seedFor(p, row.step), ...(row.host ? { host: true } : {}), ...(row.system ? { system: true } : {}) }));
    if (out.error || !out.value || Object.hasOwn(out.value, 'error')) return { data: { ok: false, failedAt: row.step } };
    state = out.value.state;
  }
  const same = JSON.stringify(state) === JSON.stringify(p.state);
  return { data: { ok: same, steps: log.length - 1, failedAt: same ? null : p.step } };
}
function onResult(listener) { resultListeners.add(listener); return () => resultListeners.delete(listener); }
module.exports = { register, loadDirectory, ensureBundled, unregister, hasFunction, catalog, manifestFor, has, start, adopt, act, leave, join, conclude, expire, autoPlay, resync, view, secrets, replay, onResult, LOG_KEEP };
