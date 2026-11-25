// SPDX-License-Identifier: Apache-2.0
// Junqi (四国暗战) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md). Two
// countries of 25 hidden pieces on a 12×5 board (./map.js): roads one step, railways slide (engineers turn
// corners), camps shelter, a headquarters freezes what enters; bigger takes smaller, equals and bombs trade, an
// engineer digs a mine, anyone else dies on it; losing the commander shows your flag. Each side's deployment is
// shuffled within the legal constraints from the match seed (./setup.js) and committed (sha256 of salt|layouts),
// revealed at the end. Blue (seat 0) moves first, 60 s a move (the side's first safe move is made for it). A match
// ends when a flag dies or a piece stands on the enemy headquarters, when a side cannot move, at the move cap (the
// stronger army left wins), when a side resigns (at any time) or leaves. Each seat is a country (a person and their
// Agents play it together).
const M = require('./map');
const S = require('./setup');
const TURN_MS = 60 * 1000, SIDE_NAMES = { 0: '蓝方', 1: '红方' };
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const bad = message => ({ error: 'BAD_MOVE', status: 400, message });

function finish(state, winnerSide, reason, summary) { return { ...state, status: 'finished', turnEndsAt: 0, result: { winnerSide, reason, summary } }; }
// After a move: a flag destroyed, a flag carried, then the other side's turn, the move cap, and whether it can move.
function afterMove(state, moved, now) {
  const deadFlag = state.pieces.find(p => p.rank === M.JUNQI && !p.alive);
  if (deadFlag) return finish(state, 1 - deadFlag.side, 'flag', `${SIDE_NAMES[deadFlag.side]}军旗被夺毁`);
  if (moved.alive) {
    const hq = M.hqOwnerAt(moved.c, moved.r);
    if (hq !== undefined && hq !== moved.side) return finish(state, moved.side, 'flag', `${SIDE_NAMES[moved.side]}的棋子攻入对方大本营（扛旗）`);
  }
  const enemy = 1 - moved.side, next = { ...state, turn: enemy, turnEndsAt: now + TURN_MS };
  if (next.ply >= next.turnCap) {
    const why = `达到 ${next.turnCap} 手回合上限`, s0 = M.strengthOf(next.pieces, 0), s1 = M.strengthOf(next.pieces, 1);
    if (s0 === s1) return finish(next, null, 'cap', `${why}，子力 ${s0}:${s1} 平，平局收场`);
    const winner = s0 > s1 ? 0 : 1;
    return finish(next, winner, 'cap', `${why}，子力 ${Math.max(s0, s1)}:${Math.min(s0, s1)}，${SIDE_NAMES[winner]} ${next.squads[winner].name} 胜`);
  }
  if (!M.allLegalMoves(next.pieces, enemy).length) return finish(next, moved.side, 'nomove', `${SIDE_NAMES[enemy]}无可动棋子`);
  return next;
}
const cell = v => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && M.inBounds(v[0], v[1]) ? [v[0], v[1]] : null;
const reveal = (log, piece, ply, reason) => log.some(e => e.pieceId === piece.id) ? log : [...log, { pieceId: piece.id, side: piece.side, rank: piece.rank, name: M.RANK_NAMES[piece.rank], ply, reason }];

