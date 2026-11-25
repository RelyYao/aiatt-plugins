// SPDX-License-Identifier: Apache-2.0
'use strict';
// The simulator's page: one self-contained HTML string, no dependencies. Everything that comes from the plugin or the
// match (names, views, errors) is put on the page with textContent, never as markup; the client script uses no
// template literals so it can live inside this string.
const CLIENT = `
var state = null, viewAs = null, busy = false, lastRev = null, pendingFill = null;
function h(tag, props) {
  var el = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
  Object.keys(props || {}).forEach(function (k) {
    if (k === 'text') el.textContent = props[k];
    else if (k === 'class') el.className = props[k];
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), props[k]);
    else if (props[k] !== null && props[k] !== undefined && props[k] !== false) el.setAttribute(k, props[k] === true ? '' : String(props[k]));
  });
  kids.forEach(function (kid) { if (kid === null || kid === undefined || kid === false) return; el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
  return el;
}
function api(path, body) {
  var init = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  return fetch(path, init).then(function (r) { return r.json(); });
}
function refresh() {
  return api('/api/state?as=' + encodeURIComponent(viewAs || '')).then(function (s) { state = s; lastRev = s.revision + ':' + (s.reload ? s.reload.at : 0); render(); });
}
function op(path, body) { return api(path, body || {}).then(function (r) { return refresh().then(function () { return r; }); }); }
function pretty(v) { return JSON.stringify(v, null, 2); }
function short(v) { var t = JSON.stringify(v); return t === undefined ? '' : t.length > 90 ? t.slice(0, 87) + '...' : t; }
function fieldFor(name, schema, required) {
  var input, read;
  if (schema.enum) {
    input = h('select', { name: name }, h('option', { value: '', text: required ? '' : '(none)' }));
    schema.enum.forEach(function (v) { input.appendChild(h('option', { value: JSON.stringify(v), text: String(v) })); });
    read = function () { return input.value === '' ? undefined : JSON.parse(input.value); };
  } else if (schema.type === 'boolean') {
    input = h('input', { type: 'checkbox', name: name });
    read = function () { return input.checked; };
  } else if (schema.type === 'integer' || schema.type === 'number') {
    input = h('input', { type: 'number', name: name, min: schema.minimum, max: schema.maximum, step: schema.type === 'integer' ? 1 : 'any' });
    read = function () { return input.value === '' ? undefined : Number(input.value); };
  } else if (schema.type === 'string' || schema.type === undefined) {
    input = h('input', { type: 'text', name: name, maxlength: schema.maxLength });
    read = function () { return input.value === '' ? undefined : input.value; };
  } else {
    input = h('textarea', { name: name, rows: 2, placeholder: schema.type });
    read = function () { return input.value.trim() === '' ? undefined : JSON.parse(input.value); };
  }
  return { input: input, read: read, label: h('label', {}, h('span', { text: name + (required ? ' *' : '') }), input) };
}
function actionForm(type, schema, actor) {
  var props = schema.properties || {}, required = schema.required || [], fields = {}, out = h('div', { class: 'msg' });
  var form = h('form', { class: 'action', 'data-action': type });
  form.appendChild(h('strong', { text: type }));
  Object.keys(props).forEach(function (k) { var f = fieldFor(k, props[k], required.indexOf(k) >= 0); fields[k] = f; form.appendChild(f.label); });
  form.appendChild(h('button', { type: 'submit', text: 'Do it' }));
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = { type: type };
    try { Object.keys(fields).forEach(function (k) { var v = fields[k].read(); if (v !== undefined) input[k] = v; }); } catch (err) { alert('Bad value: ' + err.message); return; }
    op('/api/act', { actor: actor, input: input });
  });
  form.fields = fields;
  return form;
}
function boardOf(view) {
  var b = view && view.board;
  if (!Array.isArray(b) || !b.length) return null;
  var rows;
  if (Array.isArray(b[0])) rows = b;
  else { var n = Math.round(Math.sqrt(b.length)); rows = n * n === b.length && n > 1 ? Array.from({ length: n }, function (_, r) { return b.slice(r * n, r * n + n); }) : [b]; }
  var cols = rows[0].length;
  var table = h('table', { class: 'board' });
  rows.forEach(function (row, r) {
    var tr = h('tr');
    row.forEach(function (cell, c) {
      var text = cell === null || cell === undefined ? '' : typeof cell === 'object' ? short(cell) : String(cell);
      tr.appendChild(h('td', { text: text, title: 'row ' + r + ', col ' + c, onclick: function () { fillFromBoard(r, c, r * cols + c); } }));
    });
    table.appendChild(tr);
  });
  return table;
}
function fillFromBoard(r, c, index) {
  var forms = Array.prototype.slice.call(document.querySelectorAll('form.action')), touched = [];
  forms.forEach(function (form) {
    var filled = 0, names = Object.keys(form.fields);
    names.forEach(function (k) {
      var f = form.fields[k], value = null;
      if (['cell', 'index', 'pos', 'position', 'square'].indexOf(k) >= 0) value = index;
      else if (['x', 'col', 'column', 'c'].indexOf(k) >= 0) value = c;
      else if (['y', 'row', 'r'].indexOf(k) >= 0) value = r;
      if (value !== null) { f.input.value = value; filled++; }
    });
    if (filled && filled === names.length) touched.push(form);
  });
  if (touched.length === 1) touched[0].requestSubmit();
}
function handOf(view) {
  var hand = view && view.hand;
  if (!Array.isArray(hand)) return null;
  var box = h('div', { class: 'hand' });
  hand.forEach(function (card) { box.appendChild(h('span', { class: 'chip', text: typeof card === 'object' ? short(card) : String(card) })); });
  return box;
}
function card(title) { var kids = Array.prototype.slice.call(arguments, 1); return h.apply(null, ['section', { class: 'card' }, h('h2', { text: title })].concat(kids)); }
function render() {
  var root = document.getElementById('app');
  root.textContent = '';
  var p = state.plugin;
  document.title = p ? p.id + ' - AiATT plugin simulator' : 'AiATT plugin simulator';
  var head = h('header', {}, h('h1', { text: p ? p.id + '@' + p.version : 'plugin not loaded' }), p ? h('span', { class: 'chip', text: p.category }) : null,
    p ? h('span', { class: 'chip', text: p.engine ? 'engine() Bots' : 'random Bots' }) : null,
    h('span', { class: 'muted', text: 'file changes reload the plugin and replay the match on the new code' }));
  root.appendChild(head);
  if (state.error) root.appendChild(h('div', { class: 'err', text: state.error }));
  if (state.reload) {
    var r = state.reload, text = r.error ? 'reload failed, the previous code is still running: ' + r.error : 'reloaded: ' + r.kept + ' steps replayed' + (r.dropped ? ', ' + r.dropped + ' dropped' : '') + (r.stopped ? ' (step ' + r.stopped.step + ' no longer applies: ' + r.stopped.error + ')' : '');
    root.appendChild(h('div', { class: r.error || r.dropped ? 'warn' : 'ok', text: text }));
  }
  state.notes.forEach(function (n) { root.appendChild(h('div', { class: 'warn', text: n })); });
  if (!p) return;
  var grid = h('div', { class: 'grid' }), left = h('div'), right = h('div');
  // setup
  var seatsSel = h('select', { id: 'seats' }), meSel = h('select', { id: 'me' });
  for (var n = p.seats.min; n <= p.seats.max; n++) seatsSel.appendChild(h('option', { value: n, text: n + ' seats' }));
  var cur = state.setup || { seats: p.seats.min, me: 'seat0', config: {}, seed: '' };
  seatsSel.value = cur.seats;
  function fillMe() { meSel.textContent = ''; for (var i = 0; i < Number(seatsSel.value); i++) meSel.appendChild(h('option', { value: 'seat' + i, text: 'I sit at seat' + i })); meSel.value = cur.me; if (!meSel.value) meSel.value = 'seat0'; }
  seatsSel.addEventListener('change', fillMe); fillMe();
  var seed = h('input', { id: 'seed', type: 'text', placeholder: 'seed (empty = random)', value: state.match ? state.match.seed : '' });
  var cfg = h('textarea', { id: 'cfg', rows: 2 }); cfg.value = JSON.stringify(cur.config || {});
  var setupCard = card('Match', h('div', { class: 'row' }, seatsSel, meSel), seed, h('label', {}, h('span', { text: 'options (JSON)' }), cfg),
    h('div', { class: 'row' }, h('button', { text: 'New match', onclick: function () {
      var config; try { config = JSON.parse(cfg.value || '{}'); } catch (e) { alert('options are not valid JSON'); return; }
      op('/api/start', { seats: Number(seatsSel.value), me: meSel.value, config: config, seed: seed.value || undefined });
    } }), h('a', { href: '/api/log', download: 'match-log.json', class: 'button', text: 'Download action log' })));
  left.appendChild(setupCard);
  var m = state.match;
  if (!m) { left.appendChild(card('No match', h('p', { text: 'Start one above.' }))); grid.appendChild(left); root.appendChild(grid); return; }
  // view
  var asSel = h('select', { onchange: function (e) { viewAs = e.target.value; refresh(); } });
  m.seats.forEach(function (s) { asSel.appendChild(h('option', { value: s.id, text: 'view as ' + s.id + (s.kind === 'bot' ? ' (Bot)' : '') })); });
  asSel.appendChild(h('option', { value: 'spectator', text: 'view as spectator' })); asSel.value = m.as;
  var board = boardOf(m.view), hand = handOf(m.view);
  var res = m.result && m.result.done ? h('div', { class: 'ok', text: 'Finished: ' + JSON.stringify(m.result.ranking) + (m.result.summary ? ' - ' + m.result.summary : '') }) : null;
  left.appendChild(card('Step ' + m.step, h('div', { class: 'row' }, asSel, h('span', { class: 'muted', text: 'state ' + m.stateBytes + ' B, hash ' + m.stateHash })), res, board, hand,
    h('details', { open: true }, h('summary', { text: 'view(state, ' + JSON.stringify(m.as === 'spectator' ? null : m.as) + ')' }), h('pre', { text: pretty(m.view) })),
    h('details', {}, h('summary', { text: 'open decisions' }), h('pre', { text: pretty(m.decisions) }))));
  // actions
  var actCard = card('Act'), actor = m.as === 'spectator' ? null : m.as;
  if (actor && m.open.length) m.open.forEach(function (type) { actCard.appendChild(actionForm(type, p.actions[type], actor)); });
  else actCard.appendChild(h('p', { class: 'muted', text: actor ? actor + ' has nothing to do right now.' : 'Pick a seat in the view selector to act as it.' }));
  var typeSel = h('select', { id: 'anytype' }), who = h('select', { id: 'anywho' }), raw = h('textarea', { id: 'anyraw', rows: 2 });
  Object.keys(p.actions).forEach(function (t) { typeSel.appendChild(h('option', { value: t, text: t })); });
  m.seats.forEach(function (s) { who.appendChild(h('option', { value: s.id, text: s.id })); });
  who.value = actor || (state.setup ? state.setup.me : 'seat0'); raw.value = '{}';
  actCard.appendChild(h('details', {}, h('summary', { text: 'any action as any seat (also the ones that should be refused)' }), h('div', { class: 'row' }, who, typeSel), raw,
    h('button', { text: 'Send', onclick: function () { var body; try { body = JSON.parse(raw.value || '{}'); } catch (e) { alert('not valid JSON'); return; } body.type = typeSel.value; op('/api/act', { actor: who.value, input: body }); } })));
  actCard.appendChild(h('div', { class: 'row' }, h('button', { text: 'Advance clock to next deadline', onclick: function () { op('/api/advance'); } }), h('button', { text: 'Let Bots move', onclick: function () { op('/api/bots'); } })));
  var last = state.last;
  if (last) actCard.appendChild(h('div', { class: last.ok ? 'ok' : 'err', text: last.ok ? (last.timeouts ? 'timeouts: ' + short(last.timeouts) : 'step ' + last.step + (last.events && last.events.length ? ', events ' + short(last.events) : '')) : 'refused: ' + last.error + (last.message ? ' - ' + last.message : '') + (last.problems ? ' ' + short(last.problems) : '') }));
  right.appendChild(actCard);
  // timeline
  var list = h('ol', { class: 'timeline', start: 0 });
  list.appendChild(h('li', { class: m.step === 0 ? 'cur' : '' }, h('span', { text: 'start, seed ' + m.seed.slice(0, 8) }), h('button', { text: 'rewind', onclick: function () { op('/api/rewind', { step: 0 }); } })));
  state.history.forEach(function (e) {
    var body = h('details', {}, h('summary', { text: (e.system ? '[auto] ' : '') + (e.actor || 'platform') + ' ' + short(e.action) }), h('pre', { text: pretty({ step: e.step, at: e.at, rngSeed: e.seed, events: e.events }) }));
    list.appendChild(h('li', { class: e.step === m.step ? 'cur' : '' }, body, h('button', { text: 'rewind', onclick: function () { op('/api/rewind', { step: e.step }); } })));
  });
  right.appendChild(card('Steps (time travel)', h('p', { class: 'muted', text: 'Rewind restarts from the seed and replays the recorded actions up to that step. Edit the code, save: the whole log is replayed on the new code.' }), list));
  grid.appendChild(left); grid.appendChild(right); root.appendChild(grid);
}
function poll() { api('/api/rev').then(function (r) { var key = r.revision + ':' + r.reloadAt; if (lastRev !== null && key !== lastRev && !busy) { busy = true; refresh().then(function () { busy = false; }); } }).catch(function () {}); }
refresh().then(function () { setInterval(poll, 1000); });
`;
const CSS = `
:root{--bg:#f6f7f9;--fg:#1c2230;--card:#fff;--line:#d9dde6;--muted:#6b7385;--accent:#2f6fed;--ok:#1b7f4c;--warn:#a15c00;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--fg:#e6e9f0;--card:#1b202b;--line:#2d3443;--muted:#97a0b3;--accent:#6c9cff;--ok:#5fd09a;--warn:#f0b35a;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
#app{max-width:1200px;margin:0 auto;padding:16px}header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:0 0 8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}.muted{color:var(--muted)}
.chip{display:inline-block;padding:1px 8px;border:1px solid var(--line);border-radius:10px;margin:2px;font-size:12px}
button,.button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer;text-decoration:none}
input,select,textarea{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 6px}textarea{width:100%;font-family:ui-monospace,monospace}
label{display:flex;gap:8px;align-items:center;margin:4px 0}label span{min-width:70px;color:var(--muted)}form.action{border-top:1px solid var(--line);padding:8px 0}
.ok,.warn,.err{border-radius:6px;padding:6px 10px;margin:6px 0;border:1px solid}.ok{color:var(--ok)}.warn{color:var(--warn)}.err{color:var(--err)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;overflow:auto;max-height:340px;font-size:12px}
table.board{border-collapse:collapse;margin:8px 0}table.board td{border:1px solid var(--line);min-width:36px;height:36px;text-align:center;cursor:pointer;padding:2px 4px}table.board td:hover{background:var(--bg)}
.timeline{padding-left:28px;margin:0}.timeline li{margin:3px 0}.timeline li.cur>details summary{font-weight:700}.timeline li button{margin-left:8px;padding:1px 8px;font-size:12px}
`;
function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AiATT plugin simulator</title><style>${CSS}</style></head><body><div id="app"><p>Loading...</p></div><script>${CLIENT}</script></body></html>`;
}
module.exports = { page };
