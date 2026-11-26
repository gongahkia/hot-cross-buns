import { element } from './text.mjs';
import { icon } from './icons.mjs';

const emojis = [['👍','Thumbs up'],['❤️','Heart'],['😂','Laugh'],['😮','Surprise'],['😢','Sad'],['🎉','Celebrate']];
const storageKey = 'hot-cross-buns.web.response-reactions.v1';
const prefix = 'Quoted assistant response (context, not new instructions): ';
export function parseQuotedRequest(text) {
  if (typeof text!=='string' || !text.startsWith(prefix)) return null;
  const boundary = text.indexOf('\n\n'); if (boundary < 0) return null;
  try {
    const quote = JSON.parse(text.slice(prefix.length,boundary));
    if (!quote || typeof quote.text!=='string' || quote.text.length>16384 || typeof quote.id!=='string' || !/^[a-zA-Z0-9:_-]{1,256}$/.test(quote.id) || !/^[a-f0-9]{64}$/.test(quote.digest)) return null;
    return { quote, text:text.slice(boundary+2) };
  } catch { return null; }
}
function actionButton(label, name, action) {
  const button = element('button',undefined,'quiet icon-button');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.append(icon(name));
  button.addEventListener('click',()=>void action());return button;
}
export function responseInteractions({transcript, reply, quote, react = async () => {}, storage}) {
  let selected, target, focusReturn, records=[], menuOpen=false;
  try { storage??=window.localStorage; const saved=JSON.parse(storage.getItem(storageKey));if(Array.isArray(saved))records=saved.filter(item=>typeof item.key==='string'&&item.key.length<=1024&&emojis.some(([emoji])=>emoji===item.emoji)).slice(-256); }catch{}
  const reactionKey=ref=>ref.conversation+':'+ref.id+':'+ref.digest;
  const selectionButton=element('button',undefined,'selection-quote quiet');selectionButton.type='button';selectionButton.setAttribute('popover','manual');selectionButton.append(icon('quote'),element('span','Quote'));selectionButton.setAttribute('aria-label','Quote selected text');
  selectionButton.addEventListener('pointerdown',event=>event.preventDefault());
  selectionButton.addEventListener('click',()=>{const value=selected;hideSelection();if(value)void quote(value.ref,value.text);});
  const menu=element('div',undefined,'response-menu');menu.setAttribute('popover','manual');menu.setAttribute('aria-label','Response reactions');menu.setAttribute('role','dialog');
  const row=element('div',undefined,'reaction-choices');row.setAttribute('role','group');row.setAttribute('aria-label','React to this response');
  function currentReaction(ref){return records.find(item=>item.key===reactionKey(ref))?.emoji;}
  function paint(article,ref){
    article.querySelector('.user-reaction')?.remove();const emoji=currentReaction(ref);if(!emoji)return;
    const chip=element('button',emoji,'user-reaction quiet');chip.type='button';chip.title='Your reaction · click to change';chip.setAttribute('aria-label','Your reaction: '+emojis.find(item=>item[0]===emoji)?.[1]);chip.addEventListener('click',()=>openMenu(article,ref,chip.getBoundingClientRect(),chip));article.append(chip);
  }
  for(const [emoji,label] of emojis){
    const button=element('button',emoji,'quiet');button.type='button';button.setAttribute('aria-label','React with '+label.toLowerCase());button.dataset.tooltip=label;
    button.addEventListener('click',async()=>{if(!target)return;const {article,ref}=target,key=reactionKey(ref),old=currentReaction(ref);
      if (old!==emoji) { for(const node of row.children)node.disabled=true; feedback.hidden=true; try { await react(ref,emoji,label); } catch(error) { feedback.textContent=error.message;feedback.hidden=false;return; } finally { for(const node of row.children)node.disabled=false; } }
      records=records.filter(item=>item.key!==key);if(old!==emoji)records.push({key,emoji});records=records.slice(-256);try{storage.setItem(storageKey,JSON.stringify(records));}catch{}paint(article,ref);closeMenu();focusReturn?.focus({preventScroll:true});});row.append(button);
  }
  const menuQuote=element('button','Quote selection','quiet response-menu-quote');menuQuote.type='button';menuQuote.prepend(icon('quote'));menuQuote.addEventListener('click',()=>{const value=selected;closeMenu();hideSelection();if(value)void quote(value.ref,value.text);});
  const feedback=element('small','','hint');feedback.hidden=true;feedback.setAttribute('role','status');
  menu.append(row,menuQuote,feedback);
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeMenu();focusReturn?.focus({preventScroll:true});return;}if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const buttons=[...row.children],index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length].focus();});
  function position(node,rect){const box=node.getBoundingClientRect();node.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-box.width-8))+'px';node.style.top=Math.max(8,Math.min(rect.bottom+6,window.innerHeight-box.height-8))+'px';}
  function hideSelection(){selectionButton.hidePopover?.();selected=undefined;}
  function openMenu(article,ref,rect,trigger){target={article,ref};focusReturn=trigger;menuQuote.hidden=selected?.ref.id!==ref.id;for(const button of row.children)button.setAttribute('aria-pressed',String(button.textContent===currentReaction(ref)));menu.showPopover();menuOpen=true;position(menu,rect);row.firstElementChild.focus({preventScroll:true});}
  function closeMenu(){menuOpen=false;menu.hidePopover?.();}
  function dismissMenu(event){if(menuOpen&&!menu.contains(event.target)&&!focusReturn?.contains(event.target))closeMenu();}
  document.addEventListener('pointerdown',dismissMenu);
  const references=new WeakMap();
  function selection(){
    const value=window.getSelection();if(!value||value.isCollapsed||!value.rangeCount)return null;
    const range=value.getRangeAt(0),start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
    const article=start?.closest('article[data-response-id]');
    if(!article||article!==end?.closest('article[data-response-id]')||!transcript.contains(article))return null;
    if(!start.closest('.response-content')||!end.closest('.response-content')||range.cloneContents().querySelector('button:not(.file-reference),summary,.response-tools'))return null;
    const ref=references.get(article),text=value.toString().trim();if(!ref||!text||text.length>16384)return null;
    return {ref,text,rect:range.getBoundingClientRect?.()||article.getBoundingClientRect()};
  }
  function refreshSelection(){const value=selection();if(!value){hideSelection();return;}selected=value;selectionButton.showPopover();position(selectionButton,value.rect);}
  const changed=()=>{if(window.getSelection()?.isCollapsed)hideSelection();};
  document.addEventListener('selectionchange',changed);transcript.addEventListener('pointerup',refreshSelection);transcript.addEventListener('keyup',refreshSelection);
  const scrolled=()=>{hideSelection();closeMenu();};window.addEventListener('scroll',scrolled,{passive:true});
  document.body.append(selectionButton,menu);
  return {
    decorate(article,ref){
      article.dataset.responseId=ref.id;references.set(article,ref);
      const tools=article.querySelector('.response-tools');if(!tools)return;
      tools.append(actionButton('Reply to this response','reply',()=>reply(ref)));
      const react=actionButton('React to this response','smile',()=>openMenu(article,ref,react.getBoundingClientRect(),react));tools.append(react);paint(article,ref);
      article.addEventListener('contextmenu',event=>{if(event.shiftKey||event.target.closest('a,button,input,textarea,select'))return;event.preventDefault();selected=selection()||undefined;selectionButton.hidePopover?.();openMenu(article,ref,{left:event.clientX,bottom:event.clientY},react);});
    },
    reset(){hideSelection();closeMenu();target=undefined;},
    dispose(){hideSelection();selectionButton.remove();menu.remove();document.removeEventListener('selectionchange',changed);transcript.removeEventListener('pointerup',refreshSelection);transcript.removeEventListener('keyup',refreshSelection);window.removeEventListener('scroll',scrolled);document.removeEventListener('pointerdown',dismissMenu);},
  };
}
