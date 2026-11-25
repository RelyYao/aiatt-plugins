// SPDX-License-Identifier: Apache-2.0
'use strict';
// Runs a room plugin's server code (docs/design/platform/房间插件接口-room-plugin-v1.md §3). The plugin is one file of
// pure functions; it runs in its own vm context with no require, process, timers, clock or Math.random, and with
// string code generation (eval, new Function, WebAssembly) disabled. Every call has a time limit (microtasks
// included) and is synchronous; arguments and results cross the boundary as JSON text only, so a plugin can neither
// hold a reference to platform objects nor hand back anything but data, and the result's size is known before it is
// parsed. Randomness comes from a per-call seed (ctx.rng), so every step replays exactly.
// node:vm is not a security boundary against hostile code: bundled and reviewed plugins run here; community plugins
// get a separate process behind this same interface (P5 in the design).
const vm = require('node:vm');
const crypto = require('node:crypto');
const PRELUDE = `'use strict';
Math.random = () => { throw new Error('PLUGIN_RANDOM_FORBIDDEN: use ctx.rng'); };
globalThis.Date = undefined; globalThis.SharedArrayBuffer = undefined; globalThis.Atomics = undefined;
const definePlugin = plugin => plugin;
// sfc32 from a 128-bit hex seed: the same seed gives the same numbers on every run and every machine.
function makeRng(hex) {
  let a = parseInt(hex.slice(0, 8), 16) >>> 0, b = parseInt(hex.slice(8, 16), 16) >>> 0, c = parseInt(hex.slice(16, 24), 16) >>> 0, d = parseInt(hex.slice(24, 32), 16) >>> 0;
  const next = () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return (t >>> 0) / 4294967296; };
  for (let i = 0; i < 12; i++) next();
  const rng = () => next();
  rng.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  rng.pick = list => list[Math.floor(next() * list.length)];
  rng.shuffle = list => { const out = list.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const x = out[i]; out[i] = out[j]; out[j] = x; } return out; };
  return rng;
}
function makeContext(raw) {
  if (!raw) return undefined;
  const ctx = Object.assign({}, raw);
  if (raw.seed) ctx.rng = makeRng(raw.seed);
  const phrases = raw.phrases || {};
  ctx.t = (key, params) => String(phrases[key] ?? key).replace(/\\{(\\w+)\\}/g, (m, name) => params && params[name] !== undefined ? String(params[name]) : m);
  // Commit-reveal: the plugin keeps the value (hidden in its views) and publishes the hash; anyone can check the
  // revealed value against it later. The salt comes from the step's seed.
  ctx.commit = value => { const salt = ctx.rng ? ctx.rng().toString(36).slice(2) + ctx.rng().toString(36).slice(2) : ''; return { hash: __sha256(salt + ':' + JSON.stringify(value)), salt }; };
  ctx.verify = (value, salt, hash) => __sha256(salt + ':' + JSON.stringify(value)) === hash;
  // A plugin with its own published commitment format (Beast Chess: sha256 of salt|setup) hashes with this.
  ctx.sha256 = text => __sha256(String(text));
  delete ctx.seed; delete ctx.phrases;
  return ctx;
}
`;
const CALL = new vm.Script(`__out = (() => {
  const fn = __plugin[__fn];
  if (typeof fn !== 'function') return '{"__missing":true}';
  const input = JSON.parse(__in), result = fn(...input.args, makeContext(input.ctx));
  if (result && typeof result.then === 'function') throw new Error('PLUGIN_ASYNC_FORBIDDEN: plugin functions are synchronous');
  return JSON.stringify(result === undefined ? null : result);
})()`, { filename: 'plugin-call' });
const fail = (error, message) => Object.assign(new Error(message || error), { code: error });
function createSandbox({ source, filename = 'plugin.js', callMs = 200, maxOutputBytes = 4 * 1048576 }) {
  const context = vm.createContext({ __sha256: text => crypto.createHash('sha256').update(String(text)).digest('hex') }, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate', name: 'room-plugin:' + filename });
  try {
    vm.runInContext(PRELUDE, context, { filename: 'plugin-prelude', timeout: 1000 });
    vm.runInContext(`(function (module, exports) {\n${source}\n})(globalThis.module = { exports: {} }, globalThis.module.exports); globalThis.__plugin = globalThis.module.exports;`, context, { filename, timeout: 1000 });
  } catch (error) { throw fail('PLUGIN_LOAD_FAILED', `${filename}: ${error.message}`); }
  function call(name, args = [], ctx = undefined, { timeoutMs = callMs } = {}) {
    context.__fn = name; context.__in = JSON.stringify({ args, ctx });
    try { CALL.runInContext(context, { timeout: timeoutMs }); }
    catch (error) {
      if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw fail('PLUGIN_TIMEOUT', `${name} took longer than ${timeoutMs} ms`);
      throw fail('PLUGIN_ERROR', `${name}: ${String(error?.message || error).slice(0, 300)}`);
    } finally { context.__in = null; }
    const out = context.__out; context.__out = null;
    if (typeof out !== 'string') throw fail('PLUGIN_ERROR', `${name} returned nothing serializable`);
    if (out.length > maxOutputBytes) throw fail('PLUGIN_OUTPUT_TOO_LARGE', `${name} returned ${out.length} bytes`);
    const value = JSON.parse(out);
    if (value && value.__missing === true) throw fail('PLUGIN_FUNCTION_MISSING', `${name} is not defined`);
    return { value, bytes: out.length };
  }
  const has = name => { context.__fn = name; return vm.runInContext('typeof __plugin[__fn] === "function"', context, { timeout: 100 }); };
  return { call, has };
}
module.exports = { createSandbox };
