// SPDX-License-Identifier: Apache-2.0
'use strict';
// `preview-prompts`: for the decision points of a simulated match, the question an Agent would get and the answer
// format that is expected. A plugin's own agent/prompts.js (one entry per action: instruction(view, decision, t) and an
// `answer` JSON Schema) is used where it has an entry; every other action gets the default the platform builds from
// the action schemas and the view. The template file is the author's own local code: it is loaded with require().
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { loadPlugin } = require('./runtime');
const { randomMove } = require('./drive');
const { seeded, pick, errorText } = require('./util');
const REASON = { type: 'string', maxLength: 80 };
const TEXT = {
  'zh-CN': { intro: (name, id, actor) => `你正在「${name}」(${id}) 里，坐在座位 ${actor}。`, view: '你现在能看到的局面（JSON）：', ask: '轮到你了，可以做这些动作：', reply: '只回答一个 JSON 对象，并在 reason 里用一句话说明理由。例如：', none: '（没有字段）' },
  'zh-TW': { intro: (name, id, actor) => `你正在「${name}」(${id}) 裡，坐在座位 ${actor}。`, view: '你現在能看到的局面（JSON）：', ask: '輪到你了，可以做這些動作：', reply: '只回答一個 JSON 物件，並在 reason 裡用一句話說明理由。例如：', none: '（沒有欄位）' },
  en: { intro: (name, id, actor) => `You are playing "${name}" (${id}) in seat ${actor}.`, view: 'What you can see now (JSON):', ask: 'It is your turn. You may do:', reply: 'Answer with one JSON object and give a one-sentence reason in "reason". For example:', none: '(no fields)' },
};
function describe(schema) {
  const parts = [];
  for (const [key, child] of Object.entries(schema.properties || {})) {
    const kind = child.enum ? 'one of ' + child.enum.map(v => JSON.stringify(v)).join(', ') : child.type === 'integer' || child.type === 'number' ? `${child.type}${child.minimum !== undefined || child.maximum !== undefined ? ` ${child.minimum ?? '..'}–${child.maximum ?? '..'}` : ''}` : child.type || 'any';
    parts.push(`${key}: ${kind}${(schema.required || []).includes(key) ? '' : ' (optional)'}`);
  }
  return parts.join('; ');
}
function answerSchema(name, schema) {
  return { type: 'object', properties: { type: { const: name }, ...(schema.properties || {}), reason: REASON }, required: ['type', ...(schema.required || []), 'reason'], additionalProperties: false };
}
function phraser(phrases) { return (key, params) => String(phrases[key] ?? key).replace(/\{(\w+)\}/g, (all, name) => params && params[name] !== undefined ? String(params[name]) : all); }
function loadTemplates(dir) {
  const file = path.join(dir, 'agent', 'prompts.js');
  if (!fs.existsSync(file)) return null;
  delete require.cache[require.resolve(file)];
  return require(file);
}
function defaultPrompt({ manifest, locale, actor, view, actions }) {
  const text = TEXT[locale] || TEXT.en, name = manifest.name[locale] || manifest.name.en;
  const lines = [text.intro(name, manifest.id, actor), text.view, JSON.stringify(view, null, 2), text.ask];
  for (const action of actions) lines.push(`- ${action}: ${describe(manifest.actions[action]) || text.none}`);
  return lines.join('\n');
}
function previewPrompts(dir, { seed = 1, limit = 12, locale = 'zh-CN', graph = loadHost() } = {}) {
  dir = path.resolve(dir);
  const plugin = loadPlugin(dir, graph), { manifest, phrases } = plugin, { host, conformance, schema } = graph;
  const result = { plugin: manifest.id, version: manifest.version, locale, template: false, items: [], problems: [], warnings: [] };
  let templates = null;
  try { templates = loadTemplates(dir); } catch (error) { result.problems.push('agent/prompts.js could not be loaded: ' + errorText(error)); }
  result.template = !!templates;
  const t = phraser(phrases[locale] || phrases.en || {});
  if (templates) {
    for (const [action, entry] of Object.entries(templates)) {
      if (!manifest.actions[action]) result.problems.push(`agent/prompts.js has an entry for "${action}", which plugin.json does not list`);
      else if (typeof entry?.instruction !== 'function') result.problems.push(`agent/prompts.js: "${action}" needs an instruction(view, decision, t) function`);
      else if (!entry.answer) result.problems.push(`agent/prompts.js: "${action}" needs an answer schema`);
      else {
        const found = schema.schemaProblems(entry.answer, `agent/prompts.js ${action}.answer`);
        result.problems.push(...found);
        if (!found.length) {
          if (!entry.answer.properties?.reason) result.warnings.push(`agent/prompts.js: "${action}" asks for no reason: the platform wants a one-sentence reason with every decision`);
          const sampled = conformance.sample(entry.answer, seeded(seed), ['seat0', 'seat1']), { reason, ...fields } = sampled && typeof sampled === 'object' ? sampled : {};
          const mismatch = schema.validate(manifest.actions[action], fields);
          if (mismatch.length) result.problems.push(`agent/prompts.js: an answer shaped like "${action}".answer does not fit the action's schema (${mismatch.slice(0, 2).join('; ')})`);
        }
      }
    }
  }
  const rng = seeded(seed * 7919 + 1), count = manifest.seats.min + Math.floor(rng() * (manifest.seats.max - manifest.seats.min + 1));
  const seats = Array.from({ length: Math.max(count, manifest.category === 'match' ? 1 : 0) }, (_, i) => ({ id: `seat${i}`, kind: 'human', name: `Seat ${i}`, ...(i === 0 ? { owner: true } : {}) }));
  const room = { id: 'preview', state: {} };
  let now = 1_000_000;
  const started = host.start(room, manifest.id, { seats, now, seed: `preview-${seed}`.padEnd(32, '0').slice(0, 32) });
  if (started.code) { result.problems.push(`the match could not start: ${started.error} ${started.message}`); return result; }
  const seen = new Set();
  for (let step = 0; step < 400 && result.items.length < limit; step++) {
    const p = room.state.plugin;
    if (p.result?.done || !p.decisions.length) break;
    for (const decision of p.decisions) {
      const viewed = host.view(room, decision.actor);
      if (viewed.code) { result.problems.push(`view() failed for ${decision.actor}: ${viewed.error}`); continue; }
      const view = viewed.data.view, plain = decision.actions.filter(a => !templates?.[a]?.instruction || result.problems.some(x => x.includes(`"${a}"`)));
      const emit = item => { const key = item.actor + '|' + item.actions.join(',') + '|' + item.instruction; if (!seen.has(key) && result.items.length < limit) { seen.add(key); result.items.push({ step: p.step, ...item }); } };
      for (const action of decision.actions.filter(a => !plain.includes(a))) {
        let instruction;
        try { instruction = templates[action].instruction(JSON.parse(JSON.stringify(view)), { actor: decision.actor, actions: [...decision.actions], deadlineAt: decision.deadlineAt }, t); }
        catch (error) { result.problems.push(`agent/prompts.js: "${action}".instruction threw: ${errorText(error)}`); continue; }
        if (typeof instruction !== 'string' || !instruction.trim()) { result.problems.push(`agent/prompts.js: "${action}".instruction must return text`); continue; }
        const answer = templates[action].answer;
        emit({ actor: decision.actor, actions: [action], source: 'template', instruction, answer, example: example(conformance, answer, seeded(seed + step), seats, null) });
      }
      if (plain.length) {
        const answers = Object.fromEntries(plain.map(a => [a, answerSchema(a, manifest.actions[a])]));
        emit({ actor: decision.actor, actions: plain, source: 'default', instruction: defaultPrompt({ manifest, locale, actor: decision.actor, view, actions: plain }), answer: answers, example: plain.map(a => example(conformance, answers[a], seeded(seed + step), seats, a)).join('\n') });
      }
    }
    now += 1000;
    const decision = pick(rng, p.decisions.filter(d => d.deadlineAt !== null).length ? p.decisions.filter(d => d.deadlineAt !== null) : p.decisions);
    if (!randomMove(graph, room, decision, rng, { now }).ok) break;
  }
  host.unregister(manifest.id);
  result.ok = !result.problems.length;
  return result;
}
function example(conformance, schema, rng, seats, type) {
  const value = conformance.sample(schema, rng, seats.map(s => s.id));
  return JSON.stringify(value && typeof value === 'object' ? { ...(type ? { type } : {}), ...value, ...(schema.properties?.reason ? { reason: '...' } : {}) } : value);
}
module.exports = { previewPrompts, defaultPrompt, answerSchema };
