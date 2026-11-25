// SPDX-License-Identifier: Apache-2.0
import {T} from '../shared/mobile-ui.mjs';
import {puzzleConsole,handleCipherSelection} from '../shared/puzzle-console.mjs';
import {TEMPLATES,REASONS,list,gameOf,squadOf,clock,integer,selectedTemplate,message,puzzleParamsHtml,collectParams,puzzleBoardHtml,cipherInput,revealHtml,inlineConfirm,confirmedSend} from '../shared/puzzle-tools.mjs';
const floorName=name=>{const entry={'镜像起跑线':['unified.social.corridor.floorName.mirrorStart','Mirror Start'],'双生水脉':['unified.social.corridor.floorName.twinWaters','Twin Waters'],'同步密码厅':['unified.social.corridor.floorName.syncCipher','Synchronized Cipher Hall'],'微光门厅':['unified.social.corridor.floorName.glimmerHall','Glimmer Hall'],'水脉回廊':['unified.social.corridor.floorName.waterCorridor','Waterway Corridor'],'密码暗室':['unified.social.corridor.floorName.cipherChamber','Cipher Chamber'],'千灯长阶':['unified.social.corridor.floorName.thousandLights','Thousand Lights Stairway'],'九曲管廊':['unified.social.corridor.floorName.windingPipes','Winding Pipeway'],'双锁密码厅':['unified.social.corridor.floorName.doubleLock','Double-lock Cipher Hall'],'双重回廊':['unified.social.corridor.floorName.doubleCorridor','Double Corridor'],'诅咒之巅':['unified.social.corridor.floorName.cursedSummit','Cursed Summit']}[name];return entry?T(entry[0],entry[1]):name;};
const hintText=(h,fallback)=>h?.type==='cell'?T('unified.social.corridor.hintCell','The solution includes cell {n}',{n:Number(h.idx)+1}):h?.type==='rot'?T('unified.social.corridor.hintRot','Pipe {n} should be at rotation {rotation} (0–3)',{n:Number(h.idx)+1,rotation:h.rot}):h?.type==='pos'?T('unified.social.corridor.hintPos','Position {n} of the code is colour {colour}',{n:Number(h.pos)+1,colour:Number(h.color)+1}):fallback;
const hintsFor=pr=>{const old=Array.isArray(pr.hintsRevealed)?pr.hintsRevealed:[],structured=pr.hintsStructured;return Array.isArray(structured)&&structured.length===old.length?old.map((text,i)=>hintText(structured[i],text)):old;};
function corridorView(g,ctx,h) {
  const priv=h.privateView(),mine=squadOf(g,ctx.me?.id),sprint=g.format==='sprint';
  const privateOwner=!!priv&&priv.squad?.id===mine?.id&&!!mine;
  // Sprint never falls back to public squads[].progress, even if a response carries it.
  const pr=sprint?(privateOwner?priv.myProgress:null):(mine?.progress||(!mine?list(g.squads)[0]?.progress:null));
  const canSolve=!!privateOwner&&!!priv.canSolve&&g.status==='playing'&&!!pr&&!pr.finished;
  const floor=pr?list(g.floors)[h.num(pr.floorIdx)]:null;
  const active=pr?list(pr.partSolved).findIndex(done=>!done):-1;
  return {priv,mine,sprint,pr,canSolve,floor,active};
}
function corridorFloor(g,view,h) {
 const {pr,floor,canSolve,active}=view;
 if(!pr)return h.note(view.sprint?T('unified.social.corridor.syncSprint','Board syncing. Only floor numbers and times are visible to spectators.'):T('unified.social.corridor.syncFloor','Syncing the tower floor.'));
 if(!floor)return h.note(T('unified.social.corridor.finishedInfo','This climb has ended. View results and leaderboard.'));
 const parts=list(floor.parts),index=Math.max(0,active),part=parts[index];
 return `<section class="gp-crd-room"><header><div><small>${h.esc(T('unified.social.corridor.floorMechanism','Floor {floor} · current puzzle',{floor:h.num(pr.floorIdx)+1}))}</small><h3>${h.esc(floorName(floor.label)||T('unified.social.corridor.currentFloor','Current floor'))}</h3></div><span class="gp-crd-room-clock"${!pr.finished?` data-mg-deadline="${h.num(pr.floorDeadline)}"`:''}>${pr.finished?T('unified.social.corridor.floorFinished','Floor finished'):Math.max(0,Math.ceil((h.num(pr.floorDeadline)-Date.now())/1000))+T('unified.social.corridor.seconds',' seconds')}</span></header><div class="gp-crd-parts">${parts.map((p,i)=>`<span class="${pr.partSolved?.[i]?'is-done':i===active?'is-active':''}">${h.esc(T('unified.social.corridor.part','Part {n}',{n:i+1}))} · ${h.esc(TEMPLATES[p.template]?.name||p.template)}${pr.partSolved?.[i]?' '+h.esc(T('unified.social.corridor.solved','Solved')):''}</span>`).join('')}</div>${part?puzzleConsole({template:part.template,board:pr.boards?.[index],params:part.params,prefix:`corridor-${pr.floorIdx}-${index}`,actionPrefix:'corridor',canSolve:canSolve&&index===active},h):''}<div class="gp-crd-ledger"><span>${h.esc(T('unified.social.corridor.elapsed','Total time'))} <b>${clock(pr.totalTimeMs)}</b></span><span>${h.esc(T('unified.social.corridor.penalty','Floor penalty'))} <b>${clock(pr.penaltyMs)}</b></span></div><div class="mg-hints">${hintsFor(pr).map(text=>h.note(text)).join('')}</div></section>`;
}
function corridorLadder(g,h) {
  const data=h.draft('corridor-ladder-result',null),rows=list(data?.entries);
  return `<details class="mg-history"><summary>${h.esc(T('unified.social.corridor.ladderTitle','Daily leaderboard · ranked by floors and time'))}</summary><label class="m-label">${h.esc(T('unified.social.corridor.ladderDate','Date'))}<input class="m-input" type="date" data-mg-draft="corridor-ladder-day" value="${h.esc(h.draft('corridor-ladder-day',g.day))}"></label>${h.actionRow(h.button(T('unified.social.corridor.query','View leaderboard'),'corridor-ladder'))}${data?`${h.note(T('unified.social.corridor.entries','{day} · {count} results',{day:data.day||g.day,count:rows.length}))}${rows.map(row=>`<article class="mg-result"><b>#${h.num(row.rank)} ${h.esc(row.squadName)}</b><p>${h.esc(T('unified.social.corridor.floors','{count} floors',{count:h.num(row.floors)}))} · ${clock(row.timeMs)} · ${h.esc(row.format==='sprint'?T('unified.social.corridor.sprintName','Mirror Sprint'):T('unified.social.corridor.towerName','Eight-floor tower'))}</p><small>${h.esc(list(row.members).join(' / '))} · ${h.esc(REASONS[row.finishReason]||row.finishReason)}</small></article>`).join('')||h.note(T('unified.social.corridor.noResults','No completed runs on this day.'))}`:h.note(T('unified.social.corridor.queryHint','Query to see recorded results.'))}</details>`;
}
function renderCorridor(g,ctx,h) {
 const view=corridorView(g,ctx,h),{priv,sprint,pr,canSolve}=view,rules=g.rules||{},confirmation=h.draft('corridor-confirm',''),max=h.num(rules.maxFloors,list(g.floors).length);
 const progress=list(g.squads).map(squad=>{
  const p=sprint?squad.hud:squad.progress;if(!p)return '';
  const floor=sprint?p.floor:h.num(p.floorIdx)+1,time=sprint?p.elapsedMs:p.totalTimeMs;
  return `<article class="${squad.id===view.mine?.id?'is-mine':''}"><small>${squad.id===view.mine?.id?T('unified.social.corridor.mySquad','My squad'):T('unified.social.corridor.otherSquad','Opposing squad')}</small><b>${h.esc(squad.name)}</b><div><strong>${h.num(p.floorsCleared)}<small> / ${max}</small></strong><span>${clock(time)}</span></div><progress max="${max}" value="${h.num(p.floorsCleared)}" aria-label="${h.esc(T('unified.social.corridor.progress','{name} progress',{name:squad.name}))}"></progress><p>${p.finished?h.esc(REASONS[p.finishReason]||p.finishReason):T('unified.social.corridor.onFloor','On floor {floor}',{floor:h.num(floor)})}</p></article>`;
 }).join('');
 const overdue=g.status==='playing'&&(pr&&!pr.finished&&h.num(pr.floorDeadline)>0&&Date.now()>h.num(pr.floorDeadline)||!sprint&&list(g.squads).some(s=>s.progress&&!s.progress.finished&&Date.now()>h.num(s.progress.floorDeadline)));
 let html=`<div class="gp-corridor-world" data-world-role="${view.mine?'climber':'spectator'}">${h.heading(sprint?T('unified.social.corridor.sprintName','Mirror Sprint'):T('unified.social.corridor.title','Endless Corridor'),`${g.day||''} · ${g.mode==='tourney'?T('unified.social.corridor.tournament','Tournament'):T('unified.social.corridor.practice','Free practice')}`)}<section class="gp-crd-scene"><img src="/game-packs/corridor/scene.webp" alt="${h.esc(T('unified.social.corridor.sceneAlt','A lamp-lit puzzle corridor'))}"><div><small>${sprint?T('unified.social.corridor.sprintTag','Two squads · three-floor race'):T('unified.social.corridor.towerTag','Daily puzzle tower · eight floors')}</small><strong>${pr?.finished?T('unified.social.corridor.journeyEnd','Journey complete'):T('unified.social.corridor.climb','Climb on and solve the next puzzle.')}</strong><span>${sprint?T('unified.social.corridor.firstWins','First to clear wins · no skips'):T('unified.social.corridor.clearedCount','Cleared {count} / {max} floors',{count:h.num(pr?.floorsCleared),max})}</span></div></section>`;
 const overview=`<ol class="gp-crd-route" aria-label="${h.esc(T('unified.social.corridor.route','Floor route'))}">${list(g.floors).map((floor,i)=>{const done=pr?.log?.some(log=>log.floor===i+1&&log.ok),skipped=pr?.log?.some(log=>log.floor===i+1&&log.skipped),current=pr&&!pr.finished&&pr.floorIdx===i;return `<li class="${done?'is-done':skipped?'is-skipped':current?'is-current':''}" aria-label="${h.esc(T('unified.social.corridor.floorStatus','Floor {floor}: {name} · {status}',{floor:i+1,name:floorName(floor.label),status:done?T('unified.social.corridor.cleared','Cleared'):skipped?T('unified.social.corridor.skipped','Skipped'):current?T('unified.social.corridor.current','Current'):T('unified.social.corridor.ahead','Ahead')}))}"><img src="/assets/games/corridor/floor-${i+1}.svg" alt=""><b>${i+1}</b><span>${h.esc(done?T('unified.social.corridor.cleared','Cleared'):skipped?T('unified.social.corridor.skipped','Skipped'):current?T('unified.social.corridor.current','Current'):T('unified.social.corridor.ahead','Ahead'))}</span></li>`;}).join('')}</ol><div class="gp-crd-teams">${progress}</div>`;
 if(sprint&&rules.raceWinner)html+=h.note(T('unified.social.corridor.winnerLocked','Winner: {name}. Other squads may finish and record their results.',{name:list(g.squads).find(s=>s.id===rules.raceWinner)?.name||T('unified.social.corridor.leadingSquad','Leading squad')}));
 html+=corridorFloor(g,view,h);
 if(canSolve){
  html+=`<div class="gp-crd-tools">${h.button(T('unified.social.corridor.hint','Hints left: {count} (+{seconds}s)',{count:h.num(priv.hintsLeft),seconds:h.num(rules.hintPenaltyMs,sprint?5000:10000)/1000}),'corridor-hint','',h.num(priv.hintsLeft)<=0)}<details><summary>${h.esc(T('unified.social.corridor.more','More actions'))}</summary>${!sprint?h.button(T('unified.social.corridor.skip','Skip floor · {count} left (+{seconds}s)',{count:h.num(priv.skipsLeft),seconds:h.num(rules.skipPenaltyMs,45000)/1000}),'corridor-skip','',h.num(priv.skipsLeft)<=0):''}${h.button(T('unified.social.corridor.endClimb','End this climb'),'corridor-surrender')}</details></div>`;
  if(['skip','surrender'].includes(confirmation))html+=inlineConfirm('corridor',confirmation,confirmation==='skip'?T('unified.social.corridor.skipConfirm','A skipped floor does not count as cleared, adds a time penalty and uses one skip. Continue?'):T('unified.social.corridor.endConfirm','Ending settles your squad’s result immediately. Continue?'),h);
 }
 html+=overview;
 if(overdue)html+=h.actionRow(h.button(T('unified.social.corridor.settle','Settle timed-out squads'),'corridor-settle','',false,true));
 if(g.status==='finished')html+=`<section class="mg-result"><span>${h.esc(T('unified.social.corridor.report','Climb report'))}</span><h3>${h.esc(g.result?.winner?T('unified.social.corridor.wins','{name} wins',{name:g.result.winnerName||list(g.squads).find(s=>s.id===g.result.winner)?.name||''}):list(g.squads).length===2?T('unified.social.corridor.draw','Draw'):T('unified.social.corridor.practiceDone','Practice complete'))}</h3>${h.actionRow(h.button(T('unified.social.corridor.rematch','Climb again'),'corridor-rematch','',false,true))}${confirmation==='rematch'?inlineConfirm('corridor','rematch',T('unified.social.corridor.rematchConfirm','The next climb costs {fee} T per human. Continue?',{fee:h.num(rules.entryFee,20)}),h):''}</section>`;
 const logs=pr?list(pr.log):[];
 html+=`<details class="mg-history"><summary>${h.esc(T('unified.social.corridor.history','Squad history and fairness check'))}</summary>${logs.map(entry=>`<article><h3>${h.esc(T('unified.social.corridor.floor','Floor {floor}',{floor:h.num(entry.floor)}))} · ${h.esc(floorName(entry.label))}</h3>${h.note(`${entry.ok?T('unified.social.corridor.cleared','Cleared'):entry.skipped?T('unified.social.corridor.skipped','Skipped'):T('unified.social.corridor.ended','Ended')} · ${clock(entry.ms)}`)}${entry.ok?list(entry.reveal).map(reveal=>revealHtml(reveal,h)).join(''):''}</article>`).join('')||h.note(T('unified.social.corridor.historyEmpty','Cleared floors show their solutions and commitment checks here.'))}<p>${h.esc(T('unified.social.corridor.commit','Public tower seed {seed} · commitment {hash}',{seed:g.towerSeed||'',hash:g.commitHash||''}))}</p></details>`;
 if(g.mode==='tourney')html+=h.note(sprint?T('unified.social.corridor.sprintFee','Entry {fee} T per human; winning humans share {percent}% of the pool.',{fee:h.num(rules.entryFee,20),percent:h.num(rules.prizePct,.9)*100}):T('unified.social.corridor.towerFee','Entry {fee} T per human; clear all for {full} T back, floors 5–7 for {mid} T, fewer than 5 for no refund.',{fee:h.num(rules.entryFee,20),full:h.num(rules.refundTiers?.FULL,28),mid:h.num(rules.refundTiers?.MID,18)}));
 return html+corridorLadder(g,h)+'</div>';
}
export function render(detail,ctx,h){return renderCorridor(detail.state.game,ctx,h);}
export async function handleAction(root,detail,ctx,action,data,h){
 const g=gameOf(detail);
  if(g?.kind==='corridor'&&String(action).startsWith('corridor-')){
    const view=corridorView(g,ctx,h),{pr,priv,canSolve,floor,active}=view;
    const part=floor?.parts?.[active],board=pr?.boards?.[active],prefix=`corridor-${pr?.floorIdx}-${active}`;
    if(action==='corridor-cancel'){h.setDraft('corridor-confirm','');h.rerender();return true;}
    if(action==='corridor-ladder'){
      const day=String(h.draft('corridor-ladder-day',g.day));
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){message(ctx,T('unified.social.corridor.invalidDate','Choose a valid leaderboard date'));return true;}
      const result=await h.send({type:'ladder',day});
      if(result&&typeof result==='object'&&Array.isArray(result.entries)){h.setDraft('corridor-ladder-result',result);h.rerender();}return true;
    }
    if(action==='corridor-rematch'&&g.status==='finished'){
      if(g.mode==='tourney'){h.setDraft('corridor-confirm','rematch');h.rerender();}else await h.write('rematch');return true;
    }
    if(action==='corridor-confirm-rematch'){
      if(g.status==='finished'&&h.draft('corridor-confirm')==='rematch')await h.write('rematch');return true;
    }
    if(action==='corridor-settle'){
      const expired=pr&&!pr.finished&&h.num(pr.floorDeadline)>0&&Date.now()>h.num(pr.floorDeadline)||!view.sprint&&list(g.squads).some(s=>s.progress&&!s.progress.finished&&Date.now()>h.num(s.progress.floorDeadline));
      if(g.status==='playing'&&expired)await h.send({type:'settle'});return true;
    }
    if(handleCipherSelection(action,data,{template:part?.template,board,params:part?.params,prefix,actionPrefix:'corridor',canSolve},h))return true;
    if(!canSolve)return true;
    if(action==='corridor-toggle'){
      const count=part?.template==='lights'?list(board?.cells).length:part?.template==='pipes'?list(board?.masks).length:0;
      if(integer(data.mgIndex,0,count-1))await h.send({type:'toggle',idx:Number(data.mgIndex)});return true;
    }
    if(action==='corridor-guess'){
      const seq=part?.template==='cipher'?cipherInput({...part,board},prefix,h):null;
      if(seq)await h.send({type:'guess',seq},seq.map((_,i)=>`${prefix}-cipher-${i}`));else message(ctx,T('unified.social.corridor.invalidSequence','Enter a complete valid colour sequence'));return true;
    }
    if(action==='corridor-hint'){if(h.num(priv.hintsLeft)>0)await h.send({type:'hint'});return true;}
    if(action==='corridor-skip'||action==='corridor-surrender'){
      const choice=action==='corridor-skip'?'skip':'surrender';
      if(choice==='surrender'||!view.sprint&&h.num(priv.skipsLeft)>0){h.setDraft('corridor-confirm',choice);h.rerender();}return true;
    }
    if(action==='corridor-confirm-skip'||action==='corridor-confirm-surrender'){
      const type=action==='corridor-confirm-skip'?'skip':'surrender';
      if(h.draft('corridor-confirm')===type&&(type==='surrender'||!view.sprint&&h.num(priv.skipsLeft)>0))await confirmedSend(h,'corridor-confirm',{type});return true;
    }
    return false;
  }

 return false;
}
