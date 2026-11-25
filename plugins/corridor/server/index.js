// SPDX-License-Identifier: Apache-2.0
// Endless Corridor (无尽回廊) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md).
// A tower of puzzle floors, the same for everyone on the same day (./tower.js: the day's public seed, each part's
// commitment). One squad practises, two race. Each squad climbs on its own clock: a floor allows 8 minutes (running
// out ends the squad's climb), hints cost time, a floor can be skipped twice a tower (+45 s), a cipher out of
// guesses resets (time runs on). A climb ends at the top, on surrender, on time-out or when the squad leaves. The
// sprint format is three mirrored floors, no skips, one hint a floor, and the first squad to clear all of them wins.
// Otherwise, once every climb has ended: more floors cleared wins, then less time. Fees, refunds and prizes are the
// platform's (lib/games/corridor/corridor.js), driven by this plugin's events.
const T = require('@aiatt/plugin-kit/puzzle-templates');
const tower = require('./tower');
const FLOOR_LIMIT_MS = 8 * 60 * 1000, SKIP_PENALTY_MS = 45 * 1000, HINT_PENALTY_MS = 10 * 1000, SPRINT_HINT_PENALTY_MS = 5 * 1000;
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const sprint = state => state.format === 'sprint';
const hintsPerFloor = state => sprint(state) ? 1 : T.HINTS_PER_ROUND;
const hintPenalty = state => sprint(state) ? SPRINT_HINT_PENALTY_MS : HINT_PENALTY_MS;
const activePart = pr => pr.partSolved.findIndex(ok => !ok);
const cells = part => part.template === 'lights' ? part.params.size ** 2 : part.template === 'pipes' ? part.params.cols * part.params.rows : part.params.length;
const fail = (error, message, status) => ({ error, message, ...(status ? { status } : {}) });
const bad = (error, message) => fail(error, message, 400); // the input itself is malformed

function newProgress(format) {
  return { floorIdx: 0, floorsCleared: 0, skipsLeft: format === 'sprint' ? 0 : 2, totalTimeMs: 0, penaltyMs: 0, hintsUsed: 0, hintsRevealed: [], hintsStructured: [],
    partSolved: [false], boards: [], floorStartedAt: 0, floorDeadline: 0, finished: false, finishReason: null, finishedAt: 0, log: [] };
}
function beginFloor(state, pr, idx, now) {
  const floor = state.tower.floors[idx];
  return { ...pr, floorIdx: idx, boards: floor.parts.map(p => tower.cloneBoard(p.board)), partSolved: floor.parts.map(() => false),
    hintsUsed: 0, hintsRevealed: [], hintsStructured: [], penaltyMs: 0, floorStartedAt: now, floorDeadline: now + FLOOR_LIMIT_MS };
}
// Every climb has ended: the result (the platform adds its prize line to the summary).
function finalized(state) {
  if (state.squads.some(s => !s.progress.finished)) return state;
  const [a, b] = state.squads;
  let winner = null;
  if (sprint(state) && state.raceWinner) winner = state.squads.find(s => s.id === state.raceWinner) || null;
  else if (b) {
    const pa = a.progress, pb = b.progress;
    if (pa.floorsCleared !== pb.floorsCleared) winner = pa.floorsCleared > pb.floorsCleared ? a : b;
    else if (pa.totalTimeMs !== pb.totalTimeMs) winner = pa.totalTimeMs < pb.totalTimeMs ? a : b;
  }
  return { ...state, status: 'finished', result: { winner: winner ? winner.id : null, winnerName: winner ? winner.name : null } };
}
// A squad's climb ends; the first squad to clear a sprint wins it there.
function finishRun(state, squadId, reason, now, events) {
  const squads = state.squads.map(s => {
    if (s.id !== squadId || s.progress.finished) return s;
    const pr = s.progress, cleared = reason === 'cleared' && pr.floorsCleared < state.tower.floors.length ? 'top' : reason;
    return { ...s, progress: { ...pr, totalTimeMs: pr.totalTimeMs + Math.max(0, now - pr.floorStartedAt) + pr.penaltyMs, penaltyMs: 0, finished: true, finishReason: cleared, finishedAt: now } };
  });
  const squad = squads.find(s => s.id === squadId);
  events.push({ type: 'runFinished', squad: squadId, reason: squad.progress.finishReason });
  let next = { ...state, squads };
  if (sprint(next) && squad.progress.finishReason === 'cleared' && !next.raceWinner) { next = { ...next, raceWinner: squadId }; events.push({ type: 'raceWon', squad: squadId }); }
  return finalized(next);
}
function withProgress(state, squadId, pr) { return { ...state, squads: state.squads.map(s => s.id === squadId ? { ...s, progress: pr } : s) }; }
// The floor's last part solved: account its time, reveal its commitments, climb on (or end at the top).
function clearFloor(state, squadId, pr, { now, sha256 }, events) {
  const floor = state.tower.floors[pr.floorIdx], ms = Math.max(1, now - pr.floorStartedAt) + pr.penaltyMs;
  const reveal = floor.parts.map(p => ({ salt: p.salt, seed: p.seed, solution: p.solution, verified: sha256(p.salt + '|' + JSON.stringify(p.solution)) === p.commitHash }));
  const done = { ...pr, penaltyMs: 0, totalTimeMs: pr.totalTimeMs + ms, floorStartedAt: now, floorsCleared: pr.floorsCleared + 1,
    log: [...pr.log, { floor: pr.floorIdx + 1, kind: floor.kind, label: floor.label, ok: true, skipped: false, ms, hintsUsed: pr.hintsUsed, reveal }] };
  events.push({ type: 'floorCleared', squad: squadId, floor: pr.floorIdx + 1, ms, total: done.totalTimeMs, verified: reveal.every(r => r.verified) });
  if (pr.floorIdx + 1 >= state.tower.floors.length) return finishRun(withProgress(state, squadId, done), squadId, 'cleared', now, events);
  return withProgress(state, squadId, beginFloor(state, done, pr.floorIdx + 1, now));
}
function partSolved(state, squadId, pr, pi, ctx, events) {
  const solved = { ...pr, partSolved: pr.partSolved.map((ok, i) => i === pi ? true : ok) };
  if (solved.partSolved.some(ok => !ok)) { events.push({ type: 'partSolved', squad: squadId, floor: pr.floorIdx + 1, part: pi + 1, of: solved.partSolved.length }); return withProgress(state, squadId, solved); }
  return clearFloor(state, squadId, solved, ctx, events);
}