module.exports = definePlugin({
  setup({ seats, config, rng, now, sha256 }) {
    const seed = rng.int(1, 2147483646), layouts = S.layoutsFor(seed), salt = hex(rng, 16);
    return { status: 'playing', squads: seats.map((s, side) => ({ id: s.id, name: s.name || s.id, side })), seed, salt, commitHash: sha256(salt + '|' + S.layoutsJson(layouts)),
      pieces: S.buildPieces(layouts), revealLog: [], moves: [], turn: 0, ply: 0, turnCap: config.turnCap, turnEndsAt: now + TURN_MS, result: null };
  },
  decisions(state) {
    if (state.status !== 'playing') return [];
    return state.squads.map(s => s.side === state.turn ? { actor: s.id, actions: ['move', 'resign'], deadlineAt: state.turnEndsAt, key: `m:${state.ply}` } : { actor: s.id, actions: ['resign'], deadlineAt: null });
  },
  apply(state, action, { actor, now }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER' };
    const squad = state.squads.find(s => s.id === actor);
    if (action.type === 'resign') return { state: finish(state, 1 - squad.side, 'resign', `${SIDE_NAMES[squad.side]} ${squad.name} 认输`), events: [{ type: 'resigned', actor }] };
    if (squad.side !== state.turn) return { error: 'NOT_YOUR_TURN' };
    const from = cell(action.from), to = cell(action.to);
    if (!from || !to) return bad('坐标格式应为 [c,r]');
    const pieces = state.pieces.map(p => ({ ...p })), piece = pieces.find(p => p.alive && p.side === squad.side && p.c === from[0] && p.r === from[1]);
    if (!piece) return bad('起点没有己方的存活棋子');
    if (!M.legalMovesForPiece(pieces, piece).some(m => m.to[0] === to[0] && m.to[1] === to[1])) return bad('不合法的走法（公路一步；铁路直线滑行；工兵铁路可拐弯；行营庇护不可攻；大本营进子后冻结）');
    const ply = state.ply + 1, defender = pieces.find(p => p.alive && p.c === to[0] && p.r === to[1]) || null;
    const record = { ply, side: piece.side, from, to, captured: null, lost: null, result: 'move' };
    let revealLog = state.revealLog;
    if (defender) {
      const outcome = M.resolveBattle(piece.rank, defender.rank);
      revealLog = reveal(reveal(revealLog, defender, ply, 'battle'), piece, ply, 'battle');
      if (outcome === 'capture') { defender.alive = false; record.result = 'capture'; record.captured = defender.id; }
      else if (outcome === 'both') { defender.alive = false; piece.alive = false; record.result = 'both'; record.captured = defender.id; record.lost = piece.id; }
      else { piece.alive = false; record.result = 'sacrifice'; record.captured = piece.id; } // 攻亡守存，攻方原地消散
      // A commander lost shows its side's flag, for good.
      const deadCommander = [defender, piece].find(p => !p.alive && p.rank === M.SILING), flag = deadCommander && M.flagOf(pieces, deadCommander.side);
      if (flag && flag.alive) revealLog = reveal(revealLog, flag, ply, 'flag-open');
    }
    if (piece.alive) { piece.c = to[0]; piece.r = to[1]; }
    return { state: afterMove({ ...state, pieces, revealLog, moves: [...state.moves, record], ply }, piece, now), events: [{ type: 'moved', actor, from, to, result: record.result }] };
  },
  timeout(state) { const mv = S.timeoutMove(state.pieces, state.turn); return mv ? { type: 'move', from: mv.from, to: mv.to } : { type: 'resign' }; },
  leave(state, seat) {
    const squad = state.squads.find(s => s.id === seat);
    if (state.status !== 'playing' || !squad) return { state, events: [] };
    return { state: finish(state, 1 - squad.side, 'forfeit', `${SIDE_NAMES[squad.side]} ${squad.name} 全员离场，判负`), events: [{ type: 'left', seat }] };
  },
  // Positions are public; a rank shows once revealed, to its own country always, to everyone at the end; the seed
  // and the salt only at the end.
  view(state, viewer) {
    const over = state.status !== 'playing', revealed = new Set(state.revealLog.map(e => e.pieceId)), me = state.squads.find(s => s.id === viewer);
    return { status: state.status, squads: state.squads, turn: state.turn, ply: state.ply, turnCap: state.turnCap, turnEndsAt: state.turnEndsAt,
      pieces: state.pieces.map(p => ({ id: p.id, side: p.side, slot: p.slot, c: p.c, r: p.r, alive: p.alive, rank: over || revealed.has(p.id) || (me && me.side === p.side) ? p.rank : null })),
      revealLog: state.revealLog, moves: state.moves, commitHash: state.commitHash, result: state.result,
      ...(over ? { reveal: { seed: state.seed, salt: state.salt } } : {}),
      ...(me && !over && me.side === state.turn ? { legalMoves: M.allLegalMoves(state.pieces, me.side) } : {}) };
  },
  secrets(state) { return state.status === 'playing' ? [{ value: state.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const [a, b] = state.squads, w = state.result.winnerSide;
    return { done: true, ranking: w === null ? [[a.id, b.id]] : [[state.squads[w].id], [state.squads[1 - w].id]], summary: state.result.summary };
  },
});
