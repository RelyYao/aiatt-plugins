// SPDX-License-Identifier: Apache-2.0
// Security scan for the open-source export: patterns that must never reach a public repository. Used by export.mjs
// (before anything is uploaded) and shipped to the public repository as tools/scan (CI on every pull request).
// Generic classes live here. Values specific to the platform (production hosts, personal identities, local paths)
// come from an optional internal-markers.json next to this file; the platform's copy has it, the public copy does not.
import fs from 'node:fs';
import path from 'node:path';

export const SPDX = 'SPDX-License-Identifier: Apache-2.0';
export const MAX_BYTES = 1024 * 1024;
const WINDOW = 4000, OVERLAP = 300;
const CODE_EXT = /\.(?:js|mjs|cjs|ts|css)$/i;
const REDACT = new Set(['private-key', 'jwt', 'token', 'secret-assignment', 'url-credentials']);
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|your[-_ ]|example|changeme|placeholder|process\.env|redacted|dummy|test-?key)/i;

const LINE_PATTERNS = [
  { cls: 'private-key', rx: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, message: 'private key block' },
  { cls: 'jwt', rx: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, message: 'JWT-like string' },
  { cls: 'token', rx: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, message: 'GitHub token' },
  { cls: 'token', rx: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, message: 'GitHub fine-grained token' },
  { cls: 'token', rx: /\bsk-[A-Za-z0-9_-]{16,}/g, message: 'sk- API key' },
  { cls: 'token', rx: /\bAKIA[0-9A-Z]{16}\b/g, message: 'AWS access key id' },
  { cls: 'token', rx: /\bxox[bap]-[A-Za-z0-9-]{10,}/g, message: 'Slack token' },
  { cls: 'url-credentials', rx: /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s\/@:'"`]{1,100}:[^\s\/@'"`]{1,200}@[^\s'"`]{1,200}/gi, message: 'URL with embedded credentials' },
  { cls: 'local-path', rx: /(?<![\w.])\/(?:home|Users)\/[A-Za-z0-9_.-]+/g, message: 'absolute local path' },
  { cls: 'local-path', rx: /(?<![\w])[A-Z]:\\{1,2}(?![nrtbfv'"])[A-Za-z][A-Za-z0-9_ .-]*/g, message: 'Windows absolute path' }
];
const SECRET_ASSIGNMENT = /\b(?:pass(?:word|wd)|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\w{0,40}["']?\s{0,4}[:=]\s{0,4}(["'`])([^"'`\s]{6,200})\1/gi;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,6}\.[A-Za-z]{2,}/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d]|\.\d)/g;
const DOC_RANGES = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
const NAME_RULES = [
  { cls: 'env-file', rx: /^\.env(?:\..+)?$/i, ok: /^\.env\.(?:example|sample|template)$/i, message: '.env file' },
  { cls: 'backup-name', rx: /(?:\.(?:bak|backup|orig|old|swp|swo|tmp|dump|sql|snapshot|sqlite3?|db|log)(?:[-._].*)?$|~$|(?:^|[-_.])(?:backup|dump|snapshot)(?:[-_.]|$))/i, message: 'file name looks like a backup, dump, snapshot or log' },
  { cls: 'secret-file-name', rx: /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|\.pgpass|\.OPS|credentials(?:\.json)?)$|\.(?:pem|key|p12|pfx|keystore|jks)$/i, message: 'file name looks like a key, credential or secret store' }
];
const VENDORED_SEGMENT = /^(?:node_modules|vendor|vendored|third[-_]party|bower_components)$/i;
const VENDORED_NAME = /(?:livekit|\.min\.(?:js|css|mjs)$|three(?:\.module|\.core)?\.(?:m?js)$)/i;
const LICENSE_FILES = /^(?:LICEN[CS]E|NOTICE|COPYING)(?:\.[a-z]+)?$/i;
const THIRD_PARTY = /@licen[s]e\b|\bCopyright\s+(?:\(c\)\s*)?\d{4}|\(c\)\s*\d{4}\s+\w/i;

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++; } else if (ch === '*') out += '[^/]*'; else out += escapeRegExp(ch);
  }
  return new RegExp('^' + out + '$');
}

