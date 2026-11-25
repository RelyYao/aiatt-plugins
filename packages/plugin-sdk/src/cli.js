// SPDX-License-Identifier: Apache-2.0
'use strict';
// The command line: aiatt-plugin <command> [dir] [options]. `run(argv, { io, signal })` returns the exit code (0 fine,
// 1 problems found, 2 wrong usage) and writes through io.out / io.err, so tests call it like a function.
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { check } = require('./runtime');
const { runTest } = require('./run-tests');
const { build } = require('./build');
const { scaffold, KINDS } = require('./scaffold');
const { createSimulator } = require('./simulator');
const { previewPrompts } = require('./prompts');
const { replayLog, readLog, pluginDirFor } = require('./replay');
const { submit } = require('./submit');
const { kb, errorText } = require('./util');
const VERSION = require('../package.json').version;
const BOOLEAN = new Set(['json', 'help', 'inspect', 'live', 'all', 'no-watch', 'version']);
const USAGE = `aiatt-plugin ${VERSION} - developer tools for AiATT room plugins (room-plugin@1)

  new <id> [--template match|activity] [--dir d] [--author a]   a plugin skeleton that passes test
  check [dir]                                                  manifest, bundle, sandbox load, required functions
  test [dir] [--games 30] [--seed 1] [--fuzz 2000] [--json]    check + simulation + fuzz + API scan + size
  build [dir] [--out file]                                     dist/server.js + dist/report.json
  dev [dir] [--port 5173]                                      local simulator in the browser
  preview-prompts [dir] [--limit 12] [--locale zh-CN] [--json] what an Agent is asked at each decision point
  replay <log.json> [--dir d] [--break-at N] [--inspect]       replay an exported action log
  submit [dir] [--repo url]                                    test + build + dist/submission/ (pushes nothing)
  live [dir]                                                   debug room (coming next)

dir defaults to the current directory.`;
function parse(argv) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (BOOLEAN.has(name)) options[name] = true;
    else { options[name] = inline !== undefined ? inline : argv[++i]; if (options[name] === undefined) throw Object.assign(new Error(`--${name} needs a value`), { usage: true }); }
  }
  return { positional, options };
}
const integer = (value, fallback, name) => { if (value === undefined) return fallback; const n = Number(value); if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error(`--${name} must be a whole number`), { usage: true }); return n; };
function printTest(report, io) {
  for (const stage of report.stages) {
    io.out(`${stage.ok ? 'ok  ' : 'FAIL'} ${stage.name}: ${stage.summary}`);
    for (const problem of (stage.problems || []).slice(0, 8)) io.out('       ' + (typeof problem === 'string' ? problem : `${problem.file}:${problem.line} ${problem.message}`));
  }
  const other = report.problems.filter(p => !p.startsWith('check: ') && !p.startsWith('scan: '));
  for (const problem of other) io.out('  - ' + problem);
  for (const warning of report.warnings) io.out('warn ' + warning);
  io.out(report.ok ? `\nall checks passed for ${report.id}@${report.version}` : `\n${report.problems.length} problems: fix them and run test again`);
}
const handlers = {
  async new({ positional, options, io }) {
    if (!positional[0]) throw Object.assign(new Error('usage: aiatt-plugin new <id> [--template match|activity]'), { usage: true });
    const made = scaffold(positional[0], { template: options.template || 'match', dir: options.dir, author: options.author, name: options.name });
    io.out(`created ${made.template} plugin "${made.id}" in ${made.dir}`);
    for (const file of made.files) io.out('  ' + file);
    io.out(`\nnext:\n  cd ${(r => r && !r.startsWith('..') ? r : made.dir)(path.relative(process.cwd(), made.dir))}\n  npx aiatt-plugin dev      # play it in the browser\n  npx aiatt-plugin test`);
    return 0;
  },
  async check({ positional, options, io }) {
    const report = check(positional[0] || '.');
    if (options.json) io.out(JSON.stringify(report, null, 2));
    else {
      io.out(report.ok ? `ok ${report.id}@${report.version} (${report.category}), ${report.actions.length} actions, ${report.files.length} files; optional functions: ${report.functions.join(', ') || 'none'}` : 'PROBLEMS');
      for (const problem of report.problems) io.out('  - ' + problem);
      for (const warning of report.warnings) io.out('warn ' + warning);
    }
    return report.ok ? 0 : 1;
  },
  async test({ positional, options, io }) {
    const report = runTest(positional[0] || '.', { games: integer(options.games, 30, 'games'), seed: integer(options.seed, 1, 'seed'), fuzz: integer(options.fuzz, 2000, 'fuzz'), ...(options['max-steps'] ? { maxSteps: integer(options['max-steps'], 0, 'max-steps') } : {}) });
    if (options.json) io.out(JSON.stringify(report, null, 2)); else printTest(report, io);
    return report.ok ? 0 : 1;
  },
  async build({ positional, options, io }) {
    const out = build(positional[0] || '.', { out: options.out });
    if (!out.ok) { for (const problem of out.problems) io.err('  - ' + problem); return 1; }
    if (options.json) io.out(JSON.stringify(out.report, null, 2));
    else io.out(`built ${out.file} (${kb(out.report.bundle.bytes)}, ${kb(out.report.bundle.gzipBytes)} gzip), sha256 ${out.report.bundle.sha256}\nreport ${out.reportFile}`);
    return 0;
  },
  async dev({ positional, options, io, signal }) {
    if (options.live) return handlers.live({ positional, options, io });
    const sim = await createSimulator({ dir: positional[0] || '.', port: integer(options.port, 5173, 'port'), watch: !options['no-watch'], log: text => io.out(text) });
    io.out(`simulator for ${sim.session.plugin ? sim.session.plugin.id : positional[0] || '.'}: ${sim.url}\nedit the code and save: the plugin reloads and the match is replayed on it. Ctrl+C stops.`);
    await new Promise(resolve => { if (signal) { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); } else { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); } });
    await sim.close();
    return 0;
  },
  async 'preview-prompts'({ positional, options, io }) {
    const out = previewPrompts(positional[0] || '.', { seed: integer(options.seed, 1, 'seed'), limit: integer(options.limit, 12, 'limit'), locale: options.locale || 'zh-CN' });
    if (options.json) io.out(JSON.stringify(out, null, 2));
    else {
      io.out(`${out.plugin}@${out.version}: ${out.template ? 'agent/prompts.js' : 'default prompts (no agent/prompts.js)'}, ${out.items.length} decision points`);
      for (const item of out.items) io.out(`\n--- step ${item.step}, ${item.actor}, ${item.actions.join(' / ')} (${item.source}) ---\n${item.instruction}\nexpected answer:\n${item.example}`);
      for (const problem of out.problems) io.out('PROBLEM ' + problem);
      for (const warning of out.warnings) io.out('warn ' + warning);
    }
    return out.problems.length ? 1 : 0;
  },
  async replay({ positional, options, io }) {
    if (!positional[0]) throw Object.assign(new Error('usage: aiatt-plugin replay <log.json> [--dir <plugin dir>]'), { usage: true });
    if (options.inspect && !require('node:inspector').url()) {
      const args = process.argv.slice(1).filter(a => a !== '--inspect');
      return require('node:child_process').spawnSync(process.execPath, ['--inspect-brk', ...args], { stdio: 'inherit' }).status ?? 1;
    }
    const log = readLog(positional[0]), dir = pluginDirFor(log, options.dir);
    const report = replayLog(log, dir, { breakAt: options['break-at'] === undefined ? null : integer(options['break-at'], 0, 'break-at'), onStep: row => { if (!options.json) io.out(row.error ? `step ${row.step}: REFUSED ${row.error}` : `step ${String(row.step).padStart(3)}  ${row.hash}  ${row.actor || '-'}  ${row.step ? JSON.stringify(row.action) : 'setup'}${row.result ? '  (finished)' : ''}`); } });
    if (options.json) io.out(JSON.stringify(report, null, 2));
    else { for (const problem of report.problems) io.out(problem.startsWith('note:') ? problem : 'PROBLEM ' + problem); io.out(`final state ${report.finalHash}${report.expectedHash ? (report.finalHash === report.expectedHash ? ' (same as the log)' : ' (the log says ' + report.expectedHash + ')') : ''}`); }
    return report.ok ? 0 : 1;
  },
  async submit({ positional, options, io }) {
    const out = submit(positional[0] || '.', { repo: options.repo, ...(options.games ? { games: integer(options.games, 30, 'games') } : {}), ...(options.seed ? { seed: integer(options.seed, 1, 'seed') } : {}), ...(options.fuzz ? { fuzz: integer(options.fuzz, 2000, 'fuzz') } : {}) });
    if (!out.ok) { if (out.test) printTest(out.test, io); for (const problem of out.problems || []) io.err('  - ' + problem); io.err('\nnothing was written: fix the problems first'); return 1; }
    io.out(`submission written to ${out.dir}\n  ${out.files.join('\n  ')}\n\nnothing was pushed. To open the pull request run, one by one:\n`);
    for (const line of out.commands) io.out('  ' + line);
    return 0;
  },
  async live({ io }) { io.out('debug room: coming next (P4b)'); return 0; },
};
async function run(argv, { io = { out: text => console.log(text), err: text => console.error(text) }, signal } = {}) {
  try {
    const [command, ...rest] = argv;
    if (!command || command === 'help' || command === '--help' || command === '-h') { io.out(USAGE); return command ? 0 : 2; }
    if (command === '--version' || command === 'version') { io.out(VERSION); return 0; }
    const name = command === 'preview-prompts' || handlers[command] ? command : null;
    if (!name) { io.err(`unknown command "${command}"\n\n${USAGE}`); return 2; }
    const { positional, options } = parse(rest);
    if (options.help) { io.out(USAGE); return 0; }
    return await handlers[name]({ positional, options, io, signal });
  } catch (error) {
    if (error.usage) { io.err(error.message); return 2; }
    io.err(errorText(error));
    return 1;
  }
}
module.exports = { run, parse, USAGE, KINDS };
