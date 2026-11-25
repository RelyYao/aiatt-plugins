// SPDX-License-Identifier: Apache-2.0
import {executionHtml,seatSourceHtml,openReceipt} from '../shared/spy-experience.mjs';
import {e,list,num,button,note,actionRow,isOwner,attr,T} from '../shared/mobile-ui.mjs';
// Brand v3 manor: a top-down round table, my team always at the bottom seat.
// Nothing here depends on the clock, so a poll with no news leaves the HTML (and its animations) alone;
// games.mjs fills [data-mg-deadline] (text, or --mg-left on a timer ring) right after each render.
const canHost=(d,ctx)=>isOwner(d,ctx)||!!(d.room?.quickMatch&&d.room?.ownerId==='_platform'&&!ctx.me?.isAgent&&!ctx.me?.isBot&&list(d.room?.members).includes(ctx.me?.id));
const contentLanguage=g=>{const v={'zh-CN':['unified.social.locale.zhCN','Simplified Chinese'],'zh-TW':['unified.social.locale.zhTW','Traditional Chinese'],'en':['unified.social.locale.en','English']}[g.contentLocale];return v?T('unified.social.contentLanguageValue','Game content language: {language}',{language:T(v[0],v[1])}):'';};
function view(d,ctx,h){const g=d.state.game,seats=list(g.seats),mine=seats.find(s=>list(s.members).some(m=>m.id===ctx.me?.id)||s.id===ctx.me?.id),raw=h.privateView();return{g,seats,mine,priv:mine&&raw&&!raw.spectator&&raw.seatNo===(mine.no||seats.indexOf(mine)+1)?raw:null};}
// Covering the word card is a per-device courtesy (someone looking over a shoulder), never sent anywhere.
const covered=new Set(),coverKey=(d,g)=>`${d.room?.id||''}:${g.matchId||''}`;
// Moments seen per match: the first render of a match only records them (no replayed sounds when a room opens).
// The room screen plays the turn, win and lose cues itself; this table only adds deal, vote and reveal (ctx.sfx:
// packs import nothing outside their own folder and game-packs/shared).
const moments=new Map();
function news(g,keys){
 const id=g.matchId||'';let seen=moments.get(id);const first=!seen;
 if(first){if(moments.size>20)moments.delete(moments.keys().next().value);seen=new Set();moments.set(id,seen);}
 const fresh=new Set(keys.filter(k=>!seen.has(k)));for(const k of fresh)seen.add(k);return{first,fresh};
}
// Seats read as the people sitting there ("阿梁 · 阿弈"), not the server's English squad label.
const names=s=>s?list(s.members).slice(0,2).map(m=>m.name).join(' · ')||s.name||'':'';
// Round 6 R6-G4: the reveal after a vote (who got how many, who is out, or a tie), and why the match ended with the words.
const seatName=(seats,id)=>names(seats.find(s=>s.id===id))||id;
function revealCard(ctx,g,seats){
  const v=list(g.voteLog).at(-1);if(!v)return '';
  const tally=list(v.tally).map(t=>`<li><b>${e(ctx,seatName(seats,t.squadId)||t.name)}</b><span>${e(ctx,T('spy.reveal.votes','{n} votes',{n:t.n}))}</span></li>`).join('');
  const out=v.outSquadId?list(g.revealLog).find(r=>r.squadId===v.outSquadId):null;
  const head=v.tie?T('spy.reveal.tie','Round {round}: a tie, nobody is out',{round:v.round}):T('spy.reveal.out','Round {round}: {name} is out',{round:v.round,name:seatName(seats,v.outSquadId)});
  const who=out?(out.isSpy?T('spy.reveal.wasSpy','They were the undercover team · their word “{word}”',{word:out.word}):T('spy.reveal.wasCivilian','They were civilians · their word “{word}”',{word:out.word})):'';
  return `<section class="spm-card spm-reveal" role="status"><h3>${e(ctx,head)}</h3><ul>${tally||`<li>${e(ctx,T('spy.reveal.noVotes','Nobody voted'))}</li>`}</ul>${who?`<p>${e(ctx,who)}</p>`:''}</section>`;
}
function endCard(ctx,g,seats){
  if(g.status==='playing'||g.status==='lobby'||!g.result)return '';
  const why={'spies-found':T('spy.end.spiesFound','Every undercover team was voted out.'),'spies-half':T('spy.end.spiesHalf','The undercover teams are half of what is left at the table.'),'round-limit':T('spy.end.roundLimit','The round limit was reached with no decisive vote.'),'spy-left':T('spy.end.spyLeft','The undercover team left the table.'),'civilian-left':T('spy.end.civilianLeft','A civilian team left and the undercover now hold half the table.')}[g.result.reason]||'';
  const words=[...new Set(Object.values(g.wordOf||{}))],spyWord=g.wordOf?.[list(g.spySeats)[0]],civWord=words.find(w=>w!==spyWord);
  return `<section class="spm-card spm-endcard"><h3>${e(ctx,g.result.winner==='draw'?T('spy.end.draw','A draw'):g.result.winner==='spy'?T('unified.social.spy.spyWins','Undercover wins'):T('unified.social.spy.civilianWins','Civilians win'))}</h3>${why?`<p>${e(ctx,why)}</p>`:''}${spyWord?`<p>${e(ctx,T('spy.end.words','Undercover word “{spy}” · civilian word “{civ}”',{spy:spyWord,civ:civWord||'—'}))}</p>`:''}</section>`;
}
const glyph=name=>{const c=[...String(name||'').trim()][0]||'?';return c.toUpperCase();};
const sourceOf=(g,s)=>list(g.execution?.controllers).find(c=>c.squadId===s.id)?.source;
function seatKind(g,s){
 const members=list(s.members);
 if(members.length&&members.every(m=>m.isAgent))return 'ai';
 if(members.length&&!members.some(m=>m.isAgent)&&sourceOf(g,s)==='rule')return 'bot';
 return 'human';
}
const at=(step,count)=>{const angle=Math.PI/2+Math.PI*2*step/count;return{x:50+36*Math.cos(angle),y:50+36*Math.sin(angle)};};
// Upper seats talk above the ring; side and lower seats under the name plate (clear of the seat above them).
// cos/sin leave float noise at the sides, hence 49 rather than 50.
const place=({x,y})=>`${y<49?'is-top':'is-bottom'}${x<30?' is-left':x>70?' is-right':''}`;
function seatHtml(ctx,g,s,i,o){
 const {mine,target,canVote,priv,playing,order,count,said,fresh,control}=o;
 const kind=seatKind(g,s),members=list(s.members),human=members.find(m=>!m.isAgent)||members[0],isMine=s.id===mine?.id;
 const handed=human&&!human.isAgent&&['agent','advise'].includes(control?.[human.id]?.mode)?control[human.id]:null;
 const handedTag=handed?`<span class="spm-handed is-${handed.mode}" title="${e(ctx,handed.mode==='agent'?T('mc.seatAgent','{name} plays this seat',{name:handed.agentName||''}):T('mc.seatAdvise','{name} advises this seat',{name:handed.agentName||''}))}">${e(ctx,handed.mode==='agent'?T('mc.tagAgent','Agent'):T('mc.tagAdvise','Advice'))}</span>`:'';
 const spot=at((order+count)%count,count),{x,y}=spot;
 const speaking=playing&&g.phase==='describe'&&s.id===g.turnSeatId,votable=canVote&&!isMine&&s.alive,picked=target?.id===s.id,voted=priv?.votedSeatId===s.id;
 const rev=list(g.revealLog).find(r=>r.squadId===s.id),word=rev?.word||(!playing&&g.status!=='lobby'?g.wordOf?.[s.id]:''),spy=rev?rev.isSpy:!playing&&list(g.spySeats).includes(s.id);
 const who=names(s),no=s.no||i+1;
 const state=!s.alive?'':isMine?(speaking?T('spy.stateDescribing','Describing'):canVote?(priv?.voted?T('spy.stateVoted','Voted'):T('spy.stateVoting','Voting')):''):speaking?T('spy.speaking','Speaking'):'';
 const plate=word?T('spy.plateReveal','{word} · {role}',{word,role:spy?T('spy.undercover','Undercover'):T('spy.civilian','Civilian')}):!s.alive?T('spy.plateOut','No. {no} · Out',{no}):(isMine?T('spy.plateMine','My team'):who)+(state?' · '+state:'');
 const label=T('spy.seatLabel','Seat {no}: {name}',{no,name:who})+(state?', '+state:'')+(!s.alive?', '+T('spy.out','Out'):'')+(handed?', '+(handed.mode==='agent'?T('mc.seatAgent','{name} plays this seat',{name:handed.agentName||''}):T('mc.seatAdvise','{name} advises this seat',{name:handed.agentName||''})):'');
 const deadline=speaking&&num(g.turnEndsAt)>0?` data-mg-deadline="${num(g.turnEndsAt)}" data-mg-span="${num(g.timeoutPolicy?.describeMs,75000)}"`:'';
 const bubble=said?`<p class="spm-say${said.byIsAgent?' is-ai':''}${said.skipped?' is-skip':''}${fresh.has(said.key)?' is-new':''}"><span>${e(ctx,said.skipped||!said.text?T('spy.skipped','skipped'):said.text)}</span></p>`:'';
 const mark=picked?`<span class="spm-mark${fresh.has('pick:'+s.id)?' is-new':''}">${e(ctx,T('spy.pickMark','Pick'))}</span>`:voted?`<span class="spm-mark is-in">${e(ctx,T('spy.votedHere','Your vote'))}</span>`:'';
 const chair=`<span class="spm-ring${speaking?' is-timer':''}"${deadline}><span class="spm-no">${e(ctx,no)}</span><span class="spm-av is-${kind} t${no%4}">${e(ctx,kind==='ai'?'AI':glyph(human?.name||s.name))}</span>${handedTag}${sourceOf(g,s)&&sourceOf(g,s)!=='human'?seatSourceHtml(g,s.id,{translate:T}):''}</span><span class="spm-plate">${e(ctx,plate)}</span>`;
 const cls=`spm-seat ${place(spot)}${isMine?' is-mine':''}${!s.alive?' is-out':''}${speaking?' is-speaking':''}${picked?' is-picked':''}${voted?' is-voted':''}${word&&spy?' is-spy':''}${rev&&fresh.has('out:'+s.id)?' is-new':''}`;
 const body=votable?`<button type="button" class="spm-chair" data-mg-action="spy-select-vote"${attr(ctx,'mg-seat',s.id)} aria-pressed="${picked}" aria-label="${e(ctx,T('spy.voteSeat','Vote for seat {no}: {name}',{no,name:who}))}">${chair}</button>`:`<div class="spm-chair" role="img" aria-label="${e(ctx,label)}">${chair}</div>`;
 return `<div class="${cls}" style="--x:${x.toFixed(2)}%;--y:${y.toFixed(2)}%" title="${e(ctx,members.map(m=>m.name).join(' / ')||s.name)}">${bubble}${body}${mark}</div>`;
}
export function render(d,ctx,h){
 const {g,seats,mine,priv}=view(d,ctx,h),playing=g.status==='playing',lobby=g.status==='lobby',vote=playing&&g.phase==='vote',describe=playing&&g.phase==='describe';
 const turn=describe&&mine?.alive&&mine.id===g.turnSeatId,canVote=vote&&mine?.alive&&!!priv&&(!g.voteEndsAt||g.voteEndsAt>Date.now());
 const pick=h.selection(),target=pick&&pick.round===g.round?seats.find(s=>s.id===pick.spyVote&&s.alive&&s.id!==mine?.id):null;
 const current=seats.find(s=>s.id===g.turnSeatId),editing=list(priv?.suggestions).find(s=>s.id===h.draft('spy-confirm-id')&&s.action==='describe');
 const spoken=list(g.spoken).map((s,i)=>({...s,key:`said:${s.round}:${i}`})),round=spoken.filter(s=>s.round===g.round);
 const isCovered=covered.has(coverKey(d,g)),word=priv?.word;
 const {first,fresh}=news(g,[...spoken.map(s=>s.key),...list(g.revealLog).map(r=>'out:'+r.squadId),...list(g.voteLog).map(v=>'vote-result:'+v.round),...(word?['deal:'+g.round]:[]),...(vote?['vote:'+g.round]:[]),...(target?['pick:'+target.id+':'+g.round]:[])]);
 if(target&&fresh.has('pick:'+target.id+':'+g.round))fresh.add('pick:'+target.id);
 if(!first&&ctx.moment&&[...fresh].some(k=>k.startsWith('vote-result:'))){const v=list(g.voteLog).at(-1);if(v)ctx.moment({kind:'out',title:v.tie?T('spy.reveal.tieShort','Tie: nobody is out'):T('spy.reveal.outShort','{name} is out',{name:seatName(seats,v.outSquadId)}),sub:list(v.tally).map(t=>`${seatName(seats,t.squadId)} ${t.n}`).join(' · '),sound:'out'});}
 if(!first&&typeof document!=='undefined'){const cue=[...fresh].some(k=>k.startsWith('out:'))?'out':fresh.has('vote:'+g.round)?'vote':word&&fresh.has('deal:'+g.round)&&g.round===1?'deal':'';if(cue&&ctx.sfx)queueMicrotask(()=>ctx.sfx(cue));}
 // Up to six teams every line of this round fits on the table; a fuller table keeps the latest two.
 const talk=new Set(round.filter(x=>x.squadId).map(x=>x.squadId).filter((id,i,a)=>a.lastIndexOf(id)===i).slice(seats.length>6?-2:0));
 const open=lobby?Math.max(0,num(g.rules?.minSeats,4)-seats.length):0,order=Math.max(0,seats.indexOf(mine)),count=Math.max(1,seats.length+open);
 const chairs=seats.map((s,i)=>seatHtml(ctx,g,s,i,{mine,target,canVote,priv,playing,count,order:i-order,fresh,control:d.state?.gameControl||{},said:playing&&talk.has(s.id)?round.filter(x=>x.squadId===s.id).at(-1):null})).join('')
  +Array.from({length:open},(_,i)=>{const spot=at((seats.length+i-order+count)%count,count);return `<div class="spm-seat is-empty ${place(spot)}" style="--x:${spot.x.toFixed(2)}%;--y:${spot.y.toFixed(2)}%"><div class="spm-chair"><span class="spm-ring"><span class="spm-av"></span></span><span class="spm-plate">${e(ctx,T('spy.openSeat','Open seat'))}</span></div></div>`;}).join('');
 const winner=g.result?.winner==='spy'?T('unified.social.spy.spyWins','Undercover wins'):g.result?.winner==='civilian'?T('unified.social.spy.civilianWins','Civilians win'):g.result?.winner==='draw'?T('unified.social.spy.draw','Draw'):T('spy.phase.result','Reveal');
 const banner=lobby?(mine?T('spy.bannerSeated','Seated · waiting for the start'):T('spy.bannerSit','Sit down with your partner')):turn?T('spy.bannerMyTurn','Your team describes now'):describe?T('spy.bannerTurn','{name} is describing',{name:names(current)||T('spy.currentSeat','the current seat')}):vote?(canVote?(priv?.voted?T('spy.bannerVoted','Vote in · you can still change it'):T('spy.bannerVote','Secret vote · tap a seat')):T('spy.bannerVoteWatch','Secret vote in progress')):winner;
 const phase=vote?T('spy.phase.vote','Secret vote'):describe?T('spy.phase.describe','Describing in turn'):lobby?T('spy.phase.waiting','Waiting for players'):T('spy.phase.result','Reveal');
 const top=lobby?T('spy.teamsWaiting','{count} teams waiting',{count:seats.length}):playing?T('spy.roundOf','Round {round} of {max}',{round:num(g.round,1),max:num(g.rules?.roundsMax,5)}):T('game.over','This game is over');
 const deadline=playing?num(vote?g.voteEndsAt:g.turnEndsAt):0;
 const center=`<div class="spm-wood"><div class="spm-center"><small>${e(ctx,top)}</small><b>${e(ctx,phase)}</b>${deadline?`<span class="spm-clock" data-mg-deadline="${deadline}" data-mg-format="mmss"></span>`:vote?'':lobby?`<span class="spm-sub">${e(ctx,T('spy.minSeats','{count}+ teams to start',{count:2}))}</span>`:''}${vote?`<span class="spm-sub">${e(ctx,T('spy.votesIn','{count} / {total} team votes in',{count:num(g.voteCount),total:num(g.aliveCount,seats.filter(s=>s.alive).length)}))}</span>`:''}</div></div>`;
 const table=`<p class="spm-banner${turn||canVote&&!priv?.voted?' is-act':''}" role="status"><i aria-hidden="true"></i>${e(ctx,banner)}</p><section class="spm-round" aria-label="${e(ctx,T('spy.tableLabel','Round table, {count} teams',{count:seats.length}))}" data-seats="${seats.length}">${center}${chairs}</section>`;
 let controls='';
 const reveal=!lobby?(g.status==='playing'?(describe?revealCard(ctx,g,seats):''):endCard(ctx,g,seats)+revealCard(ctx,g,seats)):'';
 const comp=lobby&&mine&&seats.length<2?d.state?.spyCompanion:null;
 if(lobby)controls=`<section class="spm-card spm-lobby">${comp?note(ctx,comp.id?T('spy.soloBring','Only your team is seated. Bring {name} in as the second team and you can start; House Bots fill the rest.',{name:comp.name}):T('spy.soloClaim','Only your team is seated. Invite a friend, or claim a platform AI to be the second team.'))+actionRow(comp.id?button(ctx,T('spy.soloBringButton','Seat {name} as the second team',{name:comp.name}),'spy-companion',attr(ctx,'mg-agent',comp.id)):button(ctx,T('spy.soloClaimButton','Claim a platform AI'),'spy-claim')):''}${note(ctx,T('spy.lobbyShort','You share one seat with your paired agent. Two teams can start.'))}${actionRow(button(ctx,mine?T('spy.leave','Leave seat'):T('spy.sitShort','Sit down'),mine?'spy-leave':'spy-sit','',false,!mine)+(canHost(d,ctx)?button(ctx,T('spy.launch','Start the game'),'spy-launch','',seats.length<2,true):''))}</section>`;
 else if(playing){
  const suggestions=list(priv?.suggestions).filter(s=>s.action===g.phase),latest=suggestions.at(-1),human=!ctx.me?.isAgent;
  const wordCard=mine?`<button type="button" class="spm-word${isCovered?' is-covered':''}${!isCovered&&word&&fresh.has('deal:'+g.round)?' is-new':''}" data-mg-action="spy-cover" aria-pressed="${isCovered}" aria-label="${e(ctx,isCovered?T('spy.showWord','Show my team\'s word'):T('spy.coverWord','Cover my team\'s word'))}">${isCovered?`<b>${e(ctx,T('spy.covered','Covered'))}</b><small>${e(ctx,T('spy.tapShow','Tap to show'))}</small>`:`<small>${e(ctx,T('spy.wordLabel','Team word'))}</small><b>${e(ctx,word||T('spy.dealing','Dealing word cards…'))}</b><small>${e(ctx,T('spy.tapCover','Tap to cover'))}</small>`}</button>`:'';
  let side='';
  const advice=s=>`<p class="spm-advisor"><span class="spm-av is-ai is-sm" aria-hidden="true">${e(ctx,glyph(s.byName))}</span>${e(ctx,T('spy.adviceFrom','{name}\'s suggestion',{name:s.byName||T('spy.partner','Partner')}))}</p>${s.why?`<p class="spm-why">${e(ctx,T('r7.spy.adviceWhy','Why: {why}',{why:s.why}))}</p>`:''}`;
  if(turn&&human&&latest&&!editing)side=`${advice(latest)}<p class="spm-quote">${e(ctx,T('spy.quote','“{text}”',{text:latest.text||''}))}</p>${actionRow(button(ctx,T('spy.sayIt','Say it like this'),'spy-confirm',attr(ctx,'mg-suggestion',latest.id),false,true)+button(ctx,T('spy.editIt','Edit'),'spy-edit-suggestion',attr(ctx,'mg-suggestion',latest.id)))}`;
  else if(turn)side=`<p class="spm-lead">${e(ctx,editing?T('spy.editSuggestion','Edit your partner\'s suggestion, then confirm'):T('spy.describePrompt','Describe your word in one sentence'))}</p><p class="spm-hint">${e(ctx,T('spy.neverSay','Never say the word itself.'))}</p>`;
  else if(describe)side=`<p class="spm-lead">${e(ctx,T('spy.waiting','Waiting for {name} to describe. Listen for details that don\'t quite fit.',{name:names(current)||T('spy.currentSeat','the current seat')}))}</p>${mine?`<p class="spm-hint">${e(ctx,list(priv?.teammates).join(' / ')||T('spy.solo','Playing solo'))}</p>`:''}`;
  else if(vote){
   const suggested=latest&&seats.find(s=>s.id===latest.seat&&s.alive&&s.id!==mine?.id);
   if(canVote&&human&&latest&&!target)side=`${advice(latest)}<p class="spm-quote">${e(ctx,latest.text?T('spy.quote','“{text}”',{text:latest.text}):T('spy.voteFor','Vote for {name}',{name:names(suggested)||latest.targetName||T('spy.thatSeat','that seat')}))}</p>${actionRow(button(ctx,suggested?T('spy.voteNo','Confirm vote for No. {no}',{no:suggested.no||seats.indexOf(suggested)+1}):T('spy.useSuggestion','Use suggestion'),'spy-confirm',attr(ctx,'mg-suggestion',latest.id),false,true))}<p class="spm-hint">${e(ctx,T('spy.orTapSeat','Or tap another seat on the table.'))}</p>`;
   else if(canVote)side=`<p class="spm-lead">${e(ctx,target?T('spy.selected','Selected {name}',{name:names(target)}):T('spy.tapSeat','Tap a suspicious seat. Nothing is sent until you confirm.'))}</p>${actionRow(button(ctx,ctx.me?.isAgent?T('spy.suggestVote','Send vote suggestion'):target?T('spy.voteNo','Confirm vote for No. {no}',{no:target.no||seats.indexOf(target)+1}):T('spy.confirmVote','Confirm vote'),'spy-confirm-vote','',!target,true))}`;
   else side=`<p class="spm-lead">${e(ctx,T('spy.ballotPrivate','Ballots are private to each team. Waiting for the count.'))}</p>`;
  }
  controls+=`<section class="spm-card${mine?'':' is-watch'}">${wordCard}<div class="spm-side">${side}</div></section>`;
  if(turn)controls+=`<fieldset class="spm-composer"${priv?'':' disabled'}><label class="m-label" for="spm-description">${e(ctx,T('spy.yourLine','Your team\'s line'))}</label><textarea id="spm-description" class="m-input" rows="2" maxlength="${num(g.rules?.descLimit,80)}" placeholder="${e(ctx,T('spy.describePlaceholder','Describe your team\'s word in one sentence'))}" data-mg-draft="spy-description">${e(ctx,h.draft('spy-description'))}</textarea>${actionRow(button(ctx,ctx.me?.isAgent?T('spy.suggestDesc','Send description suggestion'):editing?T('spy.confirmDesc','Confirm edited description'):T('spy.submitDesc','Submit description'),ctx.me?.isAgent?'spy-suggest-description':editing?'spy-confirm-edited':'spy-describe','',!priv,true)+(ctx.me?.isAgent?button(ctx,T('spy.describeDirect','Describe for the team'),'spy-describe','',!priv):''))}</fieldset>`;
  if(human&&suggestions.length>1)controls+=`<details class="mg-history"><summary>${e(ctx,T('spy.suggestions','Partner suggestions · {count}',{count:suggestions.length}))}</summary>${suggestions.map(s=>`<div class="spm-suggestion"><small>${e(ctx,s.byName)}</small><p>${e(ctx,s.text||T('spy.voteFor','Vote for {name}',{name:s.targetName||T('spy.thatSeat','that seat')}))}</p>${actionRow(button(ctx,T('spy.useSuggestion','Use suggestion'),'spy-confirm',attr(ctx,'mg-suggestion',s.id))+(s.action==='describe'&&turn?button(ctx,T('spy.editUse','Edit, then use'),'spy-edit-suggestion',attr(ctx,'mg-suggestion',s.id)):''))}</div>`).join('')}</details>`;
  if(describe&&num(g.turnEndsAt)>0&&num(g.turnEndsAt)<=Date.now())controls+=actionRow(button(ctx,T('spy.skip','Skip the timed-out turn'),'spy-skip'));
  if(vote&&g.voteEndsAt&&g.voteEndsAt<=Date.now())controls+=actionRow(button(ctx,T('spy.closeVote','Close the vote and count'),'spy-close','',false,true));
  else if(vote&&canHost(d,ctx))controls+=`<details class="mg-history"><summary>${e(ctx,T('spy.countActions','Count actions'))}</summary>${button(ctx,T('spy.closeVote','Close the vote and count'),'spy-close')}</details>`;
 }else controls=h.results()+`<div class="mg-reveal-list">${seats.map(s=>`<p>${e(ctx,names(s))} <b>${e(ctx,g.wordOf?.[s.id]||T('spy.notPublic','Not revealed'))}</b>${list(g.spySeats).includes(s.id)?e(ctx,' · '+T('spy.undercover','Undercover')):''}</p>`).join('')}</div>`;
 const meta=g.contentLocale?`<p class="spm-meta">${e(ctx,contentLanguage(g))}</p>`:'';
 const history=`<details class="mg-history"><summary>${e(ctx,T('spy.reviewDesc','This game\'s descriptions'))}</summary>${spoken.map(s=>`<p><b>${e(ctx,names(seats.find(x=>x.id===s.squadId))||s.squadName||s.byName)}</b> ${e(ctx,s.text||T('spy.skipped','skipped'))}</p>`).join('')||note(ctx,T('spy.firstLine','The first line is still coming.'))}</details>`;
 return `<div class="spm" data-spy-phase="${e(ctx,lobby?'lobby':playing?g.phase:'result')}"${turn?' data-spy-act="describe"':canVote&&!ctx.me?.isAgent?' data-spy-act="vote"':''}>${table}${reveal}${executionHtml(g,{translate:T,canReadReceipt:!!priv?.canReadReceipt,platform:'mobile'})}${controls}${meta}${history}</div>`;
}
export async function handleAction(root,d,ctx,action,data,h){
 if(!String(action).startsWith('spy-'))return false;
 const {g,seats,mine,priv}=view(d,ctx,h),turn=g.status==='playing'&&g.phase==='describe'&&mine?.alive&&g.turnSeatId===mine.id,canVote=g.status==='playing'&&g.phase==='vote'&&mine?.alive&&!!priv&&(!g.voteEndsAt||g.voteEndsAt>Date.now());
 if(action==='spy-cover'){const k=coverKey(d,g);if(covered.has(k))covered.delete(k);else covered.add(k);h.rerender();return true;}
 if(action==='spy-receipt'){await openReceipt({roomId:d.room.id,matchId:g.matchId,game:g,canReadReceipt:!!priv?.canReadReceipt,request:ctx.request,current:ctx.current||(()=>root.isConnected!==false),translate:T,notify:ctx.notify});return true;}
 if(action==='spy-select-vote'){if(canVote&&seats.some(s=>s.id===data.mgSeat&&s.alive&&s.id!==mine.id)){h.setSelection({spyVote:data.mgSeat,round:g.round});h.rerender();}return true;}
 if(action==='spy-confirm-vote'){const s=h.selection(),target=s&&s.round===g.round&&seats.find(x=>x.id===s.spyVote&&x.alive&&x.id!==mine?.id);if(canVote&&target)await h.send(ctx.me?.isAgent?{type:'suggest',action:'vote',seat:target.id}:{type:'vote',seat:target.id});return true;}
 if(['spy-describe','spy-suggest-description','spy-confirm-edited'].includes(action)){if(!turn||!priv)return true;const text=String(h.draft('spy-description')).trim();if(!text)return ctx.notify?.(T('spy.needText','Write a description first')),true;if(action==='spy-confirm-edited'){const suggestionId=h.draft('spy-confirm-id');if(list(priv.suggestions).some(s=>s.id===suggestionId&&s.action==='describe'))await h.send({type:'confirm',suggestionId,text},['spy-description','spy-confirm-id']);}else await h.send(action==='spy-suggest-description'?{type:'suggest',action:'describe',text}:{type:'describe',text},['spy-description']);return true;}
 if(action==='spy-vote'||action==='spy-suggest-vote'){if(canVote&&seats.some(s=>s.id===data.mgSeat&&s.alive&&s.id!==mine.id))await h.send(action==='spy-vote'?{type:'vote',seat:data.mgSeat}:{type:'suggest',action:'vote',seat:data.mgSeat});return true;}
 if(action==='spy-edit-suggestion'){const s=list(priv?.suggestions).find(s=>s.id===data.mgSuggestion&&s.action==='describe');if(turn&&s){h.setDraft('spy-description',s.text);h.setDraft('spy-confirm-id',s.id);h.rerender();}return true;}
 if(action==='spy-confirm'){if(list(priv?.suggestions).some(s=>s.id===data.mgSuggestion))await h.send({type:'confirm',suggestionId:data.mgSuggestion});return true;}
 if(action==='spy-companion'){if(data.mgAgent)try{await ctx.request(`/rooms/${encodeURIComponent(d.room.id)}/agents`,{method:'POST',body:{agentId:data.mgAgent}});await ctx.refresh?.();}catch(error){ctx.notify?.(error.message);}return true;}
 if(action==='spy-claim'){location.hash='#agents';return true;}
 const map={'spy-sit':'sit','spy-leave':'leave','spy-launch':'launch','spy-skip':'skip','spy-close':'closeVote'};if(map[action])await h.send({type:map[action]});return true;
}
