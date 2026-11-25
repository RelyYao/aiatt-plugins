// SPDX-License-Identifier: Apache-2.0
'use strict';
// An in-memory stand-in for the platform store, with exactly the functions the room plugin host calls
// (lib/plugins/plugin-host.js): save(), afterCommit(), archive() and archived(). The SDK runs the real host against
// it, so a plugin author needs no database, account or platform checkout. Nothing is ever written to disk.
// archive/archived follow the platform's shapes: rows { id, at, room, subjects, value }, newest first, `before`
// is the [at, id] of the last row of the previous page.
const LEDGER_NAME = /^[a-zA-Z][\w.-]{0,63}$/;
function createStore() {
const ledgers = new Map();
function save() {}
function afterCommit(fn) { fn(); }
function archive(ledger, rows, { replace = false, erase = false } = {}) {
  if (!LEDGER_NAME.test(ledger)) throw new Error('BAD_LEDGER');
  let count = 0;
  const bucket = ledgers.get(ledger) || new Map();
  for (const row of rows) {
    const id = String(row?.id ?? ''), at = Number(row?.at);
    if (!id || id.length > 200 || !Number.isFinite(at) || JSON.stringify(row?.value) === undefined) throw new Error('BAD_ARCHIVE_ROW');
    if (erase) { bucket.delete(id); count++; continue; }
    if (bucket.has(id) && !replace) continue;
    bucket.set(id, { ledger, id, at: Math.floor(at), room: typeof row.room === 'string' && row.room ? row.room : null, subjects: Array.isArray(row.subjects) ? row.subjects.filter(v => typeof v === 'string') : [], payload: JSON.stringify(row.value) });
    count++;
  }
  ledgers.set(ledger, bucket);
  return count;
}
function archived(query = {}) {
  const limit = Math.max(1, Math.min(1000, Number(query.limit) || 50)), out = [];
  for (const [name, bucket] of ledgers) {
    if (query.ledger && query.ledger !== name) continue;
    for (const row of bucket.values()) {
      if (query.room && row.room !== query.room) continue;
      if (query.subject && !row.subjects.includes(query.subject)) continue;
      if (query.id && row.id !== query.id) continue;
      if (query.from != null && row.at < query.from) continue;
      if (query.to != null && row.at >= query.to) continue;
      if (query.before && !(row.at < query.before[0] || (row.at === query.before[0] && row.id < query.before[1]))) continue;
      out.push({ ledger: row.ledger, id: row.id, at: row.at, room: row.room, subjects: row.subjects, archivedAt: null, value: JSON.parse(row.payload) });
    }
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, limit);
}
// Forget everything (between runs; the host keeps nothing else outside the room objects it is given).
function reset() { ledgers.clear(); }
return { save, afterCommit, archive, archived, reset };
}
module.exports = { ...createStore(), createStore };
