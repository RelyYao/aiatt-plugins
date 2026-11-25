// SPDX-License-Identifier: Apache-2.0
'use strict';
// The forbidden-API scan: reads a plugin's server source (every file the bundle takes in, not the plugin kit's) and
// refuses what the sandbox would refuse at run time, so the author hears about it at once and with a line number:
// eval and Function(), process, require of anything but plugin files and the kit, network and file access, timers,
// Date and Math.random, async code, ES module syntax. Comments and string contents are not looked at, except where
// a rule is about the text of a string (require paths).
const fs = require('node:fs');
const path = require('node:path');
// Same-length copy of `src` with comments (and, with hideStrings, the inside of strings, template text and regular
// expression literals) blanked out; newlines stay, so offsets and line numbers still match the original.
function mask(src, hideStrings) {
  const n = src.length;
  let out = '', i = 0, last = '';
  const put = (ch, hide) => { out += hide && ch !== '\n' ? ' ' : ch; };
  const regexAllowed = () => last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new)$/.test(out.slice(-40).replace(/\s+$/, ''));
  function template() {
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { put(ch, hideStrings); if (i + 1 < n) put(src[i + 1], hideStrings); i += 2; continue; }
      if (ch === '`') { out += '`'; i++; return; }
      if (ch === '$' && src[i + 1] === '{') { out += '${'; i += 2; code(true); if (src[i] === '}') { out += '}'; i++; } continue; }
      put(ch, hideStrings); i++;
    }
  }
  function code(inExpression) {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { put(src[i], true); i++; } continue; }
      if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2), stop = end < 0 ? n : end + 2; for (; i < stop; i++) put(src[i], true); continue; }
      if (c === '"' || c === "'") {
        out += c; i++;
        while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { put(src[i], hideStrings); i++; if (i < n) { put(src[i], hideStrings); i++; } continue; } put(src[i], hideStrings); i++; }
        if (i < n && src[i] === c) { out += c; i++; }
        last = c; continue;
      }
      if (c === '`') { out += '`'; i++; template(); last = '`'; continue; }
      if (c === '/' && regexAllowed()) {
        out += '/'; i++;
        let inClass = false;
        while (i < n && src[i] !== '\n') { const ch = src[i]; if (ch === '\\') { put(ch, hideStrings); i++; if (i < n) { put(src[i], hideStrings); i++; } continue; } if (ch === '[') inClass = true; else if (ch === ']') inClass = false; else if (ch === '/' && !inClass) break; put(ch, hideStrings); i++; }
        if (src[i] === '/') { out += '/'; i++; }
        last = '/'; continue;
      }
      if (c === '{') depth++;
      if (c === '}') { if (inExpression && depth === 0) return; depth--; }
      out += c; i++;
      if (!/\s/.test(c)) last = c;
    }
  }
  code(false);
  return out;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const NOT_MEMBER = '(?<![.\\w$])', NOT_KEY = '(?!\\s*:)';
// [rule, pattern on the code with strings blanked, message]
const RULES = [
  ['eval', new RegExp(NOT_MEMBER + 'eval\\s*\\('), 'eval() is not available to plugins'],
  ['function-constructor', new RegExp(NOT_MEMBER + '(?:new\\s+)?Function\\s*\\('), 'Function() builds code from text, which the sandbox refuses'],
  ['process', new RegExp(NOT_MEMBER + 'process\\b' + NOT_KEY), '`process` does not exist in the sandbox'],
  ['global-object', new RegExp(NOT_MEMBER + '(?:globalThis|global)\\b' + NOT_KEY), 'the global object is not reachable from plugin code'],
  ['network', new RegExp(NOT_MEMBER + '(?:fetch\\s*\\(|XMLHttpRequest\\b|WebSocket\\b|EventSource\\b|navigator\\b)'), 'a plugin has no network access'],
  ['dynamic-import', new RegExp(NOT_MEMBER + 'import\\s*\\('), 'dynamic import() is not available'],
  ['import-meta', /\bimport\.meta\b/, 'import.meta is not available'],
  ['timers', new RegExp(NOT_MEMBER + '(?:setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame)\\b'), 'plugins have no timers: deadlines are decisions (deadlineSeconds) and timeout()'],
  ['date', new RegExp(NOT_MEMBER + 'Date\\b' + NOT_KEY), 'Date does not exist in the sandbox: use ctx.now'],
  ['math-random', /\bMath\s*\.\s*random\s*\(/, 'Math.random() is forbidden: use ctx.rng()'],
  ['math-random-reference', /\bMath\s*\.\s*random\b(?!\s*\()/, 'Math.random is referenced (fine as a default that is never used in the sandbox, but calling it throws): use ctx.rng()', 'warning'],
  ['async', new RegExp('\\basync\\s+[\\w$(]|' + NOT_MEMBER + '(?:await|Promise)\\b'), 'plugin functions are synchronous'],
  ['host-objects', new RegExp(NOT_MEMBER + '(?:WebAssembly|SharedArrayBuffer|Atomics|Buffer|TextEncoder|TextDecoder|structuredClone)\\b' + NOT_KEY), 'not available inside the sandbox'],
  ['es-module', /(?:^|\n)\s*(?:import\s+[\w{*"']|export\s+(?:default|const|let|var|function|class|async|\{|\*))/, 'plugin code is CommonJS (module.exports = definePlugin({...}))'],
];
const WITH_STRINGS = [
  ['constructor-escape', /\bconstructor\s*\.\s*constructor\b|\[\s*['"`]constructor['"`]\s*\]\s*\(|\bFunction\s*\.\s*prototype\s*\.\s*constructor/, 'reaching the Function constructor is refused by the sandbox'],
  ['node-module', /['"`]node:[a-z_/]+['"`]|['"`](?:fs|path|os|net|http|https|child_process|worker_threads|vm|crypto)['"`]/, 'Node modules are not available to a plugin'],
];
const REQUIRE = /(?<![.\w$])require\s*\(\s*(?:(['"])([^'"\\\n]*)\1)?/g;
// `files`: names as the bundle lists them (relative to the plugin; '@kit/…' for kit files, which are not scanned).
function scanSource(dir, files) {
  const problems = [], warnings = [], requires = [];
  for (const name of files) {
    if (name.startsWith('@kit/') || !name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8'), hidden = mask(text, true), visible = mask(text, false);
    for (const [rule, pattern, message, severity] of RULES) { const found = pattern.exec(hidden); if (found) (severity === 'warning' ? warnings : problems).push({ rule, file: name, line: lineOf(hidden, found.index + (found[0].startsWith('\n') ? 1 : 0)), message }); }
    for (const [rule, pattern, message] of WITH_STRINGS) { const found = pattern.exec(visible); if (found) problems.push({ rule, file: name, line: lineOf(visible, found.index), message }); }
    for (const match of hidden.matchAll(REQUIRE)) {
      const literal = visible.slice(match.index).match(/^require\s*\(\s*(['"])([^'"\\\n]*)\1/)?.[2];
      const line = lineOf(hidden, match.index);
      requires.push({ file: name, line, request: literal ?? null });
      if (literal === undefined) problems.push({ rule: 'require-computed', file: name, line, message: 'require() needs a literal path to a plugin file or @aiatt/plugin-kit/<name>' });
      else if (!/^(?:\.{1,2}\/|@aiatt\/plugin-kit\/)/.test(literal)) problems.push({ rule: 'dependency', file: name, line, message: `require(${JSON.stringify(literal)}): only plugin files and @aiatt/plugin-kit/* may be required` });
    }
  }
  return { problems, warnings, requires };
}
module.exports = { scanSource, mask };
