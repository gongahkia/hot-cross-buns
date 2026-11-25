import { element } from './text.mjs';

export function introduction({ request }) {
  const root=element('section',undefined,'introduction');root.hidden=true;root.setAttribute('aria-labelledby','introduction-title');
  const title=element('h2','Your details & time zone');title.id='introduction-title';
  const note=element('p','Edit the details you want me to use in future chats and the time zone used for schedules.','hint');
  const form=element('form'), fields={};form.hidden=true;
  function field(key,label,multiline=false){const wrapper=element('label',label),input=element(multiline?'textarea':'input');input.maxLength=2000;input.name=key;if(multiline)input.rows=3;wrapper.append(input);fields[key]=input;form.append(wrapper);return wrapper;}
  const name=field('name','What should I call you?');fields.name.autocomplete='given-name';
  const style=field('style','How would you like me to reply?');fields.style.placeholder='For example, casual and concise';
  const personal=field('personal_context','What are you working on, or what would you like help with?',true);
  const zoneLabel=element('label','Your time zone'),zone=element('select');zone.setAttribute('aria-label','Your time zone');zoneLabel.append(zone);form.append(zoneLabel);
  const issue=element('p','','issue');issue.hidden=true;issue.setAttribute('role','alert');
  const buttons=element('div',undefined,'review-actions'),save=element('button','Save and start','send'),skip=element('button','Skip introduction','quiet');save.type='submit';skip.type='button';buttons.append(save,skip);form.append(buttons);root.append(title,note,form,issue);
  let value, busy=false, context, loading=false, generation=0, pendingLoad=false, pendingForce=false;
  const detected=()=>Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  function display(next,force=false){value=next;form.hidden=false;title.hidden=false;note.hidden=false;const zones=new Set(['UTC',detected(),next.timezone==='Local'?detected():next.timezone,...(Intl.supportedValuesOf?.('timeZone')||[])]);zone.replaceChildren(...[...zones].filter(Boolean).sort().map(name=>{const option=element('option',name.replaceAll('_',' '));option.value=name;return option;}));zone.value=next.timezone==='Local'?detected():next.timezone;name.hidden=!force&&next.name_known;style.hidden=!force&&next.style_known;personal.hidden=!force&&next.context_known;root.hidden=!force&&!!next.status;}
  async function load(force=false){if(!force){form.hidden=true;title.hidden=true;note.hidden=true;}if(loading){pendingLoad=true;pendingForce=pendingForce||force;return;}loading=true;const owned=generation;try{const next=await request({action:'intro_status',timezone:detected()});if(owned===generation){issue.hidden=true;if(force)display(next,true);else if(!next.status)await request({action:'intro_start',timezone:detected()});}}catch(error){if(owned!==generation)return;root.hidden=false;issue.textContent=error.message;issue.hidden=false;}finally{loading=false;if(pendingLoad||owned!==generation){const again=pendingForce;pendingLoad=false;pendingForce=false;void load(again);}}}
  async function submit(action){if(busy||!value)return;busy=true;issue.hidden=true;const owned=generation;for(const node of form.elements)node.disabled=true;try{const next=await request({action,timezone:zone.value,revision:value.revision,...Object.fromEntries(Object.entries(fields).map(([key,node])=>[key,node.value]))});if(owned===generation){display(next);root.hidden=true;for(const node of Object.values(fields))node.value='';}}catch(error){if(owned===generation){issue.textContent=error.message;issue.hidden=false;}}finally{busy=false;for(const node of form.elements)node.disabled=false;}}
  form.addEventListener('submit',event=>{event.preventDefault();void submit('intro_save');});skip.addEventListener('click',()=>void submit('intro_skip'));
  return {element:root,observe(next){if(next===context)return;context=next;generation++;root.hidden=true;value=undefined;void load();},open(){root.hidden=false;void load(true);root.scrollIntoView?.({behavior:'smooth',block:'start'});}};
}
