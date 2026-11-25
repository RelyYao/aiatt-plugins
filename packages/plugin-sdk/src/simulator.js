// SPDX-License-Identifier: Apache-2.0
'use strict';
// `dev`: the local simulator. A tiny HTTP server (Node only, no dependencies) bound to 127.0.0.1: a web page where
// the author sits at one seat with random (or engine()) Bots on the others, sees the plugin's view, acts through forms
// built from the manifest, and travels back in time. The JSON API behind the page is also what the tests use:
//   GET  /api/state?as=<seat|spectator>   everything the page shows
//   POST /api/start { seats, me, config, seed }      POST /api/act { actor, input }
//   POST /api/advance                                 POST /api/bots              POST /api/rewind { step }
//   POST /api/reload                                  GET  /api/log (the action log, for `replay`)   GET /api/rev
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { Session } = require('./session');
const { page } = require('./simulator-page');
const BODY_LIMIT = 1024 * 1024, IGNORED = /(^|[\\/])(node_modules|dist|\.git)([\\/]|$)/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > BODY_LIMIT) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('body is not valid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
async function createSimulator({ dir, port = 5173, host = '127.0.0.1', watch = true, graph = loadHost({ fresh: true }), log = () => {} } = {}) {
  dir = path.resolve(dir);
  const session = new Session({ dir, graph });
  let reload = null;
  const doReload = () => { const out = session.reload(); reload = { at: Date.now(), ...out }; log(out.ok ? `reloaded (${out.kept ?? 0} steps replayed${out.dropped ? `, ${out.dropped} dropped` : ''})` : `reload failed: ${out.error}`); return out; };
  if (session.load()) session.start({});
  else log('plugin not loaded: ' + session.error);
  const state = as => ({ ...session.snapshot(as), reload });
  const routes = {
    'POST /api/start': body => session.start({ seats: body.seats, me: body.me, config: body.config, seed: typeof body.seed === 'string' && body.seed ? body.seed.slice(0, 64) : undefined }),
    'POST /api/act': body => session.act(String(body.actor || ''), body.input),
    'POST /api/advance': () => session.advance(),
    'POST /api/bots': () => session.moveBots(),
    'POST /api/rewind': body => session.rewind(body.step),
    'POST /api/reload': () => ({ data: doReload() }),
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (!LOCAL_HOST.test(req.headers.host || '')) return send(res, 403, { error: 'FORBIDDEN_HOST' });
      const url = new URL(req.url, 'http://localhost'), key = `${req.method} ${url.pathname}`;
      if (key === 'GET /') return send(res, 200, page(), 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'" });
      if (key === 'GET /api/state') return send(res, 200, state(url.searchParams.get('as')));
      if (key === 'GET /api/rev') return send(res, 200, { revision: session.revision, reloadAt: reload ? reload.at : 0 });
      if (key === 'GET /api/log') { const out = session.exportLog(); return out ? send(res, 200, JSON.stringify(out, null, 2), 'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="match-log.json"' }) : send(res, 404, { error: 'NO_MATCH' }); }
      if (routes[key]) {
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON_REQUIRED' });
        const done = routes[key](await readBody(req));
        return send(res, done?.code >= 400 ? done.code : 200, done);
      }
      send(res, 404, { error: 'NOT_FOUND' });
    } catch (error) { send(res, error.status || 500, { error: 'SIMULATOR_ERROR', message: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  let watcher = null, timer = null;
  if (watch) {
    try { watcher = fs.watch(dir, { recursive: true }, (event, file) => { if (file && IGNORED.test(file)) return; clearTimeout(timer); timer = setTimeout(doReload, 200); }); }
    catch (error) { log('file watching is not available here: ' + error.message); }
  }
  const address = server.address();
  return { server, session, port: address.port, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}/`, reload: doReload,
    close: () => new Promise(resolve => { clearTimeout(timer); watcher?.close(); server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
module.exports = { createSimulator };
