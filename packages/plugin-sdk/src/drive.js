// SPDX-License-Identifier: Apache-2.0
'use strict';
// Driving a match through the host from outside: a random legal move for a decision, and replaying one recorded log
// entry. Shared by the simulator (Bots), preview-prompts and replay.
const { pick } = require('./util');
// Tries random actions for `decision` until the host accepts one (a refused step changes nothing, so trying is free).
// Returns { ok, action, tries, last } where last is the host's last refusal.
function randomMove(graph, room, decision, rng, { now, system = true, tries = 40 } = {}) {
  const p = room.state.plugin, manifest = graph.host.manifestFor(p.id), ids = p.seats.map(s => s.id);
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const type = attempt === 1 || rng() < 0.85 ? decision.actions[0] : pick(rng, decision.actions);
    const action = { ...graph.conformance.sample(manifest.actions[type] || { type: 'object' }, rng, ids), type };
    const done = graph.host.act(room, decision.actor, action, { now, system });
    if (!done.code) return { ok: true, action, tries: attempt };
    last = done;
  }
  return { ok: false, tries, last };
}
// One entry of the action log ({ step, at, actor, action, system?, host? }), applied the way it was taken.
function applyEntry(graph, room, entry) {
  const type = String(entry?.action?.type);
  if (type === '$leave') return graph.host.leave(room, entry.action.seat, { now: entry.at });
  return graph.host.act(room, entry.actor, entry.action, { now: entry.at, ...(entry.system ? { system: true } : {}), ...(entry.host ? { host: true } : {}) });
}
module.exports = { randomMove, applyEntry };
