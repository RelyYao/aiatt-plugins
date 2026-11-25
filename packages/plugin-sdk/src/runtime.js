// SPDX-License-Identifier: Apache-2.0
'use strict';
// Loading a plugin directory into the host, and the `check` command: manifest, bundle, sandbox load, required
// functions. Used by every other command.
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { errorText, walk } = require('./util');
const OPTIONAL = ['setup', 'timeout', 'leave', 'engine', 'secrets', 'migrate'];
const LOCALES = ['zh-CN', 'zh-TW', 'en'];
// What the host registers: the manifest as written, without the platform-only bridge fields.
function readManifest(dir) {
  const file = path.join(dir, 'plugin.json');
  if (!fs.existsSync(file)) throw Object.assign(new Error(`plugin.json is missing in ${dir}`), { code: 'PLUGIN_MANIFEST_MISSING' });
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw Object.assign(new Error(`plugin.json is not valid JSON: ${error.message}`), { code: 'PLUGIN_MANIFEST_INVALID' }); }
  const { runtime, bridge, ...manifest } = raw && typeof raw === 'object' ? raw : {};
  return { raw, manifest, legacy: runtime === 'legacy' };
}
function readPhrases(dir) {
  const phrases = {};
  for (const locale of LOCALES) { const file = path.join(dir, 'locales', locale + '.json'); if (fs.existsSync(file)) { try { phrases[locale] = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw Object.assign(new Error(`locales/${locale}.json is not valid JSON: ${error.message}`), { code: 'PLUGIN_LOCALE_INVALID' }); } } }
  return phrases;
}
// Bundles and registers the plugin in the host graph; throws the host's own errors (code + message).
function loadPlugin(dir, graph = loadHost()) {
  dir = path.resolve(dir);
  const { manifest, legacy } = readManifest(dir);
  if (legacy) throw Object.assign(new Error('this plugin is a legacy bridge: it has no server code of its own'), { code: 'PLUGIN_LEGACY' });
  const built = graph.bundler.bundle(dir), phrases = readPhrases(dir);
  const registered = graph.host.register({ manifest, source: built.source, filename: path.basename(dir), phrases });
  return { dir, graph, id: registered.id, manifest: registered, built, phrases };
}
function check(dir, { graph = loadHost() } = {}) {
  dir = path.resolve(dir);
  const report = { ok: false, dir, id: null, version: null, category: null, files: [], actions: [], functions: [], problems: [], warnings: [] };
  const fail = text => report.problems.push(text);
  let plugin = null;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw Object.assign(new Error(`${dir} is not a directory`), { code: 'PLUGIN_DIR_MISSING' });
    const { manifest, legacy } = readManifest(dir), checked = graph.manifests.check(manifest);
    if (legacy) fail('PLUGIN_LEGACY: a legacy bridge has no server code to run');
    else if (checked.problems) for (const problem of checked.problems) fail('PLUGIN_MANIFEST_INVALID: ' + problem);
    else {
      Object.assign(report, { id: checked.manifest.id, version: checked.manifest.version, category: checked.manifest.category, actions: Object.keys(checked.manifest.actions) });
      plugin = loadPlugin(dir, graph);
      report.files = plugin.built.files;
    }
  } catch (error) { fail(errorText(error)); }
  if (plugin) {
    const { id, manifest, phrases } = plugin, has = name => graph.host.hasFunction(id, name);
    report.functions = OPTIONAL.filter(has);
    if (manifest.capabilities.includes('deadlines') && !has('timeout')) report.warnings.push('the plugin has deadlines but no timeout(): a seat that does not answer in time cannot be moved on');
    if (manifest.capabilities.includes('hidden') && !has('secrets')) report.warnings.push('the plugin has hidden information but no secrets(): the leak check has nothing to look for');
    if (manifest.ai.mode === 'engine' && !has('engine')) report.warnings.push('ai.mode is "engine" but the plugin has no engine()');
    if (!has('engine') && manifest.capabilities.includes('aiSeats')) report.warnings.push('no engine(): Bot seats are played by random legal moves in the simulator only; add engine() for a real built-in Bot');
    if (!Object.keys(phrases).length) report.warnings.push('no locales/<locale>.json: ctx.t(key) returns the key');
    if (!fs.existsSync(path.join(dir, 'README.md'))) report.warnings.push('no README.md');
    if (!manifest.name['zh-CN']) report.warnings.push('name.zh-CN is missing: the product is Chinese first');
    if (!Object.keys(manifest.listing.description).length) report.warnings.push('listing.description is empty: the game picker shows no description');
  }
  report.ok = !report.problems.length;
  return report;
}
module.exports = { check, loadPlugin, readManifest, readPhrases, walk, OPTIONAL };