// Markers of this platform: { hosts: [literal], hostPatterns: [regex source], identities: [word], paths: [literal] }.
export function loadMarkers(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = value => Array.isArray(value) ? value.filter(v => typeof v === 'string' && v) : [];
  return { hosts: list(raw.hosts), hostPatterns: list(raw.hostPatterns), identities: list(raw.identities), paths: list(raw.paths) };
}
function markerPatterns(markers) {
  if (!markers) return [];
  const out = [];
  for (const host of markers.hosts) out.push({ cls: 'production-host', rx: new RegExp(escapeRegExp(host), 'gi'), message: 'internal or production address' });
  for (const source of markers.hostPatterns) out.push({ cls: 'production-host', rx: new RegExp(source, 'gi'), message: 'internal or production address' });
  for (const word of markers.identities) out.push({ cls: 'identity', rx: new RegExp('(?<![A-Za-z0-9])' + escapeRegExp(word) + '(?![A-Za-z0-9])', 'gi'), message: 'git identity or personal name' });
  for (const p of markers.paths) out.push({ cls: 'local-path', rx: new RegExp(escapeRegExp(p), 'g'), message: 'absolute local path' });
  return out;
}

function redact(cls, text) {
  if (!REDACT.has(cls)) return text.length > 80 ? text.slice(0, 77) + '...' : text;
  return text.slice(0, 4) + '...[redacted ' + text.length + ' chars]';
}
function isPrivateOrPublicIp(text) {
  const parts = text.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (text === '127.0.0.1' || text === '0.0.0.0') return false;
  if (DOC_RANGES.some(rx => rx.test(text))) return false;
  return true;
}
function emailAllowed(address, allowEmails) { return allowEmails.some(rx => rx.test(address)); }
function binaryLike(buffer) { return buffer.subarray(0, 8000).includes(0); }

// One text, line by line. Returns findings { cls, line, text, message }.
export function scanText(text, { markers = null, allowEmails = [] } = {}) {
  const findings = [], patterns = LINE_PATTERNS.concat(markerPatterns(markers)), lines = [], origin = [];
  for (const [i, whole] of text.split(/\r?\n/).entries()) {
    if (whole.length <= WINDOW) { lines.push(whole); origin.push(i + 1); continue; }
    for (let at = 0; at < whole.length; at += WINDOW - OVERLAP) { lines.push(whole.slice(at, at + WINDOW)); origin.push(i + 1); }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], lineNo = origin[i];
    if (!line) continue;
    for (const { cls, rx, message } of patterns) {
      rx.lastIndex = 0;
      for (const m of line.matchAll(rx)) findings.push({ cls, line: lineNo, text: redact(cls, m[0]), message });
    }
    for (const m of line.matchAll(SECRET_ASSIGNMENT)) if (!PLACEHOLDER.test(m[2])) findings.push({ cls: 'secret-assignment', line: lineNo, text: redact('secret-assignment', m[0]), message: 'secret-looking assignment with a literal value' });
    for (const m of line.matchAll(EMAIL)) if (!emailAllowed(m[0], allowEmails)) findings.push({ cls: 'email', line: lineNo, text: m[0], message: 'e-mail address' });
    for (const m of line.matchAll(IPV4)) if (isPrivateOrPublicIp(m[0])) findings.push({ cls: 'ipv4', line: lineNo, text: m[0], message: 'IPv4 address' });
  }
  const seen = new Set();
  return findings.filter(f => { const key = f.cls + '\0' + f.line + '\0' + f.text; if (seen.has(key)) return false; seen.add(key); return true; });
}

