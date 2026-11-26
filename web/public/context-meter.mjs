import {element} from './text.mjs';

const number = new Intl.NumberFormat();
const matches = (policy, state) => policy?.provider === state?.provider && policy?.model === state?.model;

export function contextMeter(trigger) {
  const panel=element('aside',undefined,'context-popover');panel.id='context-details';panel.setAttribute('popover','manual');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Context');panel.tabIndex=-1;
  const title=element('h2','Context'),model=element('p','','context-model'),rows=element('dl'),note=element('p','','context-note');panel.append(title,model,rows,note);document.body.append(panel);
  trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');
  const track=document.createElementNS(ns,'circle'),fill=document.createElementNS(ns,'circle');for(const circle of [track,fill]){circle.setAttribute('cx','10');circle.setAttribute('cy','10');circle.setAttribute('r','7');}track.classList.add('context-track');fill.classList.add('context-fill');fill.setAttribute('pathLength','100');svg.append(track,fill);trigger.append(svg);
  let open=false,pinned=false,restoring=false,timer,snapshot,source,signature;
  function place(){const rect=trigger.getBoundingClientRect(),width=panel.getBoundingClientRect().width;panel.style.left=Math.max(8,Math.min(window.innerWidth-width-8,rect.right-width))+'px';panel.style.top=Math.max(8,rect.top-panel.getBoundingClientRect().height-9)+'px';}
  function hide(focus=false){clearTimeout(timer);if(!open)return;open=false;pinned=false;panel.hidePopover();trigger.setAttribute('aria-expanded','false');paint();if(focus){restoring=true;(trigger.hidden?document.getElementById('model-picker'):trigger)?.focus({preventScroll:true});restoring=false;}}
  function show(pin=false){if(trigger.hidden)return;clearTimeout(timer);pinned ||= pin;if(!open){open=true;panel.showPopover();trigger.setAttribute('aria-expanded','true');}place();}
  function deferHide(){clearTimeout(timer);if(!pinned)timer=setTimeout(()=>{if(!panel.matches(':hover')&&!trigger.matches(':hover')&&!panel.contains(document.activeElement)&&document.activeElement!==trigger)hide();},120);}
  function row(label,value){rows.append(element('dt',label),element('dd',value));}
  function paint(){
    const state=snapshot?.state,base=state?.composer?.context;
    source=base?{...base,scope:'Conversation'}:null;
    if(!state?.working&&!state?.running){const task=(snapshot?.tasks||[]).filter(t=>t.active&&matches(t.context?.last?.policy,state)).sort((a,b)=>String(b.context.last.at).localeCompare(String(a.context.last.at)))[0];if(task)source={...task.context,scope:'Active task'};}
    const policy=source?.policy,valid=matches(policy,state)&&Number.isFinite(policy?.window)&&policy.window>=1024;
    const last=valid&&matches(source?.last?.policy,state)?source.last:null;
    const limit=last?.input_limit||Math.min(policy?.max_input||Infinity,(policy?.window||0)-Math.max(256,(policy?.window||0)/16)-(policy?.output_reserve||0));
    const known=last&&Number.isFinite(last.input_tokens)&&last.input_tokens>=0&&limit>0;
    const fraction=known?Math.max(0,Math.min(1,last.input_tokens/limit)):0,percent=Math.round(fraction*100);
    const active=!!(state?.running||state?.working||snapshot?.tasks?.some(t=>t.active));
    trigger.hidden=!valid||!(active||known&&fraction>=.75||open);
    trigger.disabled=!valid;
    trigger.dataset.known=String(!!known);fill.style.strokeDasharray=`${fraction*100} 100`;
    trigger.setAttribute('aria-label',known?`Context · about ${percent}% of input capacity · ${policy.model}`:`Context · ${policy?.model||'model'} · estimate available after the next request`);
    model.textContent=policy?.model||'';rows.replaceChildren();
    if(known){row('Prepared input',`${number.format(last.input_tokens)} tokens · ${percent}%`);row('For',source.scope);}
    else row('Input estimate','Available with the next request');
    row('Input capacity',limit>0?`${number.format(Math.floor(limit))} tokens`:'Not available');row('Model window',`${number.format(policy?.window||0)} tokens`);row('Reserved output',`${number.format(last?.output_reserve||policy?.output_reserve||0)} tokens`);
    const fallback=policy?.source?.includes('fallback');note.textContent=[last?.summarized?'Earlier context was summarized.':'',fallback?'Capacity uses a conservative fallback.':'',known?'Last request estimate; your draft is counted when sent.':'', 'Saved memory is separate.'].filter(Boolean).join(' ');
    if(open)place();
  }
  trigger.addEventListener('pointerenter',()=>{clearTimeout(timer);timer=setTimeout(()=>show(),160);});trigger.addEventListener('pointerleave',deferHide);
  trigger.addEventListener('focus',()=>{if(!restoring)show();});trigger.addEventListener('blur',deferHide);
  trigger.addEventListener('click',event=>{if(pinned)hide();else{show(true);if(event.detail===0)panel.focus();}});
  panel.addEventListener('pointerenter',()=>clearTimeout(timer));panel.addEventListener('pointerleave',deferHide);panel.addEventListener('focusout',deferHide);panel.addEventListener('keydown',event=>{if(event.key==='Tab')hide(true);});
  document.addEventListener('focusin',event=>{if(open&&!panel.contains(event.target)&&!trigger.contains(event.target))hide();});
  document.addEventListener('pointerdown',event=>{if(open&&!panel.contains(event.target)&&!trigger.contains(event.target))hide();});
  document.addEventListener('keydown',event=>{if(open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();hide(panel.contains(document.activeElement));}},true);
  window.addEventListener('resize',()=>{if(open)place();});window.addEventListener('scroll',()=>{if(open)place();},true);
  return {element:panel,update(value){const changed=snapshot&&snapshot.context!==value.context;snapshot=value;if(changed)hide();const next=JSON.stringify([value.context,value.state?.provider,value.state?.model,value.state?.composer?.context,value.state?.running,value.state?.working,value.state?.dialogueActive,value.tasks?.map(t=>[t.id,t.active,t.context])]);if(signature!==next){signature=next;paint();}if(open&&trigger.disabled)hide();}};
}
