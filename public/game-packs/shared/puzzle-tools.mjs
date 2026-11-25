// SPDX-License-Identifier: Apache-2.0
// Mobile-only puzzle surfaces. The host owns identity, match/version fences and busy gates.
import {T} from './mobile-ui.mjs';
const hintText=(h,fallback)=>h?.type==='cell'?T('unified.social.corridor.hintCell','The solution includes cell {n}',{n:Number(h.idx)+1}):h?.type==='rot'?T('unified.social.corridor.hintRot','Pipe {n} should be at rotation {rotation} (0–3)',{n:Number(h.idx)+1,rotation:h.rot}):h?.type==='pos'?T('unified.social.corridor.hintPos','Position {n} of the code is colour {colour}',{n:Number(h.pos)+1,colour:Number(h.color)+1}):fallback;
export const revealedHints=record=>{const old=Array.isArray(record?.hintsRevealed)?record.hintsRevealed:[],structured=record?.hintsStructured;return Array.isArray(structured)&&structured.length===old.length?old.map((text,i)=>hintText(structured[i],text)):old;};
export const TEMPLATES = {
  lights: {get name(){return T('pz.tpl.lights.name','Lights Out');},get params(){return [['size',T('pt.size','Side length'),3,5,4],['clicks',T('pt.clicks','Starting flips'),2,8,3]];}},
  pipes: {get name(){return T('pz.tpl.pipes.name','Pipes');},get params(){return [['cols',T('pz.param.cols','Columns'),3,6,4],['rows',T('pz.param.rows','Rows'),3,5,4],['branches',T('pz.param.branches','Branches'),1,3,1]];}},
  cipher: {get name(){return T('pz.tpl.cipher.name','Code Breaker');},get params(){return [['length',T('pz.param.length','Code length'),4,6,4],['colors',T('pz.param.colors','Colours'),5,7,5]];}},
};
export const REASONS = {get cleared(){return T('reason2.cleared','All cleared');},get top(){return T('reason2.top','Reached the top (with skips)');},get surrender(){return T('reason2.surrender','Gave up');},get timeout(){return T('fg.timeout','timeout');},get abandoned(){return T('reason2.abandoned','Whole team left');},get solved(){return T('pz.solved','Solved');},get giveup(){return T('fg.gaveUp','gave up');},get exhausted(){return T('fg.exhausted','out of guesses');},get voided(){return T('reason2.voided','Challenge voided');}};
export const list = value => Array.isArray(value) ? value : [];
export const gameOf = detail => detail?.state?.game;
export const squadOf = (g,id) => list(g.squads).find(s => list(s.members).some(m => m.id === id));
export const clock = ms => {const sec=Math.max(0,Math.floor(Number(ms||0)/1000));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};
export const integer = (value,min,max) => Number.isInteger(Number(value)) && Number(value)>=min && Number(value)<=max;
export const selectedTemplate = (h,prefix) => TEMPLATES[h.draft(`${prefix}-template`,'lights')] ? h.draft(`${prefix}-template`,'lights') : 'lights';
export const message = (ctx,text) => ctx.notify?.(text);

export function puzzleParamsHtml(template,prefix,h,{disabled=false}={}) {
  return (TEMPLATES[template]?.params||[]).map(([key,label,min,max,fallback]) => `<label class="m-label">${h.esc(label)}<select class="m-input" data-mg-draft="${h.esc(prefix+'-'+key)}"${disabled?' disabled':''}>${Array.from({length:max-min+1},(_,i)=>min+i).map(value=>`<option value="${value}"${String(h.draft(prefix+'-'+key,String(fallback)))===String(value)?' selected':''}>${value}</option>`).join('')}</select></label>`).join('');
}

export function collectParams(template,prefix,h) {
  const spec=TEMPLATES[template];if(!spec)return null;
  const params={};
  for(const [key,,min,max,fallback] of spec.params){const value=h.draft(prefix+'-'+key,String(fallback));if(!integer(value,min,max))return null;params[key]=Number(value);}
  return params;
}