function walk(dir, rel, out, symlinks) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const next = rel ? rel + '/' + entry.name : entry.name;
    if (entry.name === '.git' && entry.isDirectory()) continue;
    if (entry.isSymbolicLink()) { symlinks.push(next); continue; }
    if (entry.isDirectory()) walk(dir, next, out, symlinks); else if (entry.isFile()) out.push(next);
  }
}

// scanDirectory(dir, options): every file under dir (or only options.files, relative paths) is checked by name,
// size, content and license header. options: markers, allow [{ class, file (glob), match? }], allowEmails [RegExp],
// allowBinary [{ file (glob), extensions }], files [relative paths].
export function scanDirectory(dir, { markers = null, allow = [], allowEmails = [], allowBinary = [], files = null } = {}) {
  const findings = [], allowed = [], list = [], symlinks = [];
  const rules = allow.map(rule => ({ cls: rule.class, file: globToRegExp(rule.file), match: rule.match || null }));
  const binaryRules = allowBinary.map(rule => ({ file: globToRegExp(rule.file), extensions: new Set((rule.extensions || []).map(e => e.toLowerCase())) }));
  if (files) { for (const f of files) if (fs.existsSync(path.join(dir, f)) && fs.lstatSync(path.join(dir, f)).isFile()) list.push(f.split(path.sep).join('/')); } else walk(dir, '', list, symlinks);
  const add = (cls, file, line, text, message) => {
    const rule = rules.find(r => r.cls === cls && r.file.test(file) && (!r.match || text.includes(r.match)));
    (rule ? allowed : findings).push({ class: cls, file, line, text, message });
  };
  for (const s of symlinks) add('symlink', s, 0, s, 'symbolic link');
  const namePatterns = markerPatterns(markers).filter(p => p.cls === 'identity' || p.cls === 'local-path');
  let bytes = 0, scanned = 0;
  for (const file of list.sort()) {
    const base = file.split('/').pop(), segments = file.split('/');
    for (const rule of NAME_RULES) if (rule.rx.test(base) && !(rule.ok && rule.ok.test(base))) add(rule.cls, file, 0, base, rule.message);
    for (const p of namePatterns) { p.rx.lastIndex = 0; if (p.rx.test(file)) add(p.cls, file, 0, file, p.message + ' in a file name'); }
    if (segments.slice(0, -1).some(s => VENDORED_SEGMENT.test(s)) || VENDORED_NAME.test(base)) add('vendored', file, 0, base, 'vendored or third-party file (out of scope for this repository)');
    const buffer = fs.readFileSync(path.join(dir, file));
    bytes += buffer.length; scanned++;
    if (buffer.length > MAX_BYTES) add('large-file', file, 0, buffer.length + ' bytes', 'file is larger than 1 MB');
    if (buffer.length > MAX_BYTES) continue;
    if (binaryLike(buffer)) {
      const ext = path.extname(file).toLowerCase();
      if (!binaryRules.some(r => r.file.test(file) && r.extensions.has(ext))) add('binary-file', file, 0, ext || base, 'binary file');
      continue;
    }
    const text = buffer.toString('utf8');
    for (const f of scanText(text, { markers, allowEmails })) add(f.cls, file, f.line, f.text, f.message);
    if (CODE_EXT.test(base) && !LICENSE_FILES.test(base)) {
      const head = text.split(/\r?\n/).slice(0, 3).join('\n');
      if (!head.includes(SPDX)) add('license-header', file, 1, base, 'missing "' + SPDX + '" in the first lines');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) if (THIRD_PARTY.test(lines[i]) && !/AiATT|SPDX|plugin authors/i.test(lines[i])) add('third-party-license', file, i + 1, lines[i].trim().slice(0, 80), 'third-party copyright or license notice (vendored code is out of scope)');
    }
  }
  findings.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.class < b.class ? -1 : 1));
  return { findings, allowed, scanned, bytes, classes: [...new Set(findings.map(f => f.class))].sort() };
}
