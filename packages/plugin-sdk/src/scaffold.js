// SPDX-License-Identifier: Apache-2.0
'use strict';
// `new <id> [--template match|activity]`: writes a plugin skeleton that passes `test` as it is.
const fs = require('node:fs');
const path = require('node:path');
const TEMPLATES = path.join(__dirname, '..', 'templates');
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const KINDS = ['match', 'activity'];
const titleOf = id => id.split('-').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
function copyTree(from, to, replace) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name), target = path.join(to, entry.name === 'gitignore.template' ? '.gitignore' : entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copyTree(source, target, replace); continue; }
    fs.writeFileSync(target, fs.readFileSync(source, 'utf8').replace(/__(ID|NAME|AUTHOR)__/g, (all, key) => replace[key]));
  }
}
function scaffold(id, { template = 'match', dir, author = 'Your Name', name } = {}) {
  if (!ID.test(id || '')) throw Object.assign(new Error('the id must be 2–40 lowercase letters, digits or hyphens, starting with a letter'), { code: 'PLUGIN_ID_INVALID' });
  if (!KINDS.includes(template)) throw Object.assign(new Error('--template must be ' + KINDS.join(' or ')), { code: 'PLUGIN_TEMPLATE_UNKNOWN' });
  // At the root of the community repository (or the platform's), plugins live in plugins/<id>: put the new one there.
  const root = !dir && fs.existsSync(path.resolve('plugins')) && fs.statSync(path.resolve('plugins')).isDirectory();
  const target = path.resolve(dir || (root ? path.join('plugins', id) : id));
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw Object.assign(new Error(`${target} exists and is not empty`), { code: 'PLUGIN_DIR_EXISTS' });
  fs.mkdirSync(target, { recursive: true });
  copyTree(path.join(TEMPLATES, template), target, { ID: id, NAME: name || titleOf(id), AUTHOR: author });
  return { dir: target, id, template, files: listFiles(target) };
}
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) listFiles(full, base, out); else out.push(path.relative(base, full).split(path.sep).join('/')); }
  return out.sort();
}
module.exports = { scaffold, TEMPLATES, ID, KINDS };
