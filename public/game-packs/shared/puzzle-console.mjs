// SPDX-License-Identifier: Apache-2.0
import {puzzleBoardHtml,list} from './puzzle-tools.mjs';
import {T} from './mobile-ui.mjs';
const hues=['#b85c4b','#d0a24a','#60905b','#4f8f91','#5279a2','#88719f','#b57f98'];
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)||min));
export function puzzleConsole(options,h){
 const {template,board={},params={},prefix='puzzle',actionPrefix='puzzle',canSolve=false}=options;
 const draftField=options.draftField||((index)=>`${prefix}-cipher-${index}`);
 if(template!=='cipher')return `<div class="gp-puzzle-console" data-console="${h.esc(template)}">${puzzleBoardHtml(options,h)}</div>`;
 const length=clamp(board.length??params.length??4,1,6),colors=clamp(board.colors??params.colors??5,1,7),cursor=clamp(h.draft(prefix+'-cursor',0),0,length-1);
 const slots=Array.from({length},(_,i)=>{const color=clamp(h.draft(draftField(i),'0'),0,colors-1);return `<button type="button" class="gp-cipher-slot ${i===cursor?'is-current':''}" data-mg-action="${actionPrefix}-cipher-slot" data-mg-slot="${i}" style="--peg:${hues[color]}" aria-label="${h.esc(T('pc.slotColour','Slot {n}: colour {c}',{n:i+1,c:color+1}))}" aria-pressed="${i===cursor}"${canSolve?'':' disabled'}><small>${i+1}</small><i></i><span>${color+1}</span></button>`;}).join('');
 return `<section class="gp-puzzle-console gp-cipher-console" aria-label="${h.esc(T('pc.console','Code Breaker console'))}"><p class="gp-cipher-instruction">${h.esc(canSolve?T('pc.instruction','Tap a slot, then a colour. Colours can repeat.'):T('pc.spectator','Spectator view · the current squad sets the colour sequence.'))}</p><div class="gp-cipher-slots">${slots}</div><div class="gp-cipher-palette" role="group" aria-label="${h.esc(T('pc.pickColour','Choose a colour'))}">${Array.from({length:colors},(_,color)=>`<button type="button" style="--peg:${hues[color]}" data-mg-action="${actionPrefix}-cipher-color" data-mg-color="${color}" aria-label="${h.esc(T('pt.colourN','Colour {n}',{n:color+1}))}"${canSolve?'':' disabled'}><i></i><span>${color+1}</span></button>`).join('')}</div>${canSolve?h.actionRow(h.button(T('pt.submitSeq','Submit colour sequence'),`${actionPrefix}-guess`,'',false,true)):''}<div class="gp-cipher-trials">${list(board.guesses).map((guess,i)=>`<article><small>${String(i+1).padStart(2,'0')}</small><div>${list(guess.seq).map(color=>`<span style="--peg:${hues[clamp(color,0,colors-1)]}">${h.num(color)+1}</span>`).join('')}</div><p>${h.esc(T('pt.feedback','{exact} right place · {partial} right colour',{exact:h.num(guess.exact),partial:h.num(guess.partial)}))}</p></article>`).join('')||h.note(T('pc.trials','Feedback for each attempt shows up here.'))}</div><small class="gp-cipher-limit">${h.esc(T('pc.limit','Up to {max} attempts · "right colour" means right colour, wrong place.',{max:h.num(board.maxGuesses,10)}))}</small></section>`;
}
export function handleCipherSelection(action,data,{template,board={},params={},prefix,actionPrefix,canSolve,draftField=(index)=>`${prefix}-cipher-${index}`},h){
 if(![`${actionPrefix}-cipher-slot`,`${actionPrefix}-cipher-color`].includes(action))return false;
 if(!canSolve||template!=='cipher')return true;
 const length=Number(board.length??params.length??4),colors=Number(board.colors??params.colors??5);
 if(!Number.isInteger(length)||length<1||length>6||!Number.isInteger(colors)||colors<1||colors>7)return true;
 if(action.endsWith('-slot')){const slot=Number(data.mgSlot);if(Number.isInteger(slot)&&slot>=0&&slot<length){h.setDraft(prefix+'-cursor',slot);h.rerender();}return true;}
 const color=Number(data.mgColor),cursor=clamp(h.draft(prefix+'-cursor',0),0,length-1);
 if(Number.isInteger(color)&&color>=0&&color<colors){h.setDraft(draftField(cursor),String(color));h.setDraft(prefix+'-cursor',Math.min(length-1,cursor+1));h.rerender();}
 return true;
}
