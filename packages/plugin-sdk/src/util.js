// SPDX-License-Identifier: Apache-2.0
'use strict';
// Small helpers shared by the SDK commands.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hashState = state => sha256(JSON.stringify(state ?? null)).slice(0, 12);
// mulberry32: the generator the SDK's own random play (fuzz, bots, preview) uses; not the plugin's ctx.rng.
function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const gzipSize = text => zlib.gzipSync(Buffer.from(text), { level: 9 }).length;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const errorText = error => error && error.code ? `${error.code}: ${String(error.message).replace(new RegExp('^' + error.code + ':\\s*'), '')}` : String(error?.message || error);
const IGNORED = new Set(['node_modules', 'dist', '.git']);
// Every file of a plugin directory (relative, forward slashes), without build output and dependencies.
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out); else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}
const kb = bytes => (bytes / 1024).toFixed(1) + ' KB';
module.exports = { sha256, hashState, seeded, pick, gzipSize, readJson, errorText, walk, kb };
