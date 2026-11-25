// SPDX-License-Identifier: Apache-2.0
'use strict';
// `replay <file>`: replays an exported action log (the simulator's "Download action log", or a log the platform's
// debug room exports later) step by step on the plugin's current code and prints the state hash after every step.
// The path from the command to the plugin is plain function calls (replayLog -> applyEntry -> host.act -> the
// plugin), so a Node debugger can step all the way in: run with `node --inspect-brk`, or pass --inspect, and
// --break-at N stops (a `debugger` statement) right before step N is applied.
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { loadPlugin } = require('./runtime');
const { applyEntry } = require('./drive');
const { hashState, readJson, errorText } = require('./util');
const FORMAT = 'aiatt-plugin-log@1';
function readLog(file) {
  const log = readJson(file);
  if (!log || typeof log !== 'object' || log.format !== FORMAT || !Array.isArray(log.actions) || !Array.isArray(log.seats) || typeof log.seed !== 'string' || typeof log.plugin !== 'string') throw Object.assign(new Error(`${file} is not an action log (format ${FORMAT}: plugin, version, config, seats, seed, actions)`), { code: 'LOG_INVALID' });
  return log;
}
function replayLog(log, dir, { graph = loadHost({ fresh: true }), breakAt = null, onStep = () => {} } = {}) {
  const plugin = loadPlugin(dir, graph), { host } = graph;
  const report = { ok: false, plugin: plugin.id, version: plugin.manifest.version, logVersion: log.version, steps: [], finalHash: null, expectedHash: log.finalHash ?? null, problems: [] };
  if (log.plugin !== plugin.id) { report.problems.push(`the log is for plugin "${log.plugin}", ${dir} is "${plugin.id}"`); return report; }
  if (log.version && log.version !== plugin.manifest.version) report.problems.push(`note: the log was recorded on version ${log.version}, the code is ${plugin.manifest.version}`);
  const room = { id: 'replay', state: {} };
  const started = host.start(room, plugin.id, { seats: log.seats, config: log.config || {}, seed: log.seed, now: log.startedAt ?? 0, match: 'replay' });
  if (started.code) { report.problems.push(`start failed: ${started.error} ${started.message}`); return report; }
  const first = { step: 0, actor: null, action: { type: '$setup' }, hash: hashState(room.state.plugin.state), events: 0 };
  report.steps.push(first); onStep(first);
  for (const entry of log.actions) {
    if (breakAt !== null && entry.step === breakAt) debugger;
    const done = applyEntry(graph, room, entry);
    if (done.code) { report.problems.push(`step ${entry.step} (${entry.actor} ${JSON.stringify(entry.action)}) was refused: ${done.error} ${done.message || ''}`.trim()); report.steps.push({ step: entry.step, actor: entry.actor, action: entry.action, error: done.error }); onStep(report.steps.at(-1)); break; }
    const row = { step: entry.step, actor: entry.actor, action: entry.action, hash: hashState(room.state.plugin.state), events: done.data.events.length, result: done.data.result?.done ? 'finished' : null };
    report.steps.push(row); onStep(row);
  }
  report.finalHash = hashState(room.state.plugin.state);
  if (report.expectedHash && report.finalHash !== report.expectedHash && !report.problems.some(p => p.includes('refused'))) report.problems.push(`the final state differs from the log (expected ${report.expectedHash}, got ${report.finalHash}): the code behaves differently now`);
  report.ok = !report.problems.some(p => !p.startsWith('note:'));
  host.unregister(plugin.id);
  return report;
}
// Where the plugin is, when the command did not say: --dir, else the current directory when it holds that plugin.
function pluginDirFor(log, dir) {
  const candidates = [dir, process.cwd()].filter(Boolean).map(d => path.resolve(d));
  for (const candidate of candidates) { try { if (readJson(path.join(candidate, 'plugin.json')).id === log.plugin) return candidate; } catch { /* not this one */ } }
  throw Object.assign(new Error(`cannot find the plugin "${log.plugin}": run this in its directory or pass --dir <plugin dir>`), { code: 'PLUGIN_DIR_MISSING' });
}
module.exports = { replayLog, readLog, pluginDirFor, FORMAT, errorText };
