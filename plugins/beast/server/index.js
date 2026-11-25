// SPDX-License-Identifier: Apache-2.0
// Beast Chess (暗兽棋) as a room plugin (room-plugin@1, docs/design/platform/房间插件接口-room-plugin-v1.md).
// 7×9 jungle chess with hidden ranks: positions are public, ranks are not until a piece first fights. Each side's
// eight ranks are shuffled from its own seed; the setup is committed (sha256 of salt|setup) at the start and revealed
// at the end, so anyone can check it was not swapped. Blue (seat 0) moves first; one orthogonal step a move, rats
// swim, lions and tigers leap the river, traps zero a rank, the rat takes the elephant. A match ends when a piece
// enters the enemy den, a side is wiped out, a side has no legal move, the move cap is reached (the larger sum of
// ranks still standing wins), a player resigns (at any time) or leaves. A move not made in 60 s is made for the side:
// its first legal move by slot. The rules themselves are in ./rules.js, shared with lib/games/beast/beast.js.
const rules = require('./rules');
const VERSION = rules.SETUP_VERSION, TURN_MS = rules.TURN_MS;
const hex = (rng, n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
const nameOf = (state, side) => state.players[side].name;

function finish(state, winnerSide, reason, summary) { return { ...state, status: 'finished', turnEndsAt: 0, result: { winnerSide, reason, summary } }; }
// After a move: den, wipe-out, then the other side's turn, the move cap, and whether it can move at all.
function afterMove(state, moved, now) {
  const enemy = 1 - moved.side, den = rules.DENS[enemy];
  if (moved.c === den[0] && moved.r === den[1]) return finish(state, moved.side, 'den', `${nameOf(state, moved.side)} 的棋子攻入对方兽穴`);
  if (!state.pieces.some(p => p.alive && p.side === enemy)) return finish(state, moved.side, 'wipe', `${nameOf(state, moved.side)} 全歼对方兽群`);
  const next = { ...state, turn: enemy, turnEndsAt: now + TURN_MS };
  if (next.ply >= next.turnCap) {
    const why = `达到 ${next.turnCap} 手回合上限`, s0 = rules.strengthOf(next.pieces, 0), s1 = rules.strengthOf(next.pieces, 1);
    if (s0 === s1) return finish(next, null, 'cap', `${why}，子力 ${s0}:${s1} 平，平局收场`);
    const winner = s0 > s1 ? 0 : 1;
    return finish(next, winner, 'cap', `${why}，子力 ${Math.max(s0, s1)}:${Math.min(s0, s1)}，${nameOf(next, winner)} 胜`);
  }
  if (!rules.allLegalMoves(next.pieces, enemy).length) return finish(next, moved.side, 'stalemate', `${nameOf(next, enemy)} 无合法步可走`);
  return next;
}
const cell = v => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && rules.inBounds(v[0], v[1]) ? [v[0], v[1]] : null;

module.exports = definePlugin({
  setup({ seats, config, rng, now, sha256 }) {
    const seed = { blue: rng.int(1, 2147483646), red: rng.int(1, 2147483646) }, salt = hex(rng, 16);
    return {
      status: 'playing', players: seats.map((s, side) => ({ id: s.id, name: s.name || s.id, side })),
      seed, salt, setupVersion: VERSION, commitHash: sha256(salt + '|' + rules.setupPayload(seed, VERSION)),
      pieces: rules.buildPieces(rules.setupFor(seed, VERSION)), revealLog: [], moves: [],
      turn: 0, ply: 0, turnCap: config.turnCap, turnEndsAt: now + TURN_MS, result: null,
    };
  },
  // The side to move moves (or resigns) before its deadline; the other side may resign at any time.
  decisions(state) {
    if (state.status !== 'playing') return [];
    return state.players.map(p => p.side === state.turn ? { actor: p.id, actions: ['move', 'resign'], deadlineAt: state.turnEndsAt, key: `m:${state.ply}` } : { actor: p.id, actions: ['resign'], deadlineAt: null });
  },
  apply(state, action, { actor, now }) {
    if (state.status !== 'playing') return { error: 'GAME_OVER' };
    const player = state.players.find(p => p.id === actor);
    if (action.type === 'resign') return { state: finish(state, 1 - player.side, 'resign', `${player.name} 认输`), events: [{ type: 'resigned', actor }] };
    if (player.side !== state.turn) return { error: 'NOT_YOUR_TURN' };
    const from = cell(action.from), to = cell(action.to);
    if (!from || !to) return { error: 'BAD_MOVE', status: 400, message: '坐标格式应为 [c,r]' };
    const pieces = state.pieces.map(p => ({ ...p })), piece = pieces.find(p => p.alive && p.side === player.side && p.c === from[0] && p.r === from[1]);
    if (!piece) return { error: 'BAD_MOVE', status: 400, message: '起点没有你的存活棋子' };
    if (!rules.legalMovesForPiece(pieces, piece).some(m => m.to[0] === to[0] && m.to[1] === to[1])) return { error: 'BAD_MOVE', status: 400, message: '不合法的走法（每步一格正交；鼠可入河；狮虎可跃河；水陆之间不可互攻；不入己穴）' };
    const ply = state.ply + 1, defender = pieces.find(p => p.alive && p.c === to[0] && p.r === to[1]) || null;
    const record = { ply, side: piece.side, from, to, captured: null, result: 'move' }, revealLog = [...state.revealLog];
    if (defender) {
      const outcome = rules.resolveBattle(piece.rank, defender.rank, rules.trapOwnerAt(to[0], to[1]) === piece.side), loser = outcome === 'capture' ? defender : piece;
      loser.alive = false; record.result = outcome; record.captured = loser.id;
      // A piece's rank becomes public the first time it fights, for good.
      for (const p of [defender, piece]) if (!revealLog.some(e => e.pieceId === p.id)) revealLog.push({ pieceId: p.id, side: p.side, rank: p.rank, name: rules.RANK_NAMES[p.rank], ply, reason: 'battle' });
    }
    piece.c = to[0]; piece.r = to[1];
    return { state: afterMove({ ...state, pieces, revealLog, moves: [...state.moves, record], ply }, piece, now), events: [{ type: 'moved', actor, from, to, result: record.result }] };
  },
  // Time ran out: the side's first legal move by slot (there always is one: a side without moves has already lost).
  timeout(state) {
    const move = rules.firstLegalMove(state.pieces, state.turn);
    return move ? { type: 'move', from: move.from, to: move.to } : { type: 'resign' };
  },
  leave(state, seat) {
    const player = state.players.find(p => p.id === seat);
    if (state.status !== 'playing' || !player) return { state, events: [] };
    return { state: finish(state, 1 - player.side, 'forfeit', `${player.name} 离场，判负`), events: [{ type: 'left', seat }] };
  },
  // Positions are public; a rank shows once revealed in battle, to its own side always, to everyone at the end. The
  // seeds and the salt only at the end (with the commitment they prove).
  view(state, viewer) {
    const over = state.status !== 'playing', revealed = new Set(state.revealLog.map(e => e.pieceId)), me = state.players.find(p => p.id === viewer);
    return {
      status: state.status, players: state.players, turn: state.turn, ply: state.ply, turnCap: state.turnCap, turnEndsAt: state.turnEndsAt,
      pieces: state.pieces.map(p => ({ id: p.id, side: p.side, slot: p.slot, c: p.c, r: p.r, alive: p.alive, rank: over || revealed.has(p.id) || (me && me.side === p.side) ? p.rank : null })),
      revealLog: state.revealLog, moves: state.moves, commitHash: state.commitHash, setupVersion: state.setupVersion, result: state.result,
      ...(over ? { reveal: { seed: state.seed, salt: state.salt } } : {}),
      ...(me && !over && me.side === state.turn ? { legalMoves: rules.allLegalMoves(state.pieces, me.side) } : {}),
    };
  },
  // For the leak check: the salt is no one's until the end.
  secrets(state) { return state.status === 'playing' ? [{ value: state.salt, visibleTo: [] }] : []; },
  result(state) {
    if (state.status === 'playing') return { done: false };
    const [a, b] = state.players, w = state.result.winnerSide;
    return { done: true, ranking: w === null ? [[a.id, b.id]] : [[state.players[w].id], [state.players[1 - w].id]], summary: state.result.summary };
  },
});
