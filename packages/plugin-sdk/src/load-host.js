// SPDX-License-Identifier: Apache-2.0
'use strict';
// Loads the room plugin host the SDK drives. One explicit rule decides where the host's files come from:
//   1. ../host/plugin-host.js (next to the package) or <repo>/sdk/host/plugin-host.js exists -> the exported open-source
//      layout (sdk/host/, copied from the platform by the export script): those files are used.
//   2. otherwise ../../../lib/plugins/plugin-host.js exists -> the platform repository: the platform's own files.
//   3. otherwise the load fails, saying where it looked.
// Either way the six host files (host, conformance, manifest, schema, bundle, sandbox) are compiled here into a
// private module graph, so nothing is added to require.cache and the platform's real host and store in the same
// process (the platform's own tests) are untouched. Inside that graph the host's store module (the text
// require('../store/store') in the platform, require('./store-shim') once exported) is answered with the in-memory
// store-shim, so no database is needed and nothing is written to disk.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { builtinModules } = require('node:module');
const FILES = ['plugin-host', 'plugin-conformance', 'plugin-manifest', 'plugin-schema', 'plugin-bundle', 'plugin-sandbox'];
const STORE_REQUESTS = new Set(['../store/store', '../store/store.js', './store-shim', './store-shim.js']);
const has = dir => FILES.every(name => fs.existsSync(path.join(dir, name + '.js')));
function locate() {
  const exported = path.resolve(__dirname, '..', 'host'), repoRoot = path.resolve(__dirname, '..', '..', '..', 'sdk', 'host'), platform = path.resolve(__dirname, '..', '..', '..', 'lib', 'plugins');
  if (fs.existsSync(path.join(exported, 'plugin-host.js'))) return { layout: 'exported', dir: exported };
  if (fs.existsSync(path.join(repoRoot, 'plugin-host.js'))) return { layout: 'exported', dir: repoRoot };
  if (fs.existsSync(path.join(platform, 'plugin-host.js'))) return { layout: 'platform', dir: platform };
  throw new Error(`PLUGIN_HOST_NOT_FOUND: looked for ${path.join(exported, 'plugin-host.js')}, ${path.join(repoRoot, 'plugin-host.js')} and ${path.join(platform, 'plugin-host.js')}`);
}
// A fresh graph (its own plugin registry) from the files in `dir`; `store` answers the host's store requests.
function createGraph(dir, store) {
  if (!has(dir)) throw new Error(`PLUGIN_HOST_INCOMPLETE: ${dir} must hold ${FILES.map(name => name + '.js').join(', ')}`);
  const modules = new Map();
  const load = name => {
    if (modules.has(name)) return modules.get(name).exports;
    const file = path.join(dir, name + '.js'), module = { exports: {} };
    modules.set(name, module);
    const request = id => {
      if (STORE_REQUESTS.has(id)) return store;
      const local = /^\.\/(plugin-[a-z]+)(?:\.js)?$/.exec(id);
      if (local && FILES.includes(local[1])) return load(local[1]);
      if (id.startsWith('node:') || builtinModules.includes(id)) return require(id);
      throw new Error(`PLUGIN_HOST_REQUIRE: ${name}.js requires ${id}, which the SDK does not provide`);
    };
    const fn = vm.compileFunction(fs.readFileSync(file, 'utf8'), ['exports', 'require', 'module', '__filename', '__dirname'], { filename: file });
    fn.call(module.exports, module.exports, request, module, file, dir);
    return module.exports;
  };
  const host = load('plugin-host'), conformance = load('plugin-conformance'), manifests = load('plugin-manifest'), schema = load('plugin-schema'), bundler = load('plugin-bundle'), sandbox = load('plugin-sandbox');
  return { host, conformance, manifests, schema, bundler, sandbox, store };
}
let shared = null;
// loadHost() -> the shared graph (one per process); loadHost({ fresh: true }) -> a graph of its own (own registry and
// archive), for a simulator that must not see another run's plugins.
function loadHost({ fresh = false } = {}) {
  if (!fresh && shared) return shared;
  const { layout, dir } = locate(), store = fresh ? require('./store-shim').createStore() : require('./store-shim');
  const graph = { layout, dir, ...createGraph(dir, store) };
  if (!fresh) shared = graph;
  return graph;
}
module.exports = { loadHost, locate, createGraph, FILES };
