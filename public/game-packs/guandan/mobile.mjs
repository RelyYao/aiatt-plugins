// SPDX-License-Identifier: Apache-2.0
import {T} from '../shared/mobile-ui.mjs';
// Phone controls use only the server's legal moves and role-scoped private view.
const comboName=m=>({single:'Single',pair:'Pair',trio:'Three of a kind',trio_pair:'Full house',straight:'Straight',pair_run:'Consecutive pairs',steel:'Consecutive triples',bomb:'Bomb',rocket:'Four jokers'})[m?.type]?T('unified.tactical.guandan.combo.'+m.type,({single:'Single',pair:'Pair',trio:'Three of a kind',trio_pair:'Full house',straight:'Straight',pair_run:'Consecutive pairs',steel:'Consecutive triples',bomb:'Bomb',rocket:'Four jokers'})[m.type]):m?.name||'';
const eq=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a[0]===b[0]&&a[1]===b[1];
const game=d=>d.state?.game||{};
const extras=(h,key,value)=>` data-mg-${key}="${h.esc(value)}"`;
const card=(n,h)=>{const k=Number(n);if(!Number.isInteger(k)||k<0||k>107)return '';const v=Math.floor((k%52)/4)+2;return `<span class="mg-mini-card ${k<104&&[1,2].includes(k%4)?'mg-card-red':''}">${h.esc(k>=104?(k%2?T('unified.tactical.guandan.bigJoker','Big Joker'):T('unified.tactical.guandan.littleJoker','Little Joker')):(v===14?'A':v===13?'K':v===12?'Q':v===11?'J':v)+['♠','♥','♦','♣'][k%4])}</span>`;};
const expired=n=>Number(n)>0&&Number(n)<=Date.now();
const sameCards=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every(id=>b.includes(id));
const chosenCards=(g,p,s)=>s?.handNo===g.handNo&&Array.isArray(s?.cards)&&s.cards.every(id=>Number.isInteger(id)&&p?.myCards?.includes(id))?[...new Set(s.cards)]:[];
function lobbyControls(detail, ctx, h, own) {
 const g=game(detail), current=own===0||own===1, person=ctx.me&&!ctx.me.isAgent&&!ctx.me.isBot;
 if(g.seating!=='explicit')return h.note(T('unified.tactical.guandan.lobbyHint','You sit opposite your Agent; two people can start the deal.'))+(own>=0?h.actionRow(h.button(T('unified.tactical.guandan.launch','Ready, deal'),'gd-launch','',false,true)):'');
 const p=h.privateView(), options=p?.matchId===g.matchId&&p.viewVersion===g.viewVersion?h.list(p.partnerOptions):[];
 const pick=options.length?g.teams.filter((team,index)=>!g.seats[index]?.id||own===index).map(team=>{
  const indices=h.list(team.seats), teamName=team.id==='A'?T('unified.tactical.guandan.teamNS','North–South team'):T('unified.tactical.guandan.teamEW','East–West team');
  return `<fieldset class="mg-actions"><legend>${h.esc(teamName)}</legend>${options.filter(agent=>g.seats[indices[1]]?.id!==agent.id).map(agent=>h.button(T('unified.tactical.guandan.seatPair','Sit with {name}',{name:agent.name}),'gd-sit',extras(h,'team',team.id)+extras(h,'agent',agent.id))).join('')}</fieldset>`;
 }).join(''):person&&!current?h.note(T('unified.tactical.guandan.seatNoAgent','Pair an Agent in My Agent first, then choose a team.')):'';
 const ready=current&&!!g.seats[own].ready;
 const seated=person&&current?h.actionRow(h.button(T(ready?'unified.tactical.guandan.seatUnready':'unified.tactical.guandan.seatReady',ready?'Cancel ready':'Ready to deal'),'gd-ready',extras(h,'ready',String(!ready)),false,!ready)+h.button(T('unified.tactical.guandan.seatLeave','Leave both seats'),'gd-leave')):'';
 const launch=person&&(current||detail.room?.ownerId===ctx.me.id)?h.actionRow(h.button(T('unified.tactical.guandan.launch','Ready, deal'),'gd-launch','',!g.readyToLaunch,!!g.readyToLaunch)):'';
 return h.note(T('unified.tactical.guandan.seatWaiting','Waiting for both teams to be ready'))+seated+launch+(person?pick:'');
}
function guandan(d,ctx,h){
 const g=game(d),p=h.privateView(),own=h.list(g.seats).findIndex(s=>s.id===ctx.me?.id);
 const priv=p?.role==='player'&&p.seatId===ctx.me?.id&&p.matchId===g.matchId&&p.viewVersion===g.viewVersion&&p.handNo===g.handNo&&own===p.seatIdx?p:null;
 const moves=h.list(priv?.legalMoves),sel=h.selection(),cards=chosenCards(g,priv,sel),selected=sel?.handNo===g.handNo?moves.find(m=>m.id===sel.combo&&sameCards(m.cards,cards)):null;
 const canSelect=!!priv?.canAct&&!g.betweenDeals&&g.status==='playing';
 const role=own>=0?'player':'spectator',positions=[T('unified.tactical.guandan.south','South'),T('unified.tactical.guandan.east','East'),T('unified.tactical.guandan.north','North'),T('unified.tactical.guandan.west','West')];
 const seats=h.list(g.seats).map((seat,i)=>{
  const relative=own>=0?(i-own+4)%4:i,partner=own>=0&&relative===2;
  if(!seat.id&&g.seating==='explicit')return `<article class="gp-gd-seat gp-gd-pos-${relative}"><b>${h.esc(positions[i])}</b><small>${h.esc(T('unified.tactical.guandan.seatEmpty','Empty seat'))}</small></article>`;
  return `<article class="gp-gd-seat gp-gd-pos-${relative} ${i===g.turnSeatIdx?'is-turn':''} ${i===own?'is-me':''}"><span class="gp-gd-seat-avatar">${h.esc((seat.name||T('unified.tactical.guandan.player','Player')).slice(0,1))}</span><b>${h.esc(seat.name)}</b><small>${h.esc(partner?T('unified.tactical.guandan.partnerSeat','Opposite · partner'):i===own?T('unified.tactical.guandan.mySeat','My seat'):T('unified.tactical.guandan.seat','{position} seat',{position:positions[i]}))} · ${h.esc(seat.rank?T('unified.tactical.guandan.rank','Rank {rank}',{rank:seat.rank}):T('unified.tactical.guandan.cardCount','{count} cards',{count:h.num(seat.count)}))}</small>${i!==own&&seat.count>0?`<img class="gp-gd-seat-back" src="${globalThis.AiattGameArt?.url('/assets/games/guandan/card-back.svg')||'/assets/games/guandan/card-back.svg'}" alt="${h.esc(T('unified.tactical.guandan.hiddenCards','Hidden hand'))}">`:''}</article>`;
 }).join('');
 const target=h.list(g.trick).slice().reverse().find(t=>!t.pass);
 const pile=target?`<small>${h.esc(g.seats?.[target.seatIdx]?.name)} · ${h.esc(comboName(target))}</small><div>${h.list(target.cards).map(n=>card(n,h)).join('')}</div>`:`<small>${h.esc(T('unified.tactical.guandan.newTrick','New trick'))}</small><b>${h.esc(T('unified.tactical.guandan.awaitLead','Waiting for lead'))}</b>`;
 let html=`<div class="gp-guandan-world" data-world-role="${role}">${h.heading(T('unified.tactical.guandan.title','Guandan Partners'),g.status==='lobby'?T('unified.tactical.guandan.lobbySubtitle','Four seats, human and agent partners'):T('unified.tactical.guandan.handStage','Hand {hand} · {stage}',{hand:h.num(g.handNo,1),stage:g.betweenDeals?T('unified.tactical.guandan.settling','Settling hand'):own===g.turnSeatIdx?T('unified.tactical.guandan.ourTurn','Our turn'):T('unified.tactical.guandan.playing','Playing')}),g.betweenDeals?g.nextDealAt:g.actEndsAt)}<div class="gp-gd-levels">${h.list(g.teams).map(t=>`<div><span>${h.esc(t.id==='A'?T('unified.tactical.guandan.teamNS','North–South team'):t.id==='B'?T('unified.tactical.guandan.teamEW','East–West team'):t.name)}</span><b>${h.esc(({11:'J',12:'Q',13:'K',14:'A'})[t.level]||t.level)}<small>${h.esc(T('unified.tactical.guandan.level','level'))}</small></b><progress max="12" value="${Math.max(0,h.num(t.level,2)-2)}" aria-label="${h.esc(T('unified.tactical.guandan.levelProgress','{name} level progress',{name:t.id==='A'?T('unified.tactical.guandan.teamNS','North–South team'):t.id==='B'?T('unified.tactical.guandan.teamEW','East–West team'):t.name}))}"></progress></div>`).join('')}</div><div class="gp-gd-table">${seats}<div class="gp-gd-pile">${pile}</div></div>`;
 if(g.status==='lobby')return html+lobbyControls(d,ctx,h,own)+'</div>';
 if(g.status!=='playing')return html+'</div>';
 if(priv){
  html+=`<section class="mg-my-hand gp-gd-hand"><header><div><small>${h.esc(T('unified.tactical.guandan.myHand','My hand'))}</small><b>${h.esc(T('unified.tactical.guandan.cardCount','{count} cards',{count:h.list(priv.myCards).length}))} · ${h.esc(canSelect?T('unified.tactical.guandan.selectConfirm','Select then confirm'):T('unified.tactical.guandan.readOnly','View while waiting'))}</b></div>${canSelect&&cards.length?h.button(T('unified.tactical.guandan.clear','Clear selection'),'gd-clear'):''}</header><div class="mg-gd-cards">${h.list(priv.myCards).map(n=>canSelect?`<button type="button" class="mg-gd-card ${cards.includes(n)?'mg-selected':''}" data-mg-action="gd-card"${extras(h,'card',n)} aria-pressed="${cards.includes(n)}">${card(n,h)}</button>`:`<span class="mg-gd-card is-readonly">${card(n,h)}</span>`).join('')}</div><p>${h.esc(canSelect?(cards.length?T('unified.tactical.guandan.selectedCards','{count} selected; select more cards or inspect legal combinations.',{count:cards.length}):priv.mustLead?T('unified.tactical.guandan.mustLead','You lead this trick; select your cards.'):T('unified.tactical.guandan.followHint','Select cards to follow, or pass.')):T('unified.tactical.guandan.wait','Waiting for {name} to play.',{name:g.seats?.[g.turnSeatIdx]?.name||T('unified.tactical.guandan.player','Player')}))}</p></section>`;
  if(canSelect){
   const filter=h.draft(`gd-filter-${g.handNo}`,'all'),filtered=moves.filter(m=>(filter==='all'||m.type===filter)&&cards.every(id=>h.list(m.cards).includes(id)));
   html+=`<div class="mg-confirm-bar gp-gd-confirm"><span><small>${h.esc(selected?T('unified.tactical.guandan.readyPlay','Ready to play'):T('unified.tactical.guandan.selection','Current selection'))}</small><b>${h.esc(selected?comboName(selected):cards.length?T('unified.tactical.guandan.pendingCards','{count} cards selected',{count:cards.length}):T('unified.tactical.guandan.pickCards','Select cards'))}</b></span>${!priv.mustLead?h.button(T('unified.tactical.guandan.pass','Pass'),'gd-pass'):''}${h.button(T('unified.tactical.guandan.play','Confirm play'),'gd-play','',!selected,true)}</div><details class="gp-gd-candidates"><summary>${h.esc(T('unified.tactical.guandan.legalCombos','Legal combinations'))} <span>${h.esc(T('unified.tactical.guandan.comboCount','{count} combinations',{count:filtered.length}))}</span></summary><label class="m-label">${h.esc(T('unified.tactical.guandan.legalType','Legal combination type'))}<select class="m-input" data-mg-draft="gd-filter-${h.num(g.handNo)}"><option value="all">${h.esc(T('unified.tactical.guandan.allTypes','All types ({count})',{count:moves.length}))}</option>${[...new Set(moves.map(m=>m.type))].map(type=>`<option value="${h.esc(type)}"${filter===type?' selected':''}>${h.esc(comboName(moves.find(m=>m.type===type))||type)}</option>`).join('')}</select></label><div class="mg-combo-list">${filtered.map(m=>`<button type="button" class="mg-combo ${selected?.id===m.id?'mg-selected':''}" data-mg-action="gd-select"${extras(h,'combo',m.id)} aria-pressed="${selected?.id===m.id}"><b>${h.esc(comboName(m))}</b><span>${h.list(m.cards).map(n=>card(n,h)).join('')}</span></button>`).join('')||h.note(T('unified.tactical.guandan.noCombos','No matching combinations. Change the cards or type; you may pass when not leading.'))}</div></details>`;
  }else if(g.betweenDeals)html+=h.note(T('unified.tactical.guandan.betweenHands','Hand settled; the next hand will be dealt shortly.'));
  if(priv.partner)html+=`<aside class="gp-gd-partner"><img src="/assets/games/guandan/partner-logo.svg" alt=""><span>${h.esc(T('unified.tactical.guandan.partner','Partner'))} <b>${h.esc(priv.partner.name)}</b><small>${h.esc(priv.partner.rank?T('unified.tactical.guandan.partnerFinished','Finished · rank {rank}',{rank:priv.partner.rank}):T('unified.tactical.guandan.remaining','{count} cards left',{count:h.num(priv.partner.count)}))} · ${h.esc(T('unified.tactical.guandan.handsPrivate','Hands remain private'))}</small></span></aside>`;
 }else html+=h.note(own>=0?T('unified.tactical.guandan.sync','Syncing your hand and legal combinations…'):T('unified.tactical.guandan.spectating','Spectating; other players’ hands remain hidden.'));
 html+=`<details class="mg-history"><summary>${h.esc(T('unified.tactical.guandan.history','Trick history'))}</summary>${h.list(g.trick).map(t=>`<p><b>${h.esc(g.seats?.[t.seatIdx]?.name||T('unified.tactical.guandan.player','Player'))}</b> ${h.esc(t.pass?T('unified.tactical.guandan.pass','Pass'):comboName(t))} ${h.list(t.cards).map(n=>card(n,h)).join('')}</p>`).join('')||h.note(T('unified.tactical.guandan.awaitLead','Waiting for lead'))}</details>`;
 if(expired(g.betweenDeals?g.nextDealAt:g.actEndsAt))html+=h.actionRow(h.button(T('unified.tactical.guandan.settle','Resolve expired turn'),'gd-settle'));
 return html+'</div>';
}
export function render(detail,ctx,h){
 const g=game(detail),render=g.kind==='guandan'?guandan:null;if(!render)return null;
 let html=render(detail,ctx,h);
 if(!['playing','lobby'].includes(g.status)){
  const reveal=g.result?.reveal||g.reveal;
  html+=`<section class="mg-result"><span>${h.esc(T('unified.tactical.guandan.result','Match result'))}</span><h3>${h.esc(h.resultSummary?.(g)||g.result?.summary||g.result?.winnerName||T('unified.tactical.guandan.finished','Match finished'))}</h3>${h.list(g.result?.ranks).map(r=>h.note(`${r.name||h.nameOf(r.userId||r.id)} · ${r.rank?T('unified.tactical.guandan.rank','Rank {rank}',{rank:r.rank}):T('unified.tactical.guandan.outcome.'+(r.result||'complete'),({win:'Won',loss:'Lost',draw:'Draw'})[r.result]||'Participated')}`)).join('')}${g.fees?h.note(T('unified.tactical.guandan.fees','Prize pool {pot} T · retained {rake} T',{pot:h.num(g.fees.pot),rake:h.num(g.fees.rake)})):''}${h.list(g.fees?.payouts).map(p=>h.note(`${p.name||h.nameOf(p.userId)} · ${h.num(p.amount??p.prize)} T`)).join('')}${h.actionRow(h.button(T('unified.tactical.guandan.rematch','Play again'),'rematch','',false,true))}${reveal?`<details class="mg-history"><summary>${h.esc(T('unified.tactical.guandan.verify','Fairness verification and reveal'))}</summary><pre>${h.esc(JSON.stringify(reveal,null,2))}</pre></details>`:''}</section>`;
 }
 return html;
}
export async function handleAction(root,detail,ctx,action,data,h){
 const g=game(detail),p=h.privateView();
 if(g.kind==='guandan'&&action?.startsWith('gd-')){
  const own=h.list(g.seats).some((s,i)=>(s.id===ctx.me?.id||h.list(s.members).some(m=>m.id===ctx.me?.id))&&i===p?.seatIdx);
  if(g.status==='lobby'&&g.seating==='explicit'&&['gd-sit','gd-leave','gd-ready','gd-launch'].includes(action)){
   if(action==='gd-sit')await h.send({type:'sit',team:data.mgTeam,agentId:data.mgAgent});
   if(action==='gd-leave')await h.send({type:'leave'});
   if(action==='gd-ready')await h.send({type:'ready',ready:data.mgReady==='true'});
   if(action==='gd-launch'&&g.readyToLaunch)await h.send({type:'launch'});
   return true;
  }
  if(action==='gd-launch'){if(h.list(g.seats).some(s=>s.id===ctx.me?.id)&&g.status==='lobby')await h.send({type:'launch'});return true;}
  if(action==='gd-settle'){await h.send({type:'settle'});return true;}
  if(!own||p?.role!=='player'||p.seatId!==ctx.me?.id||p.matchId!==g.matchId||p.viewVersion!==g.viewVersion||!p.canAct||p.handNo!==g.handNo||g.status!=='playing'||g.betweenDeals)return true;
  if(action==='gd-card'){
   if(!/^(0|[1-9]\d{0,2})$/.test(data.mgCard))return true;const id=Number(data.mgCard);if(!h.list(p.myCards).includes(id))return true;
   const selected=chosenCards(g,p,h.selection()),cards=selected.includes(id)?selected.filter(n=>n!==id):[...selected,id],exact=cards.length?h.list(p.legalMoves).find(m=>sameCards(m.cards,cards)):null;
   h.setSelection({handNo:g.handNo,cards,combo:exact?.id||null});
   if(exact&&h.draft(`gd-filter-${g.handNo}`,'all')!=='all'&&h.draft(`gd-filter-${g.handNo}`)!==exact.type)h.setDraft(`gd-filter-${g.handNo}`,'all');
   h.rerender();root.querySelector?.(`[data-mg-action="gd-card"][data-mg-card="${id}"]`)?.focus?.({preventScroll:true});return true;
  }
  if(action==='gd-clear'){h.setSelection({handNo:g.handNo,cards:[],combo:null});h.rerender();return true;}
  if(action==='gd-select'){const move=h.list(p.legalMoves).find(m=>m.id===data.mgCombo);if(move){h.setSelection({handNo:g.handNo,cards:[...move.cards],combo:move.id});h.rerender();}return true;}
  if(action==='gd-play'){const s=h.selection(),cards=chosenCards(g,p,s);if(s&&s.handNo===g.handNo&&h.list(p.legalMoves).some(m=>m.id===s.combo&&sameCards(m.cards,cards)))await h.send({type:'play',combo:s.combo});return true;}
  if(action==='gd-pass'&&!p.mustLead)await h.send({type:'pass'});return true;
 }

 return false;
}
