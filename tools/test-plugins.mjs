// SPDX-License-Identifier: Apache-2.0
// Runs `aiatt-plugin test` on plugin directories: the ones named on the command line, the ones a pull request changed
// (--changed <git-ref>), or all of them. A change to the shared kit, the host or the SDK tests every plugin.
//   node tools/test-plugins.mjs [--changed <git-ref>] [plugin-id ...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--changed');
const base = at >= 0 ? args.splice(at, 2)[1] : null;
const all = fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(root, 'plugins', e.name, 'plugin.json'))).map(e => e.name).sort();
let ids = args;
if (base) {
  const changed = execFileSync('git', ['-C', root, 'diff', '--name-only', '--diff-filter=ACMR', base + '...HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const shared = changed.some(f => /^(?:plugins\/kit\/|sdk\/|packages\/)/.test(f));
  ids = shared ? all : [...new Set(changed.map(f => /^plugins\/([^/]+)\//.exec(f)?.[1]).filter(id => id && all.includes(id)))].sort();
} else if (!ids.length) ids = all;
if (!ids.length) { console.log('no plugin to test'); process.exit(0); }
let failed = 0;
for (const id of ids) {
  if (!all.includes(id)) { console.error(`not a plugin: plugins/${id}`); failed++; continue; }
  console.log(`\n== aiatt-plugin test plugins/${id}`);
  const run = spawnSync('npx', ['--no-install', 'aiatt-plugin', 'test', path.join('plugins', id)], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (run.status !== 0) failed++;
}
console.log(failed ? `\n${failed} plugin(s) failed` : `\n${ids.length} plugin(s) passed`);
process.exit(failed ? 1 : 0);
