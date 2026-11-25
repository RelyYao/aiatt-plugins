// SPDX-License-Identifier: Apache-2.0
import {T,e,list,num,isOwner,nameOf,attr,button,note,clock,heading,actionRow,teamOf,squadOf} from '../shared/mobile-ui.mjs';
const STARS=new Set(['3,3','7,3','11,3','3,7','7,7','11,7','3,11','7,11','11,11']);
// The five (or more) in a row through the last stone, so the result is visible on the board.
function winLine(board,last){
  if(!last||!Array.isArray(board))return new Set();const at=(x,y)=>num(board[y]?.[x]),colour=at(last.x,last.y);if(!colour)return new Set();
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
    const run=[[last.x,last.y]];
    for(const sign of [1,-1])for(let k=1;k<15&&at(last.x+sign*dx*k,last.y+sign*dy*k)===colour;k++)run.push([last.x+sign*dx*k,last.y+sign*dy*k]);
    if(run.length>=5)return new Set(run.map(point=>point.join(',')));
  }
  return new Set();
}
export function render(detail, ctx, h) {
  const g=detail.state.game;
  const mine = [g.black, g.white].includes(ctx.me?.id);
  const yourTurn = g.status === 'playing' && g.turn === ctx.me?.id;
  const selected = h.selection();
  const valid = selected && !num(g.board?.[selected[1]]?.[selected[0]]);
  // Round 4 participation modes: an Agent may play a colour, or mark a point for its person (private view only).
  const control=detail.state?.gameControl||{},advice=yourTurn?h.privateView?.()?.advice:null,handed=c=>c&&['agent','advise'].includes(c.mode)?c:null;
  const tag=id=>{const c=handed(control[id]);return c?`<small class="mg-go-handed is-${c.mode}">${e(ctx,c.mode==='agent'?T('mc.goAgent','{name} plays',{name:c.agentName||''}):T('mc.goAdvise','{name} advises',{name:c.agentName||''}))}</small>`:'';};
  const mineHanded=yourTurn&&control[ctx.me?.id]?.mode==='agent'?note(ctx,T('mc.goHanded','{name} is moving for you. Place a stone yourself to take this move.',{name:control[ctx.me.id].agentName||''})):'';
  const adviceRow=advice?`<div class="mg-go-advice"><span class="mg-control-av" aria-hidden="true">AI</span><span>${e(ctx,T('mc.goAdvice','{name} suggests row {row}, column {col}',{name:advice.byName||'',row:advice.y+1,col:advice.x+1}))}</span>${button(ctx,T('mc.goAdopt','Use it'),'gomoku-adopt')}</div>`:'';
  const ownedStatus=g.ownedAgentExecution&&g.status==='playing'?note(ctx,g.ownedAgentExecution.status==='thinking'?T('roomPlay.thinking','Your Agent is considering its move…'):T('roomPlay.hostedMatch','You are playing your own Agent · {turns}/24 Agent turns',{turns:g.ownedAgentExecution.agentTurns||0})):'';
  // Game feel (round 5): a dot on the stone just played, the winning five lit up, hoshi points on the grid.
  const last=list(g.moves).at(-1),won=['black_win','white_win'].includes(g.status)?winLine(g.board,last):new Set();
  const cells = Array.from({ length: 15 }, (_, y) => Array.from({ length: 15 }, (_, x) => {
    const value = num(g.board?.[y]?.[x]);
    return `<button type="button" role="gridcell" class="mg-go-cell ${value ? `mg-stone-${value}` : ''} ${valid && selected[0] === x && selected[1] === y ? 'mg-selected' : ''}${advice && advice.x === x && advice.y === y && !value ? ' mg-advised' : ''}${last && last.x === x && last.y === y ? ' is-last' : ''}${won.has(x+','+y) ? ' is-win' : ''}${STARS.has(x+','+y) ? ' is-star' : ''}" data-mg-point="${x},${y}" aria-label="${e(ctx,T('unified.social.gomoku.cell','Row {row}, column {col}: {stone}',{row:y+1,col:x+1,stone:value===1?T('unified.social.gomoku.black','Black stone'):value===2?T('unified.social.gomoku.white','White stone'):T('unified.social.gomoku.empty','Empty')}))}"${value || !yourTurn ? ' disabled' : ''}><span></span></button>`;
  }).join('')).join('');
  return `${heading(ctx, T('unified.social.gomoku.title','Gomoku'), g.status === 'playing' ? yourTurn ? T('unified.social.gomoku.turn','Your turn · select a point, then confirm') : T('unified.social.gomoku.wait','Waiting for {name} to move',{name:nameOf(detail,g.turn)}) : T('unified.social.gomoku.over','Game over'))}${ownedStatus}${mineHanded}<div class="mg-versus"><span class="mg-go-side${g.status==='playing'&&g.turn===g.black?' is-turn':''}"><i class="mg-go-dot is-black" aria-hidden="true"></i>${e(ctx, nameOf(detail, g.black))}${tag(g.black)}</span><span class="mg-go-side${g.status==='playing'&&g.turn===g.white?' is-turn':''}"><i class="mg-go-dot is-white" aria-hidden="true"></i>${e(ctx, nameOf(detail, g.white))}${tag(g.white)}</span></div>${adviceRow}<div class="mg-go-board" role="grid" aria-label="${e(ctx,T('unified.social.gomoku.board','15 by 15 Gomoku board'))}">${cells}</div>${g.status === 'playing' && !mine ? `<div class="mg-watch-bar" role="status"><i aria-hidden="true"></i><span>${e(ctx,T('mg.watchTurn','Watching · {name} to move',{name:nameOf(detail,g.turn)}))}</span>${list(g.moves).length?`<small>${e(ctx,T('mg.watchMoves','Move {count}',{count:list(g.moves).length}))}</small>`:''}</div>` : g.status === 'playing' ? `<div class="mg-confirm-bar"><span data-mg-selection>${e(ctx,valid ? T('unified.social.gomoku.selected','Selected row {row}, column {col}',{row:selected[1]+1,col:selected[0]+1}) : yourTurn ? T('unified.social.gomoku.choose','Select a point; no stone is placed until you confirm') : mine ? T('unified.social.gomoku.waitOpponent','Waiting for your opponent') : T('unified.social.gomoku.spectating','You are watching'))}</span>${button(ctx, T('unified.social.gomoku.confirm','Confirm move'), 'gomoku-confirm', '', !yourTurn || !valid, true)}</div>` : h.results()}`;
}

export async function handleAction(root,detail,ctx,action,data,h){
 if(action==='gomoku-adopt'){const a=h.privateView?.()?.advice,g=detail.state.game;if(a&&g.turn===ctx.me?.id&&!num(g.board?.[a.y]?.[a.x])){h.setSelection([a.x,a.y]);h.selectionPreview([a.x,a.y],'gomoku');}return true;}
 if(action!=='gomoku-confirm')return false;const g=detail.state.game,s=h.selection();
 if(s&&g.turn===ctx.me?.id&&!num(g.board?.[s[1]]?.[s[0]]))await h.write('move',{x:s[0],y:s[1]});return true;
}
export function handlePoint(root,detail,ctx,data,h){
 if(data.mgPoint===undefined)return false;const g=detail.state.game;if(g.status!=='playing'||g.turn!==ctx.me?.id)return true;
 const point=data.mgPoint.split(',').map(Number);if(point.length!==2||!point.every(v=>Number.isInteger(v)&&v>=0&&v<15)||num(g.board?.[point[1]]?.[point[0]]))return true;
 h.setSelection(point);h.selectionPreview(point,'gomoku');return true;
}