module.exports = definePlugin({
  setup({ seats, config, rng, now, sha256 }) {
    const build = config.format === 'sprint' ? tower.buildSprintTower : tower.buildTower;
    const t = build(config.day, { salt: () => hex(rng, 16), sha256 });
    const state = { status: 'playing', format: config.format, day: config.day, towerSeed: t.seed, commitHash: sha256(config.day + '|' + t.seed), tower: t,
      squads: seats.map(s => ({ id: s.id, name: s.name || s.id, progress: newProgress(config.format) })), raceWinner: null, result: null };
    return { ...state, squads: state.squads.map(s => ({ ...s, progress: beginFloor(state, s.progress, 0, now) })) };
  },
  // Every squad still climbing plays its current floor until its deadline.
  decisions(state) {
    if (state.status !== 'playing') return [];
    return state.squads.filter(s => !s.progress.finished).map(s => ({ actor: s.id, actions: ['toggle', 'guess', 'hint', 'skip', 'surrender', 'pass'], deadlineAt: s.progress.floorDeadline, key: `${s.id}:${s.progress.floorIdx}` }));
  },
  apply(state, action, ctx) {
    const squad = state.squads.find(s => s.id === ctx.actor), pr = squad.progress, events = [], now = ctx.now;
    if (pr.finished) return fail('RUN_FINISHED', '你的爬塔已结束，可围观对手或查看天梯');
    if (action.type === 'pass') return now < pr.floorDeadline ? fail('TOO_EARLY', '还没有到期的层——单层上限 8 分钟，到期后任意成员可触发结算') : { state: finishRun(state, squad.id, 'timeout', now, events), events };
    if (now > pr.floorDeadline) return fail('FLOOR_EXPIRED', '本层已超时，等待结算');
    if (action.type === 'surrender') return { state: finishRun(state, squad.id, 'surrender', now, events), events };
    const floor = state.tower.floors[pr.floorIdx], pi = activePart(pr), part = floor.parts[pi];
    if (action.type === 'hint') {
      const perFloor = hintsPerFloor(state), penalty = hintPenalty(state);
      if (pr.hintsUsed >= perFloor) return fail('HINT_EXHAUSTED', `本层提示券已用完（${perFloor} 张，每张 +${penalty / 1000}s 罚时）`);
      const h = part.hints[pr.hintsUsed], text = T.describeHint(h);
      const structured = h.type === 'cell' ? { type: 'cell', idx: h.idx } : h.type === 'rot' ? { type: 'rot', idx: h.idx, rot: h.rot } : { type: 'pos', pos: h.pos, color: h.color };
      events.push({ type: 'hint', squad: squad.id, text, penalty });
      return { state: withProgress(state, squad.id, { ...pr, hintsUsed: pr.hintsUsed + 1, penaltyMs: pr.penaltyMs + penalty, hintsRevealed: [...pr.hintsRevealed, text], hintsStructured: [...(pr.hintsStructured || []), structured] }), events };
    }
    if (action.type === 'skip') {
      if (sprint(state)) return fail('SKIP_DISABLED', '镜像狂奔不设跳层——三层全部跑完方分胜负');
      if (pr.skipsLeft <= 0) return fail('SKIP_EXHAUSTED', 'skip 已用完（每塔 2 次）');
      const ms = Math.max(1, now - pr.floorStartedAt) + pr.penaltyMs + SKIP_PENALTY_MS;
      const skipped = { ...pr, penaltyMs: 0, totalTimeMs: pr.totalTimeMs + ms, floorStartedAt: now, skipsLeft: pr.skipsLeft - 1,
        log: [...pr.log, { floor: pr.floorIdx + 1, kind: floor.kind, label: floor.label, ok: false, skipped: true, ms, hintsUsed: pr.hintsUsed }] };
      events.push({ type: 'skipped', squad: squad.id, floor: pr.floorIdx + 1, skipsLeft: skipped.skipsLeft });
      const next = withProgress(state, squad.id, skipped);
      // The top floor can be skipped too: the climb ends at the top with the floors cleared.
      if (pr.floorIdx + 1 >= state.tower.floors.length) return { state: finishRun(next, squad.id, 'top', now, events), events };
      return { state: withProgress(next, squad.id, beginFloor(next, skipped, pr.floorIdx + 1, now)), events };
    }
    if (action.type === 'toggle') {
      if (part.template === 'cipher') return bad('BAD_ACTION', '密码阵请用 guess 提交序列');
      const n = cells(part), idx = action.idx;
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) return bad('BAD_INDEX', `格子序号必须是 0-${n - 1} 的整数`);
      const board = T.applyMove(part.template, pr.boards[pi], { idx }), moved = { ...pr, boards: pr.boards.map((b, i) => i === pi ? board : b) };
      return { state: T.isSolved(part.template, board) ? partSolved(state, squad.id, moved, pi, ctx, events) : withProgress(state, squad.id, moved), events };
    }
    // guess (cipher)
    if (part.template !== 'cipher') return bad('BAD_ACTION', '点灯阵/管道阵请用 toggle 点击');
    const seq = Array.isArray(action.seq) ? action.seq : [], { length, colors } = part.params;
    if (seq.length !== length || seq.some(v => !Number.isInteger(v) || v < 0 || v >= colors)) return bad('BAD_PARAMS', `猜测需为 ${length} 个 0-${colors - 1} 的颜色序号`);
    let board = T.applyGuess(pr.boards[pi], part.solution.secret, seq);
    if (T.isSolved('cipher', board)) return { state: partSolved(state, squad.id, { ...pr, boards: pr.boards.map((b, i) => i === pi ? board : b) }, pi, ctx, events), events };
    // Out of guesses: the same cipher starts over; the time runs on (that is the penalty).
    if (T.isFailed('cipher', board)) { board = tower.cloneBoard(part.board); events.push({ type: 'cipherReset', squad: squad.id, floor: pr.floorIdx + 1 }); }
    return { state: withProgress(state, squad.id, { ...pr, boards: pr.boards.map((b, i) => i === pi ? board : b) }), events };
  },
  timeout() { return { type: 'pass' }; },
  leave(state, seat, { now }) {
    const squad = state.squads.find(s => s.id === seat), events = [];
    if (state.status !== 'playing' || !squad || squad.progress.finished) return { state, events };
    return { state: finishRun(state, seat, 'abandoned', now, events), events };
  },
  // The solutions, the hints not yet used and the salts stay on the server until their floor is cleared (a cleared
  // floor's reveal is public: the tower is public by design). In a sprint the other squads show only where they are
  // and the time they have used.
  view(state, viewer) {
    const hud = pr => ({ floor: pr.floorIdx + 1, floorsCleared: pr.floorsCleared, elapsedMs: pr.totalTimeMs + pr.penaltyMs, finished: pr.finished, finishReason: pr.finished ? pr.finishReason : null });
    return { status: state.status, format: state.format, day: state.day, towerSeed: state.towerSeed, commitHash: state.commitHash, raceWinner: state.raceWinner, result: state.result,
      floors: state.tower.floors.map(f => ({ index: f.index, kind: f.kind, label: f.label, parts: f.parts.map(p => ({ template: p.template, params: p.params, difficulty: p.difficulty, meta: p.meta })) })),
      squads: state.squads.map(s => sprint(state) && s.id !== viewer ? { id: s.id, name: s.name, hud: hud(s.progress) } : { id: s.id, name: s.name, progress: s.progress }) };
  },
  secrets(state) {
    if (state.status !== 'playing') return [];
    const revealed = new Set(state.squads.flatMap(s => s.progress.log.flatMap(e => (e.reveal || []).map(r => r.salt))));
    return state.tower.floors.flatMap(f => f.parts.map(p => p.salt)).filter(salt => !revealed.has(salt)).map(value => ({ value, visibleTo: [] }));
  },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const w = state.result.winner, ids = state.squads.map(s => s.id);
    return { done: true, ranking: w === null ? [ids] : [[w], ids.filter(id => id !== w)] };
  },
});
