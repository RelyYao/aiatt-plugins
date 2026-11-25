// SPDX-License-Identifier: Apache-2.0
import {T,e,list,num,button,note,heading,actionRow} from '../shared/mobile-ui.mjs';
// 搭档兵团 (Partner Legion) on the phone: camps and hp, my board (front row on top, nearest the enemy), the bench,
// the shop, the commander's order, an Agent's plan, and the battle played back from the server's timeline.
// Nothing here decides anything: the server (lib/games/legion/legion.js) checks every action.
// Preparation actions carry the match identity but no view fence: everyone prepares at once and each action only
// touches the player's own camp, so another camp's purchase must not bounce mine.
const NAMES={get shield(){return T('legion.unit.shield','Shieldbearer');},get archer(){return T('legion.unit.archer','Archer');},get apprentice(){return T('legion.unit.apprentice','Apprentice');},get scout(){return T('legion.unit.scout','Scout');},get ironclad(){return T('legion.unit.ironclad','Ironclad');},get crossbow(){return T('legion.unit.crossbow','Crossbowman');},get warlock(){return T('legion.unit.warlock','Warlock');},get assassin(){return T('legion.unit.assassin','Assassin');},get warden(){return T('legion.unit.warden','Warden');},get marksman(){return T('legion.unit.marksman','Marksman');},get archmage(){return T('legion.unit.archmage','Archmage');},get shadow(){return T('legion.unit.shadow','Shadowblade');}};
const SHORT={get shield(){return T('legion.short.shield','Shield');},get archer(){return T('legion.short.archer','Archer');},get apprentice(){return T('legion.short.apprentice','Adept');},get scout(){return T('legion.short.scout','Scout');},get ironclad(){return T('legion.short.ironclad','Iron');},get crossbow(){return T('legion.short.crossbow','Xbow');},get warlock(){return T('legion.short.warlock','Lock');},get assassin(){return T('legion.short.assassin','Knife');},get warden(){return T('legion.short.warden','Warden');},get marksman(){return T('legion.short.marksman','Sniper');},get archmage(){return T('legion.short.archmage','Magus');},get shadow(){return T('legion.short.shadow','Shade');}};
const TRAITS={get guard(){return T('legion.trait.guard','Guard');},get ranger(){return T('legion.trait.ranger','Ranger');},get arcane(){return T('legion.trait.arcane','Arcane');},get raider(){return T('legion.trait.raider','Raider');}};
const TRAIT_TIPS={get guard(){return T('legion.traitTip.guard','2: guards +5 armor · 3: +10 armor and +15% hp');},get ranger(){return T('legion.traitTip.ranger','2: rangers attack 25% faster · 3: 54% faster');},get arcane(){return T('legion.traitTip.arcane','Ignores armor; 2: +30% damage · 3: +60%; every third hit splashes the row');},get raider(){return T('legion.traitTip.raider','Strikes the back row first; 2: 20% crits · 3: 35% crits');}};
const ORDERS={get rally(){return [T('legion.order.rally','Rally'),T('legion.orderTip.rally','+15% attack for the first 5 s')];},get focus(){return [T('legion.order.focus','Focus'),T('legion.orderTip.focus','Ranged units pick off the weakest')];},get shield(){return [T('legion.order.shield','Shield'),T('legion.orderTip.shield','Front row +20% hp')];}};
const FRONT=['f0','f1','f2','f3'],BACK=['b0','b1','b2','b3'],PLAY_S=6;
const unitOf=(g,key)=>list(g.rules?.units).find(u=>u.key===key)||{tier:1,trait:'guard',range:1};
const stars=n=>'★'.repeat(Math.max(1,num(n,1)));
const campName=c=>c?.bot&&/^garrison-\d+$/.test(c.id)?T('legion.garrison','Garrison {n}',{n:c.id.split('-')[1]}):c?.name||'';
const priv=(g,h)=>{const p=h.privateView();return p&&p.campId&&!p.spectator?p:null;};
const mineOf=(g,ctx)=>list(g.camps).find(c=>list(c.members).some(m=>m.id===ctx.me?.id))||null;
function chip(ctx,g,u,{selected=false,action='',cell='',extra=''}={}){
 const info=unitOf(g,u.key);
 return `<button type="button" class="lg-unit t-${e(ctx,info.trait)} tier-${info.tier}${selected?' is-selected':''}" data-mg-action="${action||'lg-pick'}" data-lg-uid="${e(ctx,u.uid)}"${cell?` data-lg-cell="${e(ctx,cell)}"`:''} aria-pressed="${selected}" aria-label="${e(ctx,T('legion.unitLabel','{name}, {stars} stars, {trait}, cost {tier}',{name:NAMES[u.key]||u.key,stars:u.star,trait:TRAITS[info.trait]||info.trait,tier:info.tier}))}"${extra}><b>${e(ctx,SHORT[u.key]||u.key)}</b><i aria-hidden="true">${stars(u.star)}</i></button>`;
}
function campsStrip(ctx,g){
 const me=mineOf(g,ctx);
 return `<ol class="lg-camps" aria-label="${e(ctx,T('legion.camps','Camps'))}">${list(g.camps).map(c=>{const hp=Math.max(0,num(c.hp)),pct=Math.round(hp/num(g.rules?.startHp,30)*100),ai=c.bot||list(c.members).every(m=>m.isAgent);return `<li class="lg-camp${c.id===me?.id?' is-mine':''}${c.bot?' is-garrison':''}${c.alive===false?' is-out':''}${c.ready&&g.phase==='prep'?' is-ready':''}"><span class="lg-camp-name">${ai&&!c.bot?'<em aria-hidden="true">AI</em>':''}${e(ctx,c.id===me?.id?T('legion.myCamp','My camp'):campName(c))}</span><span class="lg-hp" role="meter" aria-valuemin="0" aria-valuemax="${num(g.rules?.startHp,30)}" aria-valuenow="${hp}" aria-label="${e(ctx,T('legion.hpLabel','{name}: {hp} hp',{name:campName(c),hp}))}"><span class="${pct>50?'is-high':pct>25?'is-mid':'is-low'}" style="width:${pct}%"></span></span><small>${c.alive===false?e(ctx,T('legion.placeN','#{place}',{place:c.place})):`♥ ${hp}`}</small></li>`;}).join('')}</ol>`;
}
function traitsRow(ctx,camp){
 const t=camp?.traits||{},on=Object.entries(t).filter(([,n])=>n>0);
 if(!on.length)return '';
 return `<div class="lg-traits" aria-label="${e(ctx,T('legion.traits','Traits'))}">${on.map(([k,n])=>`<span class="lg-trait t-${e(ctx,k)}${n>=2?' is-on':''}" title="${e(ctx,TRAIT_TIPS[k]||'')}">${e(ctx,TRAITS[k]||k)} <b>${n}/3</b></span>`).join('')}</div>`;
}
function boardHtml(ctx,g,units,{sel=null,interactive=false}={}){
 const at=cell=>units.find(u=>u.cell===cell);
 const cell=c=>{const u=at(c);if(u)return `<div class="lg-cell">${chip(ctx,g,u,{selected:sel===u.uid,action:interactive?'lg-pick':'lg-none',cell:c,extra:interactive?'':' disabled'})}</div>`;return `<div class="lg-cell">${interactive?`<button type="button" class="lg-slot${sel?' is-target':''}" data-mg-action="lg-cell" data-lg-cell="${c}" aria-label="${e(ctx,T('legion.cellLabel','{row} cell {n}',{row:c[0]==='f'?T('legion.front','Front row'):T('legion.back','Back row'),n:+c[1]+1}))}"></button>`:''}</div>`;};
 return `<div class="lg-board" role="group" aria-label="${e(ctx,T('legion.board','Board'))}"><span class="lg-row-label">${e(ctx,T('legion.front','Front row'))}</span>${FRONT.map(cell).join('')}<span class="lg-row-label">${e(ctx,T('legion.back','Back row'))}</span>${BACK.map(cell).join('')}</div>`;
}
function prepHtml(ctx,g,h,p,camp){
 const s=h.selection(),sel=s&&s.round===g.round&&[...list(p.bench),...list(p.board)].some(u=>u.uid===s.uid)?s.uid:null;
 const selUnit=sel&&[...list(p.bench),...list(p.board)].find(u=>u.uid===sel);
 const benchHtml=`<p class="lg-sub">${e(ctx,T('legion.benchCount','Bench {n}/{max}',{n:list(p.bench).length,max:num(g.rules?.bench,6)}))}</p><div class="lg-bench" role="group" aria-label="${e(ctx,T('legion.bench','Bench'))}">${Array.from({length:num(g.rules?.bench,6)},(_,i)=>{const u=list(p.bench)[i];return u?chip(ctx,g,u,{selected:sel===u.uid}):`<button type="button" class="lg-slot is-bench${sel&&selUnit?.cell?' is-target':''}" data-mg-action="lg-bench" aria-label="${e(ctx,T('legion.benchSlot','Empty bench slot'))}"${sel&&selUnit?.cell?'':' disabled'}></button>`;}).join('')}</div>`;
 const shop=list(p.shop).map((key,slot)=>{if(!key)return `<div class="lg-offer is-empty" aria-hidden="true"></div>`;const info=unitOf(g,key),afford=num(p.gold)>=info.tier;return `<button type="button" class="lg-offer t-${e(ctx,info.trait)} tier-${info.tier}" data-mg-action="lg-buy" data-lg-slot="${slot}"${afford?'':' disabled'} aria-label="${e(ctx,T('legion.buyLabel','Buy {name}, {trait}, {tier} gold',{name:NAMES[key]||key,trait:TRAITS[info.trait],tier:info.tier}))}"><b>${e(ctx,SHORT[key]||key)}</b><small>${e(ctx,TRAITS[info.trait]||'')}</small><i>${info.tier}</i></button>`;}).join('');
 const a=p.advice&&!p.advice.adopted?p.advice:null;
 const advice=a?`<div class="lg-advice"><span class="lg-av" aria-hidden="true">AI</span><p><b>${e(ctx,T('legion.adviceFrom','{name}\'s plan',{name:a.by||''}))}</b><span>${e(ctx,[list(a.buyKeys).length?T('legion.adviceBuy','Buy {units}',{units:list(a.buyKeys).map(k=>SHORT[k]||k).join(', ')}):T('legion.adviceKeep','Keep the gold'),a.order?T('legion.adviceOrder','order: {order}',{order:ORDERS[a.order]?.[0]||a.order}):''].filter(Boolean).join(' · '))}</span></p>${button(ctx,T('legion.adopt','Use it'),'lg-adopt','',false,true)}</div>`:'';
 const tools=selUnit?actionRow(`${button(ctx,T('legion.sell','Sell +{gold}',{gold:unitOf(g,selUnit.key).tier*({1:1,2:3,3:9}[selUnit.star]||1)}),'lg-sell')}${selUnit.cell?button(ctx,T('legion.toBench','To the bench'),'lg-bench'):''}${button(ctx,T('legion.deselect','Done'),'lg-deselect')}`):'';
 const orders=`<div class="lg-orders" role="group" aria-label="${e(ctx,T('legion.order','Commander\'s order'))}">${Object.keys(ORDERS).map(k=>`<button type="button" aria-pressed="${p.order===k}" class="lg-order${p.order===k?' is-on':''}" data-mg-action="lg-order" data-lg-order="${k}"><b>${e(ctx,ORDERS[k][0])}</b><small>${e(ctx,ORDERS[k][1])}</small></button>`).join('')}</div>`;
 const hint=sel?T('legion.hintMove','Tap a cell to place it, or another unit to swap'):T('legion.hintIdle','Tap a unit to move or sell it; tap an offer to buy');
 const board=`<p class="lg-cap">${e(ctx,T('legion.fielded','On the board {n}/{cap}',{n:list(p.board).length,cap:num(p.boardCap)}))}<span>${e(ctx,hint)}</span></p>${boardHtml(ctx,g,list(p.board),{sel,interactive:true})}${traitsRow(ctx,{traits:p.traits||camp.traits})}${benchHtml}${tools}`;
 const market=`<section class="lg-shop" aria-label="${e(ctx,T('legion.shop','Shop'))}"><header><span class="lg-gold" aria-label="${e(ctx,T('legion.goldLabel','{gold} gold',{gold:num(p.gold)}))}">● ${num(p.gold)}</span>${button(ctx,T('legion.refresh','Refresh · {cost}',{cost:num(g.rules?.refreshCost,1)}),'lg-refresh','',num(p.gold)<num(g.rules?.refreshCost,1))}</header><div class="lg-offers">${shop}</div></section>`;
 const ready=`<div class="lg-go">${p.ready?`<p class="mg-note">${e(ctx,T('legion.waiting','Ready. Waiting for the other camps…'))}</p>${button(ctx,T('legion.notReady','Keep preparing'),'lg-unready')}`:button(ctx,T('legion.ready','Ready for battle'),'lg-ready','',false,true)}</div>`;
 if(!h.desktop)return `${advice}${board}${market}${orders}${ready}`;
 const layout=list(a?.layout).map((u,i)=>({...u,uid:`plan-${i}`}));
 const preview=layout.length?`<details class="lg-plan-layout"><summary>${e(ctx,T('legion.pc.preview','Preview suggested formation'))}</summary>${boardHtml(ctx,g,layout)}</details>`:'';
 return `<div class="lg-desktop-prep"><div class="lg-field-panel">${board}</div>
  <aside class="lg-command-panel">${market}${orders}${advice}${preview}${ready}</aside></div>`;
}
// The battle, played back from the timeline: hp bars run down over each unit's life and fallen units fade, timed
// from when the battle phase began (a re-render mid-playback keeps its place through negative delays).
function battleHtml(ctx,g,camp,h){
 const b=list(g.battles).find(x=>x.a===camp?.id||(!x.ghost&&x.b===camp?.id))||list(g.battles)[0];
 if(!b)return '';
 const mineSide=b.a===camp?.id?'a':b.b===camp?.id&&!b.ghost?'b':'a',theirs=mineSide==='a'?'b':'a';
 const playback=h.playback?.();
 const speed=playback?.speed||1;
 const seconds=Math.max(0,(Date.now()-(num(g.battleEndsAt)-num(g.rules?.battleSec,9)*1000))/1000);
 const elapsed=(playback?.elapsed??seconds)/speed;
 const ticks=Math.max(1,num(b.ticks,1)),scale=PLAY_S/ticks/speed;
 const units=side=>list(b.timeline).filter(u=>u.side===side);
 const fighter=u=>{const life=u.dieAt===null||u.dieAt===undefined?ticks:num(u.dieAt),end=Math.round(num(u.hp)/Math.max(1,num(u.maxHp))*100),dur=Math.max(0.2,life*scale);return `<div class="lg-cell"><div class="lg-unit t-${e(ctx,unitOf(g,u.key).trait)} is-fighting${u.dieAt!==null&&u.dieAt!==undefined?' is-falls':''}" style="--dur:${dur.toFixed(2)}s;--delay:${(-elapsed).toFixed(2)}s;--end:${end}%" aria-label="${e(ctx,NAMES[u.key]||u.key)}"><b>${e(ctx,SHORT[u.key]||u.key)}</b><i aria-hidden="true">${stars(u.star)}</i><span class="lg-unit-hp"><span></span></span></div></div>`;};
 const grid=(side,flip)=>{const rows=flip?[1,0]:[0,1];return `<div class="lg-board is-battle">${rows.map(row=>[0,1,2,3].map(col=>{const u=units(side).find(x=>x.row===row&&x.col===col);return u?fighter(u):'<div class="lg-cell"></div>';}).join('')).join('')}</div>`;};
 const byId=id=>list(g.camps).find(c=>c.id===id),me=mineSide==='a'?byId(b.a):byId(b.b),foe=mineSide==='a'?byId(b.b):byId(b.a);
 const lost=num(b.damage?.[me?.id]),won=b.winner===me?.id;
 const outcome=b.winner===null?T('legion.draw','Draw · both lose 1 hp'):won?T('legion.won','Won'):T('legion.lost','Lost · −{hp} hp',{hp:lost});
 const others=list(g.battles).filter(x=>x!==b).map(x=>{const hits=Object.entries(x.damage||{}).filter(([,d])=>num(d)>0).map(([id,d])=>`${e(ctx,campName(byId(id)))} <b>−${num(d)}</b>`).join(' · ');return `<li>${e(ctx,campName(byId(x.a)))} ${e(ctx,T('legion.vs','vs'))} ${e(ctx,campName(byId(x.b)))}${x.ghost?` <small>${e(ctx,T('legion.ghost','(a copy)'))}</small>`:''}${hits?` · ${hits}`:` · ${e(ctx,T('legion.drawShort','draw'))}`}</li>`;}).join('');
 const boards=`<div class="lg-versus"><span>${e(ctx,campName(foe))}${b.ghost&&mineSide==='a'?` <small>${e(ctx,T('legion.ghost','(a copy)'))}</small>`:''}</span></div>${grid(theirs,true)}<div class="lg-clash" aria-hidden="true"></div>${grid(mineSide,false)}<p class="lg-outcome is-${won?'won':b.winner===null?'draw':'lost'}" style="--delay:${(PLAY_S/speed-elapsed).toFixed(2)}s">${e(ctx,outcome)}</p>`;
 if(!h.desktop)return `${boards}${others?`<ul class="lg-others">${others}</ul>`:''}`;
 const controls=actionRow(
  button(ctx,playback?.paused?T('legion.pc.resume','Resume replay'):T('legion.pc.pause','Pause replay'),'lg-replay-pause')+
  button(ctx,T('legion.pc.restart','Replay from start'),'lg-replay-start')+
  button(ctx,speed===2?'2×':'1×','lg-replay-speed',` aria-label="${e(ctx,T('legion.pc.speed','Replay speed {speed}×',{speed}))}"`));
 return `<div class="lg-desktop-battle"><div class="lg-battlefield"${playback?.paused?' data-lg-paused':''}>${boards}</div>
  <aside class="lg-battle-replay"><h3>${e(ctx,T('legion.pc.replay','Battle replay'))}</h3>${controls}
  ${others?`<h4>${e(ctx,T('legion.pc.otherBattles','Other matchups'))}</h4><ul class="lg-others">${others}</ul>`:''}</aside></div>`;
}
function lobbyHtml(ctx,g){
 const seated=list(g.seated),me=ctx.me?.id,mine=seated.includes(me),human=!ctx.me?.isAgent&&!ctx.me?.isBot;
 const rows=Array.from({length:4},(_,i)=>{const id=seated[i];return `<li class="${id?'':'is-empty'}">${id?`<b>${e(ctx,ctx.nameOf?.(id)||id)}</b>`:`<span>${e(ctx,T('legion.garrisonSeat','Open · a garrison takes it'))}</span>`}</li>`;}).join('');
 return `<ol class="lg-lobby">${rows}</ol>${note(ctx,T('legion.lobbyNote','Up to four camps. Each person plays one with their Agent; garrisons fill the empty places.'))}${human?actionRow(`${mine?button(ctx,T('legion.leave','Leave seat'),'lg-leave'):button(ctx,T('legion.sit','Take a camp'),'lg-sit','',seated.length>=4)}${mine?button(ctx,T('legion.launch','Start the battle'),'lg-launch','',false,true):''}`):''}`;
}
function finishedHtml(ctx,g,h){
 const rows=list(g.result?.standings).map(s=>`<li class="${list(g.camps).find(c=>c.id===s.id&&list(c.members).some(m=>m.id===ctx.me?.id))?'is-mine':''}"><b>${e(ctx,T('legion.placeN','#{place}',{place:s.place}))}</b><span>${e(ctx,s.bot?campName({id:s.id,bot:true,name:s.name}):s.name)}</span><small>♥ ${num(s.hp)}</small></li>`).join('');
 return `<ol class="lg-standings">${rows}</ol>${h.results()}`;
}
export function render(detail,ctx,h){
 const g=detail.state.game,camp=mineOf(g,ctx),p=priv(g,h);
 const nameOf=id=>detail.room?.memberInfo?.[id]?.name||detail.userNames?.[id]||id;
 const c2={...ctx,nameOf};
 const phase=g.status==='lobby'?T('legion.lobby','Taking camps'):g.status!=='playing'?T('game.over','This game is over'):g.phase==='prep'?T('legion.prep','Round {round}/{rounds} · Prepare',{round:g.round,rounds:g.rounds}):T('legion.battle','Round {round}/{rounds} · Battle',{round:g.round,rounds:g.rounds});
 const deadline=g.status==='playing'?(g.phase==='prep'?g.prepEndsAt:g.battleEndsAt):0;
 let body='';
 if(g.status==='lobby')body=lobbyHtml(c2,g);
 else if(g.status!=='playing')body=campsStrip(ctx,g)+finishedHtml(ctx,g,h);
 else if(g.phase==='battle')body=campsStrip(ctx,g)+battleHtml(ctx,g,camp,h);
 else if(camp&&camp.alive!==false&&p)body=campsStrip(ctx,g)+prepHtml(ctx,g,h,p,camp);
 else body=campsStrip(ctx,g)+(camp&&camp.alive===false?note(ctx,T('legion.out','Your camp is out. You can keep watching.')):camp?note(ctx,T('legion.syncing','Syncing your camp…')):note(ctx,T('legion.watching','You are watching. Boards show during battles.')));
 return `<section class="lg-game" data-lg-phase="${e(ctx,g.status==='playing'?g.phase:g.status)}">${heading(ctx,T('legion.title','Partner Legion'),phase,deadline)}${body}</section>`;
}
export async function handleAction(root,detail,ctx,action,data,h){
 if(!String(action||'').startsWith('lg-'))return false;
 const g=detail.state.game,p=priv(g,h);
 const send=body=>h.writeUsing((path,opts)=>ctx.request(path,{...opts,body:{...opts.body,expectedViewVersion:undefined}}),'action',body);
 const s=h.selection(),sel=s&&s.round===g.round?s.uid:null;
 if(action==='lg-sit'||action==='lg-leave'||action==='lg-launch'){await send({type:action.slice(3)});return true;}
 if(!p||g.phase!=='prep')return true;
 if(action==='lg-buy'){await send({type:'buy',slot:num(data.lgSlot,-1)});return true;}
 if(action==='lg-refresh'){await send({type:'refresh'});return true;}
 if(action==='lg-order'){await send({type:'order',order:data.lgOrder});return true;}
 if(action==='lg-ready'||action==='lg-unready'){await send({type:'ready',ready:action==='lg-ready'});return true;}
 if(action==='lg-adopt'){await send({type:'adopt'});return true;}
 if(action==='lg-deselect'){h.setSelection(null);h.rerender();return true;}
 if(action==='lg-pick'){
  if(sel&&sel!==data.lgUid&&data.lgCell){h.setSelection(null);await send({type:'move',uid:sel,cell:data.lgCell});return true;} // swap onto a placed unit
  h.setSelection(sel===data.lgUid?null:{uid:data.lgUid,round:g.round});h.rerender();return true;
 }
 if(action==='lg-cell'&&sel){h.setSelection(null);await send({type:'move',uid:sel,cell:data.lgCell});return true;}
 if(action==='lg-bench'&&sel){h.setSelection(null);await send({type:'move',uid:sel,cell:null});return true;}
 if(action==='lg-sell'&&sel){h.setSelection(null);await send({type:'sell',uid:sel});return true;}
 return true;
}
