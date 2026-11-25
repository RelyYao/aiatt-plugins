#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Security scan for an export directory or a pull request.
//   node scan.mjs <dir> [--json] [--changed <git-ref>] [--files a b c] [--markers <file>] [--policy <allowlist.json>]
// Exits 1 when anything is found. --changed scans only the files that differ from <git-ref> (pull request mode).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanDirectory, loadMarkers } from './scan-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// The platform keeps its policy in allowlist.json (scan section); the public copy ships a policy.json beside the tool.
const defaultPolicy = [path.join(here, 'allowlist.json'), path.join(here, 'policy.json')].find(f => fs.existsSync(f)) || null;
export function policyFrom(file) {
  const raw = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const scan = raw.scan || raw;
  return { allow: scan.allow || [], allowEmails: (scan.allowEmails || []).map(source => new RegExp(source)), allowBinary: scan.allowBinary || [] };
}
export function format(result, { markersLoaded }) {
  const lines = [`scanned ${result.scanned} files, ${result.bytes} bytes; internal markers ${markersLoaded ? 'loaded' : 'not loaded (generic classes only)'}`];
  for (const f of result.findings) lines.push(`${f.class}  ${f.file}${f.line ? ':' + f.line : ''}  ${f.text}  (${f.message})`);
  if (result.allowed.length) lines.push(`${result.allowed.length} finding(s) allowed by policy`);
  lines.push(result.findings.length ? `FAIL: ${result.findings.length} finding(s) in ${result.classes.length} class(es): ${result.classes.join(', ')}` : 'PASS: no findings');
  return lines.join('\n');
}
function main(argv) {
  const args = argv.slice(), flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const value = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = flag('--json'), changed = value('--changed'), markersFile = value('--markers') || path.join(here, 'internal-markers.json'), policyFile = value('--policy');
  let files = null;
  const filesAt = args.indexOf('--files');
  if (filesAt >= 0) { files = args.slice(filesAt + 1); args.splice(filesAt); }
  const dir = path.resolve(args[0] || '.');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('usage: scan.mjs <dir> [--json] [--changed <git-ref>] [--files a b c] [--markers <file>] [--policy <file>]'); return 2; }
  if (changed) files = execFileSync('git', ['-C', dir, 'diff', '--name-only', '--diff-filter=ACMR', changed + '...HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const markers = fs.existsSync(markersFile) ? loadMarkers(markersFile) : null;
  const result = scanDirectory(dir, { markers, files, ...policyFrom(policyFile || defaultPolicy) });
  console.log(json ? JSON.stringify({ markersLoaded: !!markers, ...result }, null, 2) : format(result, { markersLoaded: !!markers }));
  return result.findings.length ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
