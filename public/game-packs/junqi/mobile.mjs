// SPDX-License-Identifier: Apache-2.0
import {T} from '../shared/mobile-ui.mjs';
// Phone controls use only the server's legal moves and role-scoped private view.
const ranks=new Proxy({40:'Commander',39:'Army commander',38:'Division commander',37:'Brigadier',36:'Regiment commander',35:'Battalion commander',34:'Company commander',33:'Platoon commander',32:'Engineer',99:'Mine',98:'Bomb',0:'Flag'},{get:(o,k)=>o[k]?T('unified.tactical.junqi.rank.'+k,o[k]):undefined});
const moveLabel=value=>({move:'Move',capture:'Captured',sacrifice:'Attacker lost',both:'Both pieces lost'})[value]?T('unified.tactical.junqi.moveResult.'+value,({move:'Move',capture:'Captured',sacrifice:'Attacker lost',both:'Both pieces lost'})[value]):value||T('unified.tactical.junqi.move','Move');
const eq=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a[0]===b[0]&&a[1]===b[1];
const game=d=>d.state?.game||{};
const extras=(h,key,value)=>` data-mg-${key}="${h.esc(value)}"`;
const expired=n=>Number(n)>0&&Number(n)<=Date.now();
const rankFiles={40:'badge-siling',39:'badge-junzhang',38:'badge-shizhang',37:'badge-lvzhang',36:'badge-tuanzhang',35:'badge-yingzhang',34:'badge-lianzhang',33:'badge-paizhang',32:'badge-gongbing',99:'icon-mine',98:'icon-bomb',0:'icon-flag'};
function fieldRoutes(g,flipped){
 const camps=new Set((g.rules?.camps||[]).map(p=>p.join(','))),roads=[],rails=[];
 const add=(a,b)=>roads.push([a,b]);
 for(let r=0;r<12;r++)for(let c=0;c<4;c++)add([c,r],[c+1,r]);
 for(const r of [0,1,2,3,4,6,7,8,9,10])for(let c=0;c<5;c++)add([c,r],[c,r+1]);
 for(const c of [1,2,3])add([c,5],[c,6]);
 for(const r of [1,2,3,4,6,7,8,9])for(let c=0;c<4;c++)for(const pair of [[[c,r],[c+1,r+1]],[[c+1,r],[c,r+1]]])if(pair.some(p=>camps.has(p.join(','))))roads.push(pair);
 for(const r of [1,5,6,10])for(let c=0;c<4;c++)rails.push([[c,r],[c+1,r]]);
 for(const c of [0,4])for(const r of [1,2,3,4,5,6,7,8,9])rails.push([[c,r],[c,r+1]]);
 const point=p=>[50+(flipped?4-p[0]:p[0])*100,50+(flipped?11-p[1]:p[1])*100];
 const lines=rows=>rows.map(([a,b])=>{const x=point(a),y=point(b);return `<line x1="${x[0]}" y1="${x[1]}" x2="${y[0]}" y2="${y[1]}"/>`;}).join('');
 return `<svg class="gp-jq-routes" viewBox="0 0 500 1200" preserveAspectRatio="none" aria-hidden="true"><g class="gp-jq-roads">${lines(roads)}</g><g class="gp-jq-rails">${lines(rails)}</g><path class="gp-jq-frontier" d="M0 600H500"/></svg>`;
}
function junqi(d,ctx,h){
 const g=game(d),p=h.privateView(),player=h.list(g.players).find(x=>x.id===ctx.me?.id),priv=p?.isPlayer&&p.matchId===g.matchId&&p.viewVersion===g.viewVersion&&p.yourSide===player?.side?p:null;
 const can=!!priv?.yourTurn&&g.status==='playing',moves=can?h.list(priv.moves):[],sel=h.selection(),from=sel?.kind==='junqi'&&sel.ply===g.ply?sel.from:null;
 const legal=moves.filter(m=>eq(m.from,from)),to=legal.some(m=>eq(m.to,sel?.to))?sel.to:null,flipped=priv?.yourSide===1;
 const own=new Map(h.list(priv?.yourPieces).map(piece=>[piece.id,piece]));
 const sideName=side=>g.squads?.find(s=>s.side===side)?.name||g.squads?.[side]?.name||(side?T('unified.tactical.junqi.red','Red'):T('unified.tactical.junqi.blue','Blue'));
 const band=side=>`<div class="gp-jq-army ${g.turn===side&&g.status==='playing'?'is-turn':''}"><i class="gp-jq-color-${side}"></i><b>${h.esc(sideName(side))}</b><span>${h.esc(T('unified.tactical.junqi.alive','{count} pieces in play',{count:h.list(g.pieces).filter(x=>x.alive&&x.side===side).length}))}</span></div>`;
 let html=`<div class="gp-junqi-world" data-world-role="${player?'player':'spectator'}">${h.heading(T('unified.tactical.junqi.title','Junqi'),can?T('unified.tactical.junqi.yourMove','Your turn · select a piece and destination'):g.status==='playing'?T('unified.tactical.junqi.wait','Waiting for {name} to move',{name:sideName(g.turn)}):T('unified.tactical.junqi.finished','Match finished'),g.turnEndsAt)}<div class="gp-jq-score"><span>${h.esc(T('unified.tactical.junqi.moveCount','Move {move} / {limit}',{move:h.num(g.ply),limit:h.num(g.turnCap,400)}))}</span><span>${h.esc(player?T('unified.tactical.junqi.sharedArmy','Teammates share an army'):T('unified.tactical.junqi.spectatingShort','Spectating · hidden pieces stay private'))}</span></div>${band(flipped?0:1)}`;
 const rows=Array.from({length:12},(_,r)=>r),cols=[0,1,2,3,4];if(flipped){rows.reverse();cols.reverse();}
 html+=`<div class="gp-jq-sandtable">${fieldRoutes(g,flipped)}<div class="mg-jq-board" role="grid" aria-label="${h.esc(T('unified.tactical.junqi.board','Junqi board'))}">${rows.map(r=>cols.map(c=>{
  const piece=h.list(g.pieces).find(x=>x.alive&&x.c===c&&x.r===r),mine=piece&&piece.side===priv?.yourSide,known=mine?own.get(piece.id)?.rank:piece?.rank;
  const camp=h.list(g.rules?.camps).some(a=>eq(a,[c,r])),hq=Object.values(g.rules?.hqs||{}).flat().some(a=>eq(a,[c,r])),terrain=camp?T('unified.tactical.junqi.camp','Camp'):hq?T('unified.tactical.junqi.hq','Headquarters'):'';
  const destination=legal.some(m=>eq(m.to,[c,r])),allowed=can&&(mine&&moves.some(m=>eq(m.from,[c,r]))||destination);
  return `<button type="button" role="gridcell" class="mg-jq-cell ${piece?'mg-jq-side-'+piece.side:''} ${eq(from,[c,r])?'mg-selected':''} ${eq(to,[c,r])?'gp-jq-target':''} ${destination?'mg-legal':''} ${camp?'is-camp':''} ${hq?'is-hq':''}" data-mg-action="jq-cell"${extras(h,'cell',`${c},${r}`)} aria-label="${h.esc(T('unified.tactical.junqi.cell','Row {row}, column {column} · {content}',{row:r+1,column:c+1,content:piece?T('unified.tactical.junqi.pieceSide','{side} {piece}',{side:mine?T('unified.tactical.junqi.own','Own'):T('unified.tactical.junqi.opposing','Opposing'),piece:known==null?T('unified.tactical.junqi.hidden','Hidden piece'):ranks[known]||T('unified.tactical.junqi.piece','Piece')}):terrain||T('unified.tactical.junqi.empty','Empty')}))}"${allowed?'':' disabled'}>${piece?`<b>${known!=null?`<img src="/assets/games/junqi/${rankFiles[known]||'badge-gongbing'}.svg" alt="">`:`<span class="gp-jq-seal">${h.esc(T('unified.tactical.junqi.hiddenGlyph','?'))}</span>`}<span>${known==null?'':h.esc(ranks[known]||'?')}</span></b>`:camp?`<img class="gp-jq-terrain" src="/assets/games/junqi/camp-shield.svg" alt="${h.esc(T('unified.tactical.junqi.camp','Camp'))}">`:hq?`<img class="gp-jq-terrain" src="/assets/games/junqi/tile-hq.svg" alt="${h.esc(T('unified.tactical.junqi.hq','Headquarters'))}">`:'<small>·</small>'}</button>`;
 }).join('')).join('')}</div></div>${band(flipped?1:0)}`;
 if(can){
  const source=h.list(priv.yourPieces).find(p=>eq([p.c,p.r],from)),target=h.list(g.pieces).find(p=>p.alive&&eq([p.c,p.r],to));
  html+=`<div class="mg-confirm-bar gp-jq-confirm"><span><small>${h.esc(from?T('unified.tactical.junqi.selected','Selected {piece}',{piece:ranks[source?.rank]||T('unified.tactical.junqi.ownPiece','own piece')}):T('unified.tactical.junqi.ourTurn','Your turn'))}</small><b>${h.esc(to?target?T('unified.tactical.junqi.battle','Attack: {piece}',{piece:target.rank==null?T('unified.tactical.junqi.hidden','Hidden piece'):ranks[target.rank]}):T('unified.tactical.junqi.moveTo','Move to row {row}, column {column}',{row:to[1]+1,column:to[0]+1}):from?T('unified.tactical.junqi.pickTarget','Select a highlighted destination'):T('unified.tactical.junqi.pickPiece','Select one of your pieces'))}</b></span>${h.button(T('unified.tactical.junqi.confirmMove','Confirm move'),'jq-move','',!to,true)}</div>`;
 }else html+=h.note(priv?T('unified.tactical.junqi.privacy','Your team shares identities; opponents are revealed after battle.'):player?T('unified.tactical.junqi.sync','Syncing your pieces and legal moves…'):T('unified.tactical.junqi.spectating','Spectating; unrevealed pieces on both sides remain hidden.'));
 html+=`<div class="gp-jq-legend"><span><i></i>${h.esc(T('unified.tactical.junqi.rail','Long-distance railway'))}</span><span><img src="/assets/games/junqi/camp-shield.svg" alt="">${h.esc(T('unified.tactical.junqi.campProtection','Camp protection'))}</span><span><img src="/assets/games/junqi/tile-hq.svg" alt="">${h.esc(T('unified.tactical.junqi.hq','Headquarters'))}</span></div>`;
 if(priv&&g.status==='playing'&&expired(g.turnEndsAt))html+=h.actionRow(h.button(T('unified.tactical.junqi.settle','Resolve timed-out turn'),'jq-settle'));
 html+=`<details class="mg-history"><summary>${h.esc(T('unified.tactical.junqi.history','Reveals and move history'))}</summary>${h.list(g.moves).slice(-12).reverse().map(m=>`<p>${h.esc(T('unified.tactical.junqi.moveRecord','Move {move}',{move:h.num(m.ply)}))} · ${h.esc(m.byName||T('unified.tactical.junqi.player','Player'))} ${h.esc(moveLabel(m.result))}</p>`).join('')}${h.list(g.revealLog).slice(-8).map(m=>`<p>${h.esc(sideName(m.side))} · ${h.esc(ranks[m.rank]||m.name||T('unified.tactical.junqi.revealed','Revealed'))}</p>`).join('')||h.note(T('unified.tactical.junqi.historyEmpty','Battle reveals appear here.'))}</details>`;
 if(priv&&g.status==='playing')html+=`<details class="mg-history"><summary>${h.esc(T('unified.tactical.junqi.more','More actions'))}</summary>${h.note(T('unified.tactical.junqi.resignHint','Resigning ends the match and awards the opponent the win.'))}${h.button(T('unified.tactical.junqi.resign','Resign'),'jq-resign')}</details>`;
 return html+'</div>';
}
export function render(detail,ctx,h){
 const g=game(detail),render=g.kind==='junqi'?junqi:null;if(!render)return null;
 let html=render(detail,ctx,h);
 if(!['playing','lobby'].includes(g.status)){
  const reveal=g.result?.reveal||g.reveal;
  html+=`<section class="mg-result"><span>${h.esc(T('unified.tactical.junqi.result','Match result'))}</span><h3>${h.esc(h.resultSummary?.(g)||g.result?.summary||g.result?.winnerName||T('unified.tactical.junqi.finished','Match finished'))}</h3>${h.list(g.result?.ranks).map(r=>h.note(`${r.name||h.nameOf(r.userId||r.id)} · ${r.rank?T('unified.tactical.junqi.rankPosition','Rank {rank}',{rank:r.rank}):T('unified.tactical.junqi.outcome.'+(r.result||'complete'),({win:'Won',loss:'Lost',draw:'Draw'})[r.result]||'Participated')}`)).join('')}${g.fees?h.note(T('unified.tactical.junqi.fees','Prize pool {pot} T · retained {rake} T',{pot:h.num(g.fees.pot),rake:h.num(g.fees.rake)})):''}${h.list(g.fees?.payouts).map(p=>h.note(`${p.name||h.nameOf(p.userId)} · ${h.num(p.amount??p.prize)} T`)).join('')}${h.actionRow(h.button(T('unified.tactical.junqi.rematch','Play again'),'rematch','',false,true))}${reveal?`<details class="mg-history"><summary>${h.esc(T('unified.tactical.junqi.verify','Fairness verification and reveal'))}</summary><pre>${h.esc(JSON.stringify(reveal,null,2))}</pre></details>`:''}</section>`;
 }
 return html;
}
export async function handleAction(root,detail,ctx,action,data,h){
 const g=game(detail),p=h.privateView();
 if(g.kind==='junqi'&&action?.startsWith('jq-')){
  const player=h.list(g.players).find(x=>x.id===ctx.me?.id);if(!p?.isPlayer||p.matchId!==g.matchId||p.viewVersion!==g.viewVersion||p.yourSide!==player?.side)return true;
  if(action==='jq-settle'){if(g.status==='playing'&&expired(g.turnEndsAt))await h.send({type:'settle'});return true;}
  if(action==='jq-resign'){ctx.openSheet?.({title:T('unified.tactical.junqi.confirmResign','Confirm resignation'),html:`<p>${h.esc(T('unified.tactical.junqi.resignHint','Resigning ends the match and awards the opponent the win.'))}</p><button type="button" class="m-btn m-btn-primary" data-tactic-resign>${h.esc(T('unified.tactical.junqi.confirmResign','Confirm resignation'))}</button>`,onMount:s=>{s.querySelector('[data-tactic-resign]').onclick=async()=>{if(await h.send({type:'resign'}))ctx.closeSheet?.();};}});return true;}
  if(!p.yourTurn||g.status!=='playing')return true;
  const s=h.selection(),moves=h.list(p.moves);
  if(action==='jq-cell'){const cell=String(data.mgCell).split(',').map(Number);if(cell.length!==2||!cell.every(Number.isInteger))return true;if(moves.some(m=>eq(m.from,cell)))h.setSelection({kind:'junqi',ply:g.ply,from:cell});else if(s?.ply===g.ply&&moves.some(m=>eq(m.from,s.from)&&eq(m.to,cell)))h.setSelection({...s,to:cell});h.rerender();return true;}
  if(action==='jq-move'&&s?.ply===g.ply&&moves.some(m=>eq(m.from,s.from)&&eq(m.to,s.to)))await h.send({type:'move',from:s.from,to:s.to});return true;
 }

 return false;
}
