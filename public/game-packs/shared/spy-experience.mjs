// SPDX-License-Identifier: Apache-2.0
// Metadata-only presentation shared by the independently loaded PC/H5 game.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const fallback=(key,en,p)=>{const translate=globalThis.AiattShellI18n?.L;return typeof translate==='function'?translate(key,en,p):String(en).replace(/\{(\w+)\}/g,(m,k)=>p?.[k]??m);};
const label=(t,key,en,p)=>t('spy.experience.'+key,en,p);
const states={waiting_human:'Waiting for a player',thinking:'Preparing a model action',rule_fallback:'Rules took over',budget_paused:'Model budget paused',paused:'Model execution paused',failed:'Execution interrupted',completed:'Match completed',cancelled:'Match cancelled',timeout:'Time expired'};
const reasons={MODEL_INVALID_RESPONSE:'The model returned no usable action; rules took over.',MODEL_TIMEOUT:'The model timed out; rules handled this action.',MODEL_GLOBAL_DAILY_BUDGET:'The daily model call limit was reached.',MODEL_ACTIVITY_BUDGET:'This match reached its model call limit.',MODEL_ACTION_INVALID:'The model response was invalid; rules handled this action.',VIEW_CHANGED:'The table changed; a new rules decision was used.',RUNTIME_RECOVERED:'The previous call was unconfirmed after a restart; rules took over.',SITE_MAINTENANCE:'Model actions are paused during site maintenance.',MODEL_DISABLED:'Model execution was disabled.',MODEL_INPUT_LIMIT:'The context limit was reached; rules handled this action.'};
const reasonText=(translate,code)=>Object.hasOwn(reasons,code)?label(translate,'reason.'+code,reasons[code]):'';
const sources={human:'Player',external:'External agent',model:'Model',resident_model:'Model seat',rule:'Rules',timeout:'Timeout'};
const source=(t,value)=>{
 const kind=value==='hosted_model'?'resident_model':value;
 return label(t,'source.'+(Object.hasOwn(sources,kind)?kind:'external'),sources[kind]||sources.external);
};
export function executionHtml(game,{translate=fallback,canReadReceipt=false,platform='desktop'}={}){
 const ex=game?.execution;if(ex?.version!==1)return '';
 const state=Object.hasOwn(states,ex.state)?ex.state:'failed',seat=list(game.seats).find(s=>s.id===ex.currentSeatId);
 const receipt=canReadReceipt&&ex.receiptReady;
 return `<section class="spe-status" data-execution-state="${esc(state)}"><div class="spe-status-copy"><span class="spe-indicator" aria-hidden="true"></span><div><b role="status">${esc(label(translate,'state.'+state,states[state]))}</b>${seat&&['waiting_human','thinking'].includes(state)?`<small>${esc(label(translate,'seat','Current seat: {name}',{name:seat.name}))}</small>`:''}${reasonText(translate,ex.lastReasonCode)?`<small>${esc(reasonText(translate,ex.lastReasonCode))}</small>`:''}${Number(ex.fallbackCount)>0?`<small>${esc(label(translate,'fallbackCount','{count} actions used rules or timeouts',{count:ex.fallbackCount}))}</small>`:''}</div></div>${receipt?`<button type="button" class="${platform==='mobile'?'m-btn':'btn'} spe-receipt-button" data-spy-receipt ${platform==='mobile'?'data-mg-action="spy-receipt"':''}>${esc(label(translate,'open','View action receipt'))}<span aria-hidden="true">↗</span></button>`:''}</section>`;
}
export function seatSourceHtml(game,seatId,{translate=fallback}={}){
 const controller=list(game?.execution?.controllers).find(c=>c.squadId===seatId);if(!controller)return '';
 return `<span class="spe-source">${esc(source(translate,controller.source))}</span>`;
}
export function receiptHtml(receipt,{game,translate=fallback}={}){
 const counts=receipt?.sourceCounts||{},cost=receipt?.supplierCost||{},known=['estimated','reconciled'].includes(cost.status)&&Number.isFinite(cost.amount)&&typeof cost.currency==='string';
 const costText=known?label(translate,cost.status==='estimated'?'costEstimated':'costReconciled',cost.status==='estimated'?'Estimated: {amount} {currency}':'Reconciled: {amount} {currency}',{amount:cost.amount,currency:cost.currency}):label(translate,'costUnknown','Pending reconciliation');
 const facts=list(receipt?.facts).filter(f=>f.type==='action_accepted');
 const seats=list(game?.seats).length?list(game.seats):list(receipt?.participants),retention=receipt?.retention;
 const notes=`<p class="spe-intro">${esc(label(translate,'costHelp','Platform credits and supplier bills are separate. Pending does not mean free.'))}</p>${receipt?.externalExecution?.usageStatus==='unobservable'?`<p class="spe-intro">${esc(label(translate,'externalCost','The external agent runs on its own device. The platform cannot verify its supplier calls or charges; only observable platform calls are shown.'))}</p>`:''}${retention&&Number.isFinite(retention.from)&&Number.isFinite(retention.until)?`<p class="spe-intro">${esc(label(translate,'retention','Private process records: {from} – {until}',{from:new Date(retention.from).toLocaleDateString(globalThis.AiattShell?.locale||'en'),until:new Date(retention.until).toLocaleDateString(globalThis.AiattShell?.locale||'en')}))}</p>`:''}`;
 const countRows=['human','external','model','rule','timeout'].map(s=>`<div><dt>${esc(source(translate,s))}</dt><dd>${Number.isInteger(counts[s])&&counts[s]>=0?counts[s]:0}</dd></div>`).join('');
 return `<div class="spe-receipt"><p class="spe-verdict">${esc(label(translate,'state.'+(['completed','cancelled'].includes(receipt?.terminal)?receipt.terminal:'failed'),states[receipt?.terminal]||states.failed))}</p><p class="spe-intro">${esc(label(translate,'intro','Accepted actions only. Secret words and private reasoning are excluded.'))}</p><dl class="spe-counts">${countRows}</dl><dl class="spe-costs"><div><dt>${esc(label(translate,'credits','Platform credits charged / refunded'))}</dt><dd>${Number(receipt?.credits?.charged)||0} / ${Number(receipt?.credits?.refunded)||0}</dd></div><div><dt>${esc(label(translate,'supplierCost','Supplier cost'))}</dt><dd>${esc(costText)}</dd></div>${!known&&Number(receipt?.unknownCostCalls)>0?`<div><dt>${esc(label(translate,'unreconciled','Calls pending reconciliation'))}</dt><dd>${Number(receipt.unknownCostCalls)}</dd></div>`:''}</dl>${notes}<h3>${esc(label(translate,'actions','Action history'))}</h3><ol class="spe-timeline">${facts.map(f=>{const seat=seats.find(s=>s.id===f.squadId),action=f.actionType==='describe'?label(translate,'describe','Description'):f.actionType==='vote'?label(translate,'vote','Vote'):f.actionType==='resign'?label(translate,'resign','Resign'):f.actionType==='closeVote'?label(translate,'closeVote','Count votes'):f.actionType==='skip'?label(translate,'skip','Skip expired turn'):label(translate,'action','Action');return `<li><span class="spe-source">${esc(source(translate,f.source))}</span><div><b>${esc(seat?.name||label(translate,'seatUnknown','Table seat'))}</b><small>${esc(label(translate,'roundAction','Round {round} · {action}',{round:Number(f.round)||1,action}))}</small>${reasonText(translate,f.reasonCode)?`<small class="spe-reason">${esc(reasonText(translate,f.reasonCode))}</small>`:''}</div></li>`;}).join('')||`<li>${esc(label(translate,'empty','No accepted actions recorded.'))}</li>`}</ol></div>`;
}
export function showReceipt(receipt,{game,current,translate=fallback,document:doc=globalThis.document}={}){
 if(!doc||!current())return null;
 // Owner history can be opened without ever loading the Undercover game pack.
 if(!doc.querySelector('link[data-spy-receipt-style]')){const style=doc.createElement('link');style.rel='stylesheet';style.href='/spy-experience.css';style.dataset.spyReceiptStyle='';doc.head.appendChild(style);}
 const dialog=doc.createElement('dialog'),opener=doc.activeElement;dialog.className='spe-dialog';dialog.setAttribute('aria-label',label(translate,'title','Match action receipt'));
 let closed=false,timer,unsubscribe;
 const close=()=>{if(closed)return;closed=true;clearInterval(timer);unsubscribe?.();dialog.remove();if(current()&&opener?.isConnected!==false)opener?.focus?.({preventScroll:true});doc.dispatchEvent?.(new CustomEvent('aiatt:spy-receipt-closed'));};
 const render=()=>{if(!current())return close();const scroll=dialog.scrollTop;dialog.innerHTML=`<header><div><small>${esc(label(translate,'kicker','FROM THIS TABLE'))}</small><h2>${esc(label(translate,'title','Match action receipt'))}</h2></div><button type="button" class="spe-close" aria-label="${esc(label(translate,'close','Close'))}">×</button></header>${receiptHtml(receipt,{game,translate})}`;dialog.querySelector('.spe-close').onclick=close;dialog.scrollTop=scroll;};
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',close);render();doc.body.appendChild(dialog);dialog.showModal();dialog.querySelector('.spe-close').focus();
 timer=setInterval(()=>{if(!current())close();},200);unsubscribe=globalThis.AiattShell?.onChange?.(render);return {close};
}
export async function openReceipt({roomId,matchId,game,canReadReceipt=false,request,current=()=>true,translate=fallback,notify=()=>{},show=showReceipt}={}){
 if(!canReadReceipt||!roomId||!matchId||!current())return false;
 const path=`/rooms/${encodeURIComponent(roomId)}/game/receipt/${encodeURIComponent(matchId)}`;
 try{
  const result=await request(path,{silent:true}),receipt=result?.receipt||result?.data||result;
  if(!current()||receipt?.matchId!==matchId||!receipt.terminal)return false;
  show(receipt,{game,current,translate});
  if(!current())return false;
  // This function is called only by the human's explicit receipt button.
  await request(path+'/open',{method:'POST',body:{},silent:true});return current();
 }catch(error){if(current()&&error?.name!=='AbortError')notify(label(translate,'loadFailed','The receipt could not be loaded. Please try again.'));return false;}
}
if(typeof window!=='undefined')window.AiattSpyExperience={executionHtml,seatSourceHtml,receiptHtml,openReceipt,showReceipt};
