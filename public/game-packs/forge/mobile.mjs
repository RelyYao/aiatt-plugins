// SPDX-License-Identifier: Apache-2.0
import {puzzleConsole,handleCipherSelection} from '../shared/puzzle-console.mjs';
import {T} from '../shared/mobile-ui.mjs';
import {revealedHints,TEMPLATES,REASONS,list,gameOf,squadOf,clock,integer,selectedTemplate,message,puzzleParamsHtml,collectParams,puzzleBoardHtml,cipherInput,revealHtml,inlineConfirm,confirmedSend} from '../shared/puzzle-tools.mjs';
function forgePrivate(g,ctx,h) {
 const p=h.privateView(),mine=squadOf(g,ctx.me?.id);if(!p)return null;
 if(mine)return p.mySquadId===mine.id?p:null;
 return p.mySquadId==null&&!p.canForge&&!p.canChallenge&&!p.canSolve?p:null;
}
function forgeLevels(g,priv) {
  const rows=[...list(priv?.arena),...list(priv?.mine),g.level,priv?.level].filter(Boolean);
  return [...new Map(rows.map(level=>[level.id,level])).values()];
}
function challengeFee(g,priv,h) {return priv?.my?.freeDaily?.used===false?0:h.num(g.rules?.challengeFee??priv?.rules?.challengeFee,5);}
function canChallenge(g,priv,level,h) {
  return !!priv?.canChallenge&&g.status==='playing'&&!g.attempt&&!!level&&level.status!=='closed'&&priv.mySquadId!==level.bySquadId&&(challengeFee(g,priv,h)===0||h.num(priv.my?.balance)>=challengeFee(g,priv,h));
}
function forgeCard(level,g,priv,h) {
 const own=priv?.mySquadId===level.bySquadId,fee=challengeFee(g,priv,h),rate=level.passRate==null?T('fgm.noRecord','No record yet'):`${Math.round(h.num(level.passRate)*100)}%`,template=TEMPLATES[level.template]?level.template:'lights';
 return `<article class="gp-fg-card"><div class="gp-fg-card-top"><img src="/assets/games/forge/tpl-${template}.svg" alt=""><span>${h.esc(TEMPLATES[template].name)}<small>${h.esc(T('pz.difficulty','Difficulty'))} ${h.num(level.difficulty)}${own?' · '+h.esc(T('fg.yours','Your level')):''}</small></span></div><h3>${h.esc(level.title||T('fgm.untitled','Untitled level'))}</h3><p>${h.esc(T('fg.by','by {name}',{name:level.byName||T('game.player','Player')}))}</p><div class="gp-fg-card-stats"><div><strong>${h.esc(rate)}</strong><small>${h.esc(T('fg.passRate','Pass rate'))}</small></div><div><b>${h.num(level.stats?.attempts)}</b><small>${h.esc(T('fgm.attempts','Attempts'))}</small></div>${level.sweet?`<span>${h.esc(T('fg.sweet','Sweet spot'))}</span>`:''}</div>${own?`<p class="gp-fg-owned">${h.esc(T('fgm.ownLevel','Other squads challenge your own levels.'))}</p>`:h.actionRow(h.button(fee===0?T('fgm.freeChallenge','Free first challenge today'):T('fgm.challengeFee','Challenge · {fee} T Coins',{fee}),'forge-challenge',` data-mg-level="${h.esc(level.id)}"`,!canChallenge(g,priv,level,h),true))}<details class="gp-fg-card-fairness"><summary>${h.esc(T('fgm.check','Level check'))}</summary><code>${h.esc(level.commitHash||T('fgm.pending','Syncing'))}</code></details></article>`;
}
function renderForge(g,ctx,h) {
 if(g.result?.reason==='workshop-closed')return `<section class="mg-result gp-fg-result"><h3>${h.esc(T('unified.trust.closed','The host closed the workshop. Published levels remain available.'))}</h3>${h.actionRow(h.button(T('game.rematch','Play again'),'forge-rematch','',false,true))}</section>`;
 const priv=forgePrivate(g,ctx,h),template=selectedTemplate(h,'forge'),canForge=!!priv?.canForge&&g.status==='playing'&&!g.attempt,at=g.attempt;
 const canSolve=!!priv?.canSolve&&priv.mySquadId===at?.squadId&&g.status==='playing'&&!!at;
 const pending=h.draft('forge-confirm',''),level=forgeLevels(g,priv).find(l=>l.id===pending),selected=h.draft('forge-tab','workshop'),tab=['workshop','arena','mine'].includes(selected)?selected:'workshop';
 const fee=challengeFee(g,priv,h),balance=priv?.my?.balance,meta=TEMPLATES[template];
 let html=`<div class="gp-forge-world" data-world-role="${!priv?'syncing':canSolve?'challenger':priv.mySquadId?'forger':'spectator'}">${h.heading(T('fg.title','Forge Arena'),at?T('fgm.inProgress','Challenge in progress · crack their puzzle'):T('fgm.tagline','Turn a clever idea into a challenge for the table'))}<section class="gp-fg-scene"><img src="/game-packs/forge/scene.webp" alt="${h.esc(T('fgm.sceneAlt','Brass puzzle workbench'))}"><div><small>${h.esc(at?T('fgm.attacking','Challenging'):T('fg.workshop','Workshop'))}</small><strong>${at?h.esc(g.level?.title||T('fgm.current','Current level')):h.esc(T('fgm.idea','A clever idea, ready to build.'))}</strong><span>${priv?h.esc(T('fgm.ladderScore','Builder ladder {score}',{score:h.num(priv.my?.forgeScore)}))+(balance!=null?' · '+h.esc(T('fgm.balance','Squad balance {count} T Coins',{count:h.num(balance)})):''):h.esc(T('fgm.syncing','Syncing squad and arena…'))}</span></div></section>`;
 if(g.result){
  const rec=list(g.history).at(-1),solved=rec?.solved??g.result.solved;
  html+=`<section class="mg-result gp-fg-result" aria-label="${h.esc(T('fgm.lastResult','Latest challenge result'))}"><span>${h.esc(T('fgm.report','Latest report'))}</span><h3>“${h.esc(rec?.title||g.result.title||T('fgm.thisChallenge','This challenge'))}” ${h.esc(solved?T('pz.solved','Solved'):T('fgm.ended','Challenge over'))}</h3>${rec?`<article><p><b>${h.esc(rec.squadName)}</b> · ${h.num(rec.solveSec)}s${!solved?' · '+h.esc(REASONS[rec.reason]||rec.reason||T('fgm.settled','Settled')):''}</p><div>${h.esc(T('fgm.payouts','Challenger +{c} T Coins · builder +{f} T Coins',{c:h.num(rec.payouts?.challenger),f:h.num(rec.payouts?.forger)}))}${rec.ladder?` · ${h.esc(T('fg.ladder','Ladder'))} ${h.num(rec.ladder.gained)>=0?'+':''}${h.num(rec.ladder.gained)}`:''}${h.num(rec.refunded)>0?` · ${h.esc(T('fgm.refunded','{count} T Coins refunded',{count:h.num(rec.refunded)}))}`:''}</div>${revealHtml(rec.reveal,h)}</article>`:''}${g.status==='finished'?h.actionRow(h.button(T('fgm.rematch','Back into the arena'),'forge-rematch','',false,true)):''}</section>`;
 }

 if(at){
  const board=at.board||{},kind=g.level?.template||(Array.isArray(board.guesses)?'cipher':Array.isArray(board.cells)?'lights':'pipes'),remaining=Math.max(0,h.num(at.hintsMax??g.rules?.hintsPerAttempt,2)-h.num(at.hintsUsed));
  html+=`<section class="gp-fg-challenge">${h.heading(T('fgm.challengeTitle','Challenge · {title}',{title:g.level?.title||T('fgm.current','Current level')}),`${at.squadName||T('fgm.squad','Challenging squad')} · ${at.free?T('fgm.free','Free this time'):T('fgm.paid','Paid {count} T Coins',{count:h.num(at.charged)})}`,at.solveEndsAt)}${!canSolve?h.note(!priv||priv.mySquadId===at.squadId?T('unified.social.forge.syncPermission','Syncing your identity and permissions…'):T('fgm.spectator','Spectating · only the challenging squad can touch the board.')):''}${puzzleConsole({template:kind,board,params:g.level?.params,prefix:`forge-${at.levelId}`,actionPrefix:'forge',canSolve},h)}<div class="mg-hints">${revealedHints(at).map(text=>h.note(text)).join('')}</div>${canSolve?`<div class="gp-fg-tools">${h.button(T('fgm.hint','Hint · {left} left',{left:remaining}),'forge-hint','',remaining<=0)}<details><summary>${h.esc(T('fgm.more','More actions'))}</summary>${h.button(T('fgm.giveUp','Give up the challenge'),'forge-giveup')}</details></div>`:''}${canSolve&&pending==='giveup'?inlineConfirm('forge','giveup',T('fgm.confirmGiveUp','Give up? The fee is not refunded and the level counts as defended.'),h):''}${g.status==='playing'&&h.num(at.solveEndsAt)>0&&Date.now()>h.num(at.solveEndsAt)?h.actionRow(h.button(T('fgm.settle','Settle the timed-out challenge'),'forge-settle','',false,true)):''}</section>`;
 }else{
  html+=`<nav class="gp-fg-tabs" aria-label="${h.esc(T('fg.title','Forge Arena'))}">${[['workshop',T('fg.workshop','Workshop')],['arena',T('fg.arena','Arena')],['mine',T('fgm.mine','My levels')]].map(([key,title])=>h.button(title,'forge-tab',` data-mg-tab="${key}" aria-pressed="${tab===key}"`)).join('')}</nav>`;
  if(tab==='workshop'){
   const shape=template==='lights'?`${h.draft('forge-size',4)}×${h.draft('forge-size',4)}`:template==='pipes'?`${h.draft('forge-cols',4)}×${h.draft('forge-rows',4)}`:T('fgm.shapeCipher','{len} slots · {colors} colours',{len:h.draft('forge-length',4),colors:h.draft('forge-colors',5)});
   html+=`<section class="gp-fg-workshop"><header><span>01</span><div><small>${h.esc(T('fgm.pick','Pick a puzzle'))}</small><h3>${h.esc(T('fgm.start','Start with a good idea'))}</h3></div></header><div class="gp-fg-templates">${Object.entries(TEMPLATES).map(([key,info])=>`<button type="button" data-mg-action="forge-template" data-mg-template="${key}" aria-pressed="${key===template}"${canForge?'':' disabled'}><img src="/assets/games/forge/tpl-${key}.svg" alt=""><b>${h.esc(info.name)}</b><small>${h.esc({lights:T('fgm.hint.lights','One tap moves four neighbours'),pipes:T('fgm.hint.pipes','Rotate until the pipes connect'),cipher:T('fgm.hint.cipher','Logic in colour')}[key])}</small></button>`).join('')}</div><div class="gp-fg-blueprint"><img src="/assets/games/forge/tpl-${template}.svg" alt=""><div><small>${h.esc(T('fgm.spec','Current spec'))}</small><strong>${h.esc(shape)}</strong><span>${h.esc(meta.name)}</span></div></div><header><span>02</span><div><small>${h.esc(T('fgm.tune','Fine-tune'))}</small><h3>${h.esc(T('fgm.tuneTitle','Land the difficulty just right'))}</h3></div></header><div class="mg-form-row">${puzzleParamsHtml(template,'forge',h,{disabled:!canForge})}</div><label class="m-label">${h.esc(T('fgm.titleLabel','Level title (optional)'))}<input class="m-input" data-mg-draft="forge-title" maxlength="${h.num(g.rules?.titleMax,24)}" value="${h.esc(h.draft('forge-title',''))}" placeholder="${h.esc(T('fgm.titlePlaceholder','Give your idea a name'))}"${canForge?'':' disabled'}></label><details class="gp-fg-advanced"><summary>${h.esc(T('fgm.advanced','Advanced · fixed level'))}</summary><label class="m-label">${h.esc(T('fgm.seed','Fixed seed (optional, 1–2147483647)'))}<input class="m-input" type="number" min="1" max="2147483647" step="1" data-mg-draft="forge-seed" value="${h.esc(h.draft('forge-seed',''))}"${canForge?'':' disabled'}></label><p>${h.esc(T('fgm.seedNote','Leave blank for random. A fixed value reproduces the same puzzle.'))}</p></details>${h.note(T('fgm.publishNote','The platform checks the puzzle is solvable before it goes live. A sweet-spot pass rate earns builder ladder points.'))}${h.actionRow(h.button(T('fg.publish','Verify and publish to the arena'),'forge-publish','',!canForge,true))}${!canForge?h.note(priv?T('fgm.cannot','Your role or this mode can\'t build levels.'):T('fgm.syncFee','Syncing your role and fees, try again shortly.')):''}</section>`;
  }else{
   const rows=tab==='mine'?list(priv?.mine):list(priv?.arena);
   html+=`<section class="gp-fg-list"><header><div><small>${h.esc(tab==='mine'?T('fgm.myWork','My work'):T('fgm.theirWork','From the table'))}</small><h3>${h.esc(tab==='mine'?T('fgm.myWorkTitle','Every puzzle you built.'):T('fgm.theirWorkTitle','Pick a puzzle and try your hand.'))}</h3></div><span>${h.esc(T('fgm.levels','{count} levels',{count:rows.length}))}</span></header>${tab==='arena'?h.note(priv?(priv.my?.freeDaily?.used?T('fgm.freeUsed','Free challenge used today'):T('fg.freeToday','Free today'))+'; '+T('fgm.feeNote','then {fee} T Coins each. Each squad can challenge a level once a day.',{fee:h.num(g.rules?.challengeFee,5)}):T('fgm.syncArena','Syncing the arena and live fees…')):''}${rows.map(row=>forgeCard(row,g,priv,h)).join('')||`<div class="gp-fg-empty"><img src="/assets/games/forge/shield-defend.svg" alt=""><h3>${h.esc(tab==='mine'?T('fgm.emptyMine','Your first puzzle is waiting.'):T('fgm.emptyArena','The arena is waiting for its first builder.'))}</h3><p>${h.esc(tab==='mine'?T('fgm.emptyMineNote','Verified and published levels stay here.'):T('fgm.emptyArenaNote','Head to the Workshop and leave a challenge for the table.'))}</p>${h.button(T('fgm.build','Build a puzzle'),'forge-tab',' data-mg-tab="workshop"')}</div>`}</section>`;
  }
 }
 if(level&&pending!=='giveup'&&canChallenge(g,priv,level,h))html+=inlineConfirm('forge','challenge',T('fg.confirmChallenge','Challenge “{title}”? {quote} Once per level per day.',{title:level.title,quote:fee===0?T('fg.quoteFree','This uses your free challenge for today.'):T('fg.quotePaid','Pay {count} T Coins. The fee is not refunded.',{count:fee})}),h,` data-mg-level="${h.esc(level.id)}"`);
 html+=`<details class="mg-history"><summary>${h.esc(T('fgm.rulesTitle','Rewards and fairness check'))}</summary>${h.note(T('fgm.rules','Paid run solved: challenger +{c} T Coins, builder +{f} T Coins; unsolved: builder +{u} T Coins. Free runs follow the actual settlement.',{c:h.num(g.rules?.payout?.SOLVED?.challenger,3),f:h.num(g.rules?.payout?.SOLVED?.forger,1),u:h.num(g.rules?.payout?.FAILED?.forger,4)}))}${g.level?.commitHash?`<code>${h.esc(g.level.commitHash)}</code>`:''}<p>${h.esc(T('fgm.revealLater','Solution, seed and checks are revealed after the challenge.'))}</p></details>`;
 return html+'</div>';
}
export function render(detail,ctx,h){return renderForge(detail.state.game,ctx,h);}
export async function handleAction(root,detail,ctx,action,data,h){
 const g=gameOf(detail);
  if(g?.kind==='forge'&&String(action).startsWith('forge-')){
    const priv=forgePrivate(g,ctx,h),at=g.attempt,canForge=!!priv?.canForge&&g.status==='playing'&&!at,canSolve=!!priv?.canSolve&&priv.mySquadId===at?.squadId&&g.status==='playing'&&!!at;
    if(action==='forge-tab'){if(!at&&['workshop','arena','mine'].includes(data.mgTab)){h.setDraft('forge-tab',data.mgTab);h.rerender();}return true;}
    if(action==='forge-cancel'){h.setDraft('forge-confirm','');h.rerender();return true;}
    if(action==='forge-template'){
      if(canForge&&TEMPLATES[data.mgTemplate]){h.setDraft('forge-template',data.mgTemplate);h.rerender();}return true;
    }
    if(action==='forge-publish'){
      if(!canForge)return true;
      const template=selectedTemplate(h,'forge'),params=collectParams(template,'forge',h),rawSeed=String(h.draft('forge-seed','')).trim();
      if(!params||rawSeed&&!integer(rawSeed,1,2147483647)){message(ctx,T('fgm.checkParams','Check the parameters and the fixed seed range'));return true;}
      await h.send({type:'forge',template,params,title:String(h.draft('forge-title','')).trim(),...(rawSeed?{seed:Number(rawSeed)}:{})},['forge-title']);return true;
    }
    if(action==='forge-challenge'||action==='forge-confirm-challenge'){
      const level=forgeLevels(g,priv).find(row=>row.id===data.mgLevel);
      if(!canChallenge(g,priv,level,h))return true;
      if(action==='forge-challenge'){h.setDraft('forge-confirm',level.id);h.setDraft('forge-confirm-fee',challengeFee(g,priv,h));h.rerender();}
      else if(h.draft('forge-confirm')===level.id){
        if(h.draft('forge-confirm-fee',null)!==challengeFee(g,priv,h)){h.setDraft('forge-confirm','');message(ctx,T('fgm.feeChanged','Your free challenge or the fee changed. Choose and confirm again.'));h.rerender();return true;}
        await confirmedSend(h,'forge-confirm',{type:'challenge',levelId:level.id,expectedCharge:h.draft('forge-confirm-fee')});
      }return true;
    }
    if(action==='forge-rematch'){if(g.status==='finished')await h.write('rematch');return true;}
    if(action==='forge-settle'){if(g.status==='playing'&&at&&h.num(at.solveEndsAt)>0&&Date.now()>h.num(at.solveEndsAt))await h.send({type:'settle'});return true;}
    if(handleCipherSelection(action,data,{template:g.level?.template||(Array.isArray(at?.board?.guesses)?'cipher':''),board:at?.board,params:g.level?.params,prefix:`forge-${at?.levelId}`,actionPrefix:'forge',canSolve},h))return true;
    if(!canSolve)return true;
    if(action==='forge-toggle'){
      const count=Array.isArray(at.board?.cells)?at.board.cells.length:Array.isArray(at.board?.masks)?at.board.masks.length:0;
      if(integer(data.mgIndex,0,count-1))await h.send({type:'toggle',idx:Number(data.mgIndex)});return true;
    }
    if(action==='forge-guess'){
      const prefix=`forge-${at.levelId}`,seq=Array.isArray(at.board?.guesses)?cipherInput({board:at.board},prefix,h):null;
      if(seq)await h.send({type:'guess',seq},seq.map((_,i)=>`${prefix}-cipher-${i}`));else message(ctx,T('fgm.needSeq','Fill in a complete, valid colour sequence'));return true;
    }
    if(action==='forge-hint'){if(h.num(at.hintsUsed)<h.num(at.hintsMax??g.rules?.hintsPerAttempt,2))await h.send({type:'hint'});return true;}
    if(action==='forge-giveup'){h.setDraft('forge-confirm','giveup');h.rerender();return true;}
    if(action==='forge-confirm-giveup'){if(h.draft('forge-confirm')==='giveup')await confirmedSend(h,'forge-confirm',{type:'giveup'});return true;}
    return false;
  }
 return false;
}
