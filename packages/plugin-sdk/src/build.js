// SPDX-License-Identifier: Apache-2.0
'use strict';
// `build`: the one-file server bundle the sandbox runs, with its size and sha256, and dist/report.json next to it.
// Deterministic: the same files give the same bundle and the same hashes (no timestamps).
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { check } = require('./runtime');
const { sha256, gzipSize } = require('./util');
const SDK_VERSION = require('../package.json').version;
function build(dir, { out, graph = loadHost() } = {}) {
  dir = path.resolve(dir);
  const checked = check(dir, { graph });
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const built = graph.bundler.bundle(dir), file = path.resolve(out || path.join(dir, 'dist', 'server.js'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, built.source);
  const files = built.files.map(name => ({ name, sha256: sha256(name.startsWith('@kit/') ? fs.readFileSync(path.join(graph.dir, '..', '..', 'plugins', 'kit', name.slice(5)), 'utf8') : fs.readFileSync(path.join(dir, name), 'utf8')) }));
  const manifest = fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8');
  const report = { sdk: SDK_VERSION, plugin: { id: checked.id, version: checked.version, category: checked.category, actions: checked.actions, functions: checked.functions }, bundle: { file: path.basename(file), bytes: Buffer.byteLength(built.source), gzipBytes: gzipSize(built.source), sha256: sha256(built.source), files }, manifestSha256: sha256(manifest) };
  const reportFile = path.join(path.dirname(file), 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  return { ok: true, file, reportFile, report, warnings: checked.warnings };
}
module.exports = { build, SDK_VERSION };
