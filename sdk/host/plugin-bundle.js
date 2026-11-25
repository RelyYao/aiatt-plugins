// SPDX-License-Identifier: Apache-2.0
'use strict';
// Bundles a plugin's server code into the one file the sandbox runs (docs/design/platform/房间插件接口-room-plugin-v1.md
// §3): server/index.js and every file it requires with a literal relative path inside the plugin directory, plus the
// plugin kit: `require('@aiatt/plugin-kit/<name>')` is plugins/kit/<name>.js, pure rules several plugins share (the
// puzzle templates Puzzle and Endless Corridor both play), held to the same sandbox rules; a kit file may require
// only other kit files. A require of anything else — a platform or Node module, a path outside the plugin or the
// kit, a computed name — is refused, so a plugin can be split into files without gaining a way out of the sandbox.
// Deterministic: the same files give the same bundle (P4's `build` uses it too).
const fs = require('node:fs');
const path = require('node:path');
const REQUIRE = /\brequire\s*\(/g;
const LITERAL = /^\s*(['"])((?:\.{1,2}|@aiatt\/plugin-kit)\/[^'"\\]+)\1\s*\)/;
const KIT = '@aiatt/plugin-kit/', KIT_ROOT = path.join(__dirname, '..', '..', 'plugins', 'kit'), KIT_KEY = '@kit/';
const fail = message => Object.assign(new Error('PLUGIN_BUNDLE_FAILED: ' + message), { code: 'PLUGIN_BUNDLE_FAILED' });
// A file is keyed by its path in the plugin, or '@kit/<path>' in the kit.
const locate = (root, key) => key.startsWith(KIT_KEY) ? path.join(KIT_ROOT, key.slice(KIT_KEY.length)) : path.join(root, key);
function resolveIn(root, from, request) {
  if (request.startsWith(KIT) || from.startsWith(KIT_KEY)) {
    let target = request.startsWith(KIT) ? path.join(KIT_ROOT, request.slice(KIT.length)) : path.resolve(path.dirname(locate(root, from)), request);
    if (!target.endsWith('.js') && !target.endsWith('.json')) target += '.js';
    const relative = path.relative(KIT_ROOT, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw fail(`${from} requires ${request}, outside the plugin kit`);
    if (!fs.existsSync(target)) throw fail(`${from} requires ${request}, which does not exist`);
    return KIT_KEY + relative.split(path.sep).join('/');
  }
  let target = path.resolve(path.dirname(path.join(root, from)), request);
  if (!target.endsWith('.js') && !target.endsWith('.json')) target += '.js';
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw fail(`${from} requires ${request}, outside the plugin`);
  if (!fs.existsSync(target)) throw fail(`${from} requires ${request}, which does not exist`);
  return relative.split(path.sep).join('/');
}
function bundle(root, entry = 'server/index.js') {
  const files = new Map(), queue = [entry];
  if (!fs.existsSync(path.join(root, entry))) throw fail(`${entry} is missing`);
  while (queue.length) {
    const name = queue.shift();
    if (files.has(name)) continue;
    const source = fs.readFileSync(locate(root, name), 'utf8'), links = {};
    if (name.endsWith('.json')) { files.set(name, { source: 'module.exports = ' + JSON.stringify(JSON.parse(source)) + ';', links }); continue; }
    for (const match of source.matchAll(REQUIRE)) {
      const literal = LITERAL.exec(source.slice(match.index + match[0].length));
      if (!literal) throw fail(`${name} requires something other than a relative path inside the plugin or the plugin kit`);
      const target = resolveIn(root, name, literal[2]);
      links[literal[2]] = target;
      queue.push(target);
    }
    files.set(name, { source, links });
  }
  const defs = [...files].map(([name, { source, links }]) => `${JSON.stringify(name)}: [${JSON.stringify(links)}, function (module, exports, require) {\n${source}\n}]`);
  return { files: [...files.keys()], source: `const __defs = {\n${defs.join(',\n')}\n};
const __cache = {};
function __load(name) {
  if (__cache[name]) return __cache[name].exports;
  const [links, body] = __defs[name], module = __cache[name] = { exports: {} };
  body(module, module.exports, request => { if (!Object.hasOwn(links, request)) throw new Error('PLUGIN_REQUIRE_FORBIDDEN: ' + request); return __load(links[request]); });
  return module.exports;
}
module.exports = __load(${JSON.stringify(entry)});
` };
}
// A file of a bundled plugin that the platform itself reads (lib/games/corridor reads the corridor's tower builder):
// bundled the same way, so the kit resolves as in the sandbox, and evaluated in Node once. Only for the repository's
// own plugins (plugins/<id>), which are trusted code; a community plugin only ever runs in the sandbox.
const loaded = new Map();
function load(id, entry) {
  const key = id + ':' + entry;
  if (!loaded.has(key)) {
    const module = { exports: {} };
    new Function('module', 'exports', bundle(path.join(__dirname, '..', '..', 'plugins', id), entry).source)(module, module.exports);
    loaded.set(key, module.exports);
  }
  return loaded.get(key);
}
module.exports = { bundle, load };
