// SPDX-License-Identifier: Apache-2.0
'use strict';
// `test`: everything a plugin has to pass before it is submitted, in one report. Stages, in order (a failed check
// stops the rest, which could only repeat it): check, forbidden-API scan, size and dependencies, the conformance
// simulation (faults, stalls, leaks, replay; the platform's own lib/plugins/plugin-conformance.js), and fuzz.
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { check } = require('./runtime');
const { scanSource } = require('./scan');
const { fuzz } = require('./fuzz');
const { previewPrompts } = require('./prompts');
const { gzipSize, walk, kb, errorText } = require('./util');
const LIMITS = { bundleBytes: 512 * 1024, bundleWarnBytes: 128 * 1024, directoryBytes: 8 * 1024 * 1024 };
function sizeStage(dir, graph) {
  const built = graph.bundler.bundle(dir), bytes = Buffer.byteLength(built.source), gzip = gzipSize(built.source);
  const total = walk(dir).reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0), problems = [], warnings = [];
  if (bytes > LIMITS.bundleBytes) problems.push(`the server bundle is ${kb(bytes)}: the limit is ${kb(LIMITS.bundleBytes)}`);
  else if (bytes > LIMITS.bundleWarnBytes) warnings.push(`the server bundle is ${kb(bytes)}: large for a plugin (every call parses it)`);
  if (total > LIMITS.directoryBytes) problems.push(`the plugin directory is ${kb(total)}: the limit is ${kb(LIMITS.directoryBytes)}`);
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) {
    try { const dependencies = Object.keys(JSON.parse(fs.readFileSync(pkg, 'utf8')).dependencies || {}); if (dependencies.length) problems.push(`package.json lists dependencies (${dependencies.join(', ')}): a plugin has none, only plugin files and @aiatt/plugin-kit/* may be required`); }
    catch (error) { problems.push('package.json is not valid JSON'); }
  }
  return { bundleBytes: bytes, bundleGzipBytes: gzip, directoryBytes: total, files: built.files.length, problems, warnings };
}
function runTest(dir, { games = 30, seed = 1, fuzz: fuzzMatches = 2000, maxSteps, graph = loadHost() } = {}) {
  dir = path.resolve(dir);
  const report = { ok: false, dir, id: null, version: null, stages: [], problems: [], warnings: [] };
  const stage = (name, ok, summary, extra = {}) => { report.stages.push({ name, ok, summary, ...extra }); if (!ok) report.ok = false; };
  const checked = check(dir, { graph });
  report.id = checked.id; report.version = checked.version; report.warnings.push(...checked.warnings);
  stage('check', checked.ok, checked.ok ? `${checked.id}@${checked.version} (${checked.category}), ${checked.actions.length} actions, ${checked.files.length} files` : `${checked.problems.length} problems`, { problems: checked.problems });
  if (!checked.ok) { report.problems.push(...checked.problems.map(p => 'check: ' + p)); return report; }
  report.ok = true;
  try {
    const scan = scanSource(dir, checked.files);
    stage('scan', !scan.problems.length, scan.problems.length ? `${scan.problems.length} forbidden uses` : `${scan.requires.length} requires, none forbidden`, { problems: scan.problems });
    for (const p of scan.problems) report.problems.push(`scan: ${p.file}:${p.line} ${p.message} (${p.rule})`);
    for (const p of scan.warnings) report.warnings.push(`scan: ${p.file}:${p.line} ${p.message}`);
    const size = sizeStage(dir, graph);
    stage('size', !size.problems.length, `server bundle ${kb(size.bundleBytes)} (${kb(size.bundleGzipBytes)} gzip), plugin ${kb(size.directoryBytes)}`, { ...size });
    report.problems.push(...size.problems.map(p => 'size: ' + p)); report.warnings.push(...size.warnings);
    const steps = maxSteps || (checked.category === 'match' ? undefined : 80), options = { games, seed, ...(steps ? { maxSteps: steps } : {}) };
    let simulation;
    try { simulation = graph.conformance.simulate(checked.id, options); } catch (error) { simulation = null; report.problems.push('simulate: ' + errorText(error)); }
    if (simulation) {
      const counts = `${simulation.finished}/${simulation.games} matches finished, ${simulation.steps} steps; ${simulation.faults.length} faults, ${simulation.stalls.length} stalls, ${simulation.leaks.length} leaks, ${simulation.replayFailures.length} replay failures`;
      stage('simulate', simulation.ok, counts, { report: simulation });
      for (const [name, list] of [['fault', simulation.faults], ['stall', simulation.stalls], ['leak', simulation.leaks], ['replay', simulation.replayFailures]]) for (const item of list.slice(0, 5)) report.problems.push(`simulate: ${name} ${JSON.stringify(item)}`);
    } else stage('simulate', false, 'the simulation could not run');
    if (fuzzMatches > 0) {
      // Random play cannot be asked to finish a game a plugin without engine() never finished in its plain simulation; the
      // fuzz also finds it when the simulation finished only through a seat leaving, which random play never does. Matches
      // the engine plays in every seat must finish either way (fuzz.js).
      const known = !graph.host.hasFunction(checked.id, 'engine') && !(simulation && simulation.finished > 0);
      const fuzzed = fuzz(graph, checked.id, { matches: fuzzMatches, seed, lenient: known, ...(steps ? { maxSteps: steps } : {}) });
      const lenient = fuzzed.lenient;
      const open = fuzzed.matches - fuzzed.finished;
      stage('fuzz', fuzzed.ok, `${fuzzed.finished}/${fuzzed.matches} matches finished, ${fuzzed.steps} steps, ${fuzzed.faultCount} faults, ${fuzzed.unfinished.length + fuzzed.stalls.length} unfinished, ${fuzzed.invariantBreaks.length} invariant breaks`, { report: fuzzed });
      for (const [name, list] of [['fault', fuzzed.faults], ['engine match unfinished', fuzzed.engineUnfinished], ['unfinished', lenient ? [] : fuzzed.unfinished], ['stall', fuzzed.stalls], ['invariant', fuzzed.invariantBreaks], ['replay', fuzzed.replayFailures]]) for (const item of list.slice(0, 5)) report.problems.push(`fuzz: ${name} ${JSON.stringify(item)}`);
      if (lenient && open > 0) report.warnings.push(`fuzz: ${open} random matches did not finish (random play cannot finish this game)${fuzzed.engineMatches ? `; ${fuzzed.engineFinished}/${fuzzed.engineMatches} matches played by the engine in every seat finished` : '; the plugin has no engine() to show the game ends'}`);
    } else stage('fuzz', true, 'skipped (--fuzz 0)', { skipped: true });
    if (fs.existsSync(path.join(dir, 'agent', 'prompts.js'))) {
      let agent;
      try { agent = previewPrompts(dir, { seed, limit: 12, graph }); } catch (error) { agent = { problems: [errorText(error)], items: [], warnings: [] }; }
      stage('agent', !agent.problems.length, `agent/prompts.js: ${agent.items.length} decision points previewed`, { problems: agent.problems });
      for (const p of agent.problems) report.problems.push('agent: ' + p);
      report.warnings.push(...agent.warnings);
    }
  } finally { graph.host.unregister(checked.id); }
  report.ok = report.stages.every(s => s.ok) && !report.problems.length;
  return report;
}
module.exports = { runTest, LIMITS };
