// SPDX-License-Identifier: Apache-2.0
'use strict';
// plugin.json, the manifest every room plugin ships (docs/design/platform/房间插件接口-room-plugin-v1.md §2): who it
// is, which API it speaks, which platform capabilities it asks for, its seats, actions and options (JSON Schema,
// lib/plugins/plugin-schema.js), pricing and limits. check() returns the normalized manifest or the list of problems;
// the host refuses a plugin with any problem.
const { schemaProblems } = require('./plugin-schema');
const API = 'room-plugin@1';
// What a plugin may ask the platform for. The host hands a plugin only what its manifest declares.
const CAPABILITIES = ['rng', 'turns', 'deadlines', 'teams', 'hidden', 'spectators', 'aiSeats', 'scoring', 'highlights', 'commitReveal', 'messages', 'timers', 'panels', 'voice'];
const CATEGORIES = ['match', 'activity'];
const LOCALES = ['zh-CN', 'zh-TW', 'en'];
const LIMITS = { stateBytes: { default: 65536, max: 1048576 }, eventsPerAction: { default: 20, max: 200 }, callMs: { default: 200, max: 500 }, engineMs: { default: null, max: 2000 } };
const SEMVER = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const ACTION = /^[a-z][a-zA-Z0-9_-]{0,39}$/;
function text(value, max) { return typeof value === 'string' && value.trim() && [...value].length <= max; }
function check(input) {
  const problems = [], m = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (!ID.test(m.id || '')) problems.push('id must be 2–40 lowercase letters, digits or hyphens, starting with a letter');
  if (!SEMVER.test(m.version || '')) problems.push('version must be MAJOR.MINOR.PATCH');
  if (m.api !== API) problems.push(`api must be "${API}"`);
  if (!CATEGORIES.includes(m.category)) problems.push('category must be ' + CATEGORIES.join(' or '));
  if (!m.name || typeof m.name !== 'object' || !text(m.name.en, 40)) problems.push('name.en is required (at most 40 characters)');
  else for (const [locale, value] of Object.entries(m.name)) if (!LOCALES.includes(locale) || !text(value, 40)) problems.push(`name.${locale} is not a supported locale or is too long`);
  if (!text(m.author, 80)) problems.push('author is required');
  if (!text(m.license, 40)) problems.push('license is required');
  const seats = m.seats || {};
  if (!(Number.isSafeInteger(seats.min) && Number.isSafeInteger(seats.max) && seats.min >= (m.category === 'activity' ? 0 : 1) && seats.max >= seats.min && seats.max <= 32)) problems.push('seats.min/max must be whole numbers with min ≤ max ≤ 32');
  if (seats.teams !== undefined && !['solo', 'teams', 'free'].includes(seats.teams)) problems.push('seats.teams must be solo, teams or free');
  // seats.people: how many people sit at the table, when a seat is a team (a person and their Agents, a side): the
  // game picker shows it; seats.min/max count the plugin's seats. Defaults to the seats.
  const people = seats.people === undefined ? { min: seats.min, max: seats.max } : seats.people;
  if (!(people && Number.isSafeInteger(people.min) && Number.isSafeInteger(people.max) && people.min >= 0 && people.max >= people.min && people.max <= 64)) problems.push('seats.people must be {min, max} with 0 ≤ min ≤ max ≤ 64');
  const capabilities = Array.isArray(m.capabilities) ? m.capabilities : [];
  for (const capability of capabilities) if (!CAPABILITIES.includes(capability)) problems.push(`capability ${JSON.stringify(capability)} is unknown`);
  if (new Set(capabilities).size !== capabilities.length) problems.push('capabilities are listed twice');
  const ai = m.ai || { mode: 'none', price: 0 };
  if (!['engine', 'model', 'none'].includes(ai.mode) || !(Number.isSafeInteger(ai.price) && ai.price >= 0 && ai.price <= 10000)) problems.push('ai.mode must be engine, model or none, ai.price a whole number of points (0–10000)');
  if (ai.mode !== 'none' && !capabilities.includes('aiSeats')) problems.push('ai.mode other than none needs the aiSeats capability');
  const timing = m.timing || {};
  if (timing.turnSeconds !== undefined && !(Number.isSafeInteger(timing.turnSeconds) && timing.turnSeconds >= 5 && timing.turnSeconds <= 3600)) problems.push('timing.turnSeconds must be 5–3600');
  if (m.config !== undefined) { problems.push(...schemaProblems(m.config, 'config')); if (m.config?.type !== 'object') problems.push('config.type must be "object"'); }
  // A legacy bridge (P1) describes a game the existing game framework still runs (lib/games/<game>): no actions or
  // server code of its own, only who it is and what it needs from the platform.
  const legacy = m.runtime === 'legacy';
  if (m.runtime !== undefined && !legacy) problems.push('runtime must be "legacy" or absent');
  if (legacy && !(m.bridge && typeof m.bridge.game === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(m.bridge.game))) problems.push('a legacy plugin names its game in bridge.game');
  const actions = m.actions && typeof m.actions === 'object' && !Array.isArray(m.actions) ? m.actions : legacy && m.actions === undefined ? {} : null;
  if (!actions || (!legacy && !Object.keys(actions).length)) problems.push('actions must describe at least one action');
  else for (const [name, schema] of Object.entries(actions)) {
    if (!ACTION.test(name)) problems.push(`action name ${JSON.stringify(name)} is invalid`);
    problems.push(...schemaProblems(schema, `actions.${name}`));
    if (schema?.type !== 'object') problems.push(`actions.${name}.type must be "object"`);
    if (schema?.properties?.type) problems.push(`actions.${name} must not declare "type": the platform sets it to the action name`);
  }
  // hostActions: actions the room's host may take at any time, seated or not (e.g. revealing a vote early).
  const hostActions = m.hostActions === undefined ? [] : m.hostActions;
  if (!Array.isArray(hostActions) || hostActions.some(name => !actions || !Object.hasOwn(actions, name))) problems.push('hostActions must list actions the plugin describes');
  // listing: where the game picker shows it (tier, featured order, descriptions); client: its front end (tone, icon,
  // English label, module and style files relative to public/, loaded by public/game-pack-loader.mjs).
  const listing = m.listing === undefined ? null : m.listing;
  if (listing !== null) {
    if (!listing || typeof listing !== 'object' || !['featured', 'casual', 'labs'].includes(listing.tier)) problems.push('listing.tier must be featured, casual or labs');
    else {
      if (listing.order !== undefined && !(Number.isSafeInteger(listing.order) && listing.order >= 1 && listing.order <= 99)) problems.push('listing.order must be 1–99');
      for (const [locale, value] of Object.entries(listing.description || {})) if (!LOCALES.includes(locale) || !text(value, 300)) problems.push(`listing.description.${locale} must be a supported locale, at most 300 characters`);
    }
  }
  const client = m.client === undefined ? null : m.client, asset = value => typeof value === 'string' && /^\.\/[a-z0-9][a-z0-9/_.-]{0,120}\.(?:mjs|js|css)$/.test(value) && !value.includes('..');
  if (client !== null) {
    if (!client || typeof client !== 'object') problems.push('client must be an object');
    else {
      for (const key of ['tone', 'icon']) if (client[key] !== undefined && !/^[a-z][a-z-]{0,19}$/.test(client[key])) problems.push(`client.${key} must be a short lowercase name`);
      if (client.label !== undefined && !text(client.label, 40)) problems.push('client.label must be at most 40 characters');
      for (const key of ['mobile', 'desktop']) if (client[key] !== undefined && client[key] !== null && !asset(client[key])) problems.push(`client.${key} must be a ./path to a .mjs or .js file`);
      for (const key of ['mobileStyles', 'desktopStyles', 'desktopDependencies']) if (client[key] !== undefined && !(Array.isArray(client[key]) && client[key].length <= 8 && client[key].every(asset))) problems.push(`client.${key} must list ./paths`);
    }
  }
  const limits = {};
  for (const [key, { default: fallback, max }] of Object.entries(LIMITS)) {
    const value = m.limits?.[key];
    if (value === undefined) limits[key] = fallback;
    else if (!(Number.isSafeInteger(value) && value > 0 && value <= max)) problems.push(`limits.${key} must be 1–${max}`);
    else limits[key] = value;
  }
  limits.engineMs ??= limits.callMs; // an engine move gets the ordinary limit unless the manifest gives it more
  if (problems.length) return { problems };
  return { manifest: {
    id: m.id, version: m.version, api: API, category: m.category, name: { ...m.name }, icon: typeof m.icon === 'string' ? m.icon.slice(0, 40) : null, tone: typeof m.tone === 'string' ? m.tone.slice(0, 20) : null,
    author: m.author.trim(), license: m.license.trim(), seats: { min: seats.min, max: seats.max, teams: seats.teams || 'solo', people: { min: people?.min, max: people?.max } }, capabilities: [...capabilities],
    timing: { turnSeconds: timing.turnSeconds || 60, timed: timing.timed === true }, ai: { mode: ai.mode, price: ai.price },
    config: m.config || { type: 'object', properties: {} }, actions: structuredClone(actions), hostActions: [...new Set(hostActions)], limits, client: client ? structuredClone(client) : {},
    listing: listing ? { tier: listing.tier, ...(listing.order ? { order: listing.order } : {}), description: { ...(listing.description || {}) } } : { tier: 'labs', description: {} },
    ...(legacy ? { runtime: 'legacy', bridge: { game: m.bridge.game } } : {}),
  } };
}
// The plugins bundled in the repository (plugins/<id>/plugin.json), checked, read once. The game catalog and the
// front-end catalog (scripts/build-plugin-catalog.mjs) come from here; a broken manifest stops the process.
let bundledCache = null;
function bundled() {
  if (bundledCache) return bundledCache;
  const fs = require('node:fs'), path = require('node:path'), dir = path.join(__dirname, '..', '..', 'plugins'), out = new Map();
  for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const file = path.join(dir, entry.name, 'plugin.json');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const checked = check(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (checked.problems) throw new Error(`PLUGIN_MANIFEST_INVALID plugins/${entry.name}: ${checked.problems.join('; ')}`);
    out.set(checked.manifest.id, checked.manifest);
  }
  return (bundledCache = out);
}
module.exports = { API, CAPABILITIES, CATEGORIES, LIMITS, check, bundled };