export function puzzleBoardHtml({template,board={},params={},prefix='puzzle',actionPrefix='puzzle',canSolve=false},h) {
  const attrs=index=>` data-mg-index="${index}"`;
  if(template==='lights')return `<div class="mg-puzzle-grid" style="--mg-cols:${Math.min(5,Math.max(3,h.num(board.size??params.size,4)))}">${list(board.cells).map((on,index)=>`<button type="button" class="mg-light ${on?'mg-light-on':''}" data-mg-action="${h.esc(actionPrefix)}-toggle"${attrs(index)} aria-label="${h.esc(on?T('pz.cellOn','Cell {n} on',{n:index+1}):T('pz.cellOff','Cell {n} off',{n:index+1}))}"${canSolve?'':' disabled'}>${on?'●':'○'}</button>`).join('')}</div>${h.note(T('pt.lightsNote','Tapping a cell also flips the cells above, below, left and right. All off wins.'))}`;
  if(template==='pipes')return `<div class="mg-puzzle-grid" style="--mg-cols:${Math.min(6,Math.max(3,h.num(board.cols??params.cols,4)))}">${list(board.masks).map((mask,index)=>`<button type="button" class="mg-pipe" data-mg-action="${h.esc(actionPrefix)}-toggle"${attrs(index)} aria-label="${h.esc(T('pt.rotate','Rotate pipe {n} clockwise',{n:index+1}))}"${canSolve?'':' disabled'}><span style="transform:rotate(${h.num(board.rots?.[index])*90}deg)">${[1,2,4,8].map((bit,dir)=>h.num(mask)&bit?`<i class="mg-pipe-arm mg-dir-${dir}"></i>`:'').join('')}<i class="mg-pipe-center"></i></span></button>`).join('')}</div>${h.note(T('pt.pipesNote','Tap a tile to rotate it 90° clockwise. Connect every pipe with no leaks to win.'))}`;
  if(template!=='cipher')return h.note(T('pt.syncing','Syncing the board.'));
  const length=Math.min(6,Math.max(1,h.num(board.length??params.length,4))),colors=Math.min(7,Math.max(1,h.num(board.colors??params.colors,5)));
  return `<div class="mg-cipher-inputs">${Array.from({length},(_,index)=>`<label class="m-label">${h.esc(T('fg.slot','Slot {n}',{n:index+1}))}<select class="m-input" data-mg-draft="${h.esc(`${prefix}-cipher-${index}`)}"${canSolve?'':' disabled'}>${Array.from({length:colors},(_,color)=>`<option value="${color}"${String(h.draft(`${prefix}-cipher-${index}`,'0'))===String(color)?' selected':''}>${h.esc(T('pt.colourN','Colour {n}',{n:color+1}))}</option>`).join('')}</select></label>`).join('')}</div>${canSolve?h.actionRow(h.button(T('pt.submitSeq','Submit colour sequence'),`${actionPrefix}-guess`,'',false,true)):''}<div class="mg-cipher-history">${list(board.guesses).map((guess,index)=>`<p><b>#${index+1} ${h.esc(list(guess.seq).map(v=>h.num(v)+1).join(' · '))}</b><span>${h.esc(T('pt.feedback','{exact} right place · {partial} right colour',{exact:h.num(guess.exact),partial:h.num(guess.partial)}))}</span></p>`).join('')}</div>${h.note(T('pt.cipherNote','Colours can repeat. Up to {max} guesses; "right colour" means the colour is right but the place is wrong.',{max:h.num(board.maxGuesses,10)}))}`;
}

export function cipherInput(part,prefix,h) {
  const board=part.board||{},params=part.params||{},length=Number(board.length??params.length??4),colors=Number(board.colors??params.colors??5);
  if(!integer(length,1,6)||!integer(colors,1,7))return null;
  const seq=Array.from({length},(_,i)=>Number(h.draft(`${prefix}-cipher-${i}`,'0')));
  return seq.every(value=>integer(value,0,colors-1))?seq:null;
}

export function revealHtml(reveal,h) {
  if(!reveal||typeof reveal!=='object')return '';
  return `<details class="mg-history"><summary>${h.esc(T('pt.reveal','Commitment reveal'))} · ${h.esc(reveal.verified?T('pt.verified','verified by the server'):T('pt.checkIt','check the result'))}</summary><p>seed ${h.esc(reveal.seed)} · salt ${h.esc(reveal.salt)}</p><p class="mg-reveal-solution">${h.esc(T('pt.solution','Solution'))} ${h.esc(JSON.stringify(reveal.solution??{}))}</p>${h.note(T('pt.howVerify','Recompute SHA-256 of salt + "|" + solution JSON and compare it with the level\'s public commitment.'))}</details>`;
}

export function inlineConfirm(prefix,kind,copy,h,extra='') {
  return `<section class="mg-result" role="group" aria-label="${h.esc(T('pt.confirmGroup','Confirm action'))}">${h.note(copy)}${h.actionRow(h.button(T('ma.confirm','Confirm'),`${prefix}-confirm-${kind}`,extra,false,true)+h.button(T('pt.cancel','Cancel'),`${prefix}-cancel`))}</section>`;
}


export async function confirmedSend(h,field,body,clear=[]) {
  const result=await h.send(body,clear);if(result!==false){h.setDraft(field,'');h.rerender();}return result;
}
