import { element } from './text.mjs';
import { brandIcon, providerBrand, providerLabel, specialistBrand } from './brands.mjs';
import { viewTransition } from './surface-motion.mjs';

export function modelsView({ state, request, choose, local, providers }) {
  const root = element('section', undefined, 'models-dashboard');
  const overview = element('dl', undefined, 'view-facts models-overview');
  const tabs = element('div', undefined, 'models-tabs'); tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Model categories');
  const body = element('section'); body.id = 'models-content'; body.setAttribute('role','tabpanel');
  const notice = element('p','','issue'); notice.hidden = true; notice.setAttribute('role','status');
  const footer = element('div',undefined,'review-actions');
  const buttons = new Map(), expanded = new Set(); let inventory, selected = 'orchestrator', busy = false, signature;
  const motion = viewTransition(body);
  function button(label, run, className='quiet') { const node=element('button',label,className);node.type='button';node.addEventListener('click',run);return node; }
  function facts(values) { const list=element('dl',undefined,'view-facts');for(const [key,value] of values) if(value!==undefined&&value!=='')list.append(element('dt',key),element('dd',String(value)));return list; }
  function heading(title,note) { const section=element('div',undefined,'models-section-head');section.append(element('h3',title));if(note)section.append(element('p',note,'hint'));return section; }
  function agentRow(agent) {
    const row=element('details',undefined,'model-detail-row'), summary=element('summary');row.dataset.agent=agent.kind+':'+agent.name;row.open=expanded.has(row.dataset.agent);
    const source=agent.inherits ? state() : agent;
    const title=element('span',undefined,'model-detail-label');title.append(element('strong',agent.name.replaceAll('_',' ')),element('small',agent.inherits ? 'Uses the orchestrator model' : agent.model || 'CLI default','hint'));
    const brand=agent.kind==='cli' ? specialistBrand('cli_'+agent.name) : providerBrand(source.provider);
    summary.append(brandIcon(brand),title,element('span',agent.kind==='cli'?'Local CLI':'Native specialist','hint'));row.append(summary);
    row.append(facts([['Provider',source.provider ? providerLabel(source.provider) : 'CLI default'],['Model',source.model || 'CLI default'],['Authentication',agent.auth],['Continuation',agent.continuation],['Live guidance',agent.steering?'Supported':'Unavailable'],['Structured questions',agent.questions?'Supported':'Unavailable'],['Edits',agent.kind==='cli'?(agent.allow_edits?'Reviewable patches when task scope permits':'Read only'):(agent.name==='code'?'Isolated coding when enabled':'Read only')],['Step limit',agent.max_steps||undefined],['Timeout',agent.timeout_seconds?agent.timeout_seconds+' seconds':undefined]]));
    return row;
  }
  function render() {
    const current=state(), composer=current.composer;
    for(const row of body.querySelectorAll('details[data-agent]')) { if(row.open)expanded.add(row.dataset.agent);else expanded.delete(row.dataset.agent); }
    overview.replaceChildren(...facts([['Orchestrator',current.model||'No model selected'],['Provider',current.provider?providerLabel(current.provider):'Not configured'],['Processing',composer?.readiness?.processing?.description],['Access',composer?.readiness?.issue || 'Configured'],['Work budget',composer?.budget?composer.budget.work_steps+' work steps · '+composer.budget.code_steps+' code steps':undefined]]).childNodes);
    for(const [id,node] of buttons){node.setAttribute('aria-selected',String(selected===id));node.tabIndex=selected===id?0:-1;node.disabled=busy;}
    body.setAttribute('aria-labelledby','models-tab-'+selected);body.replaceChildren();
    if(selected==='orchestrator') {
      const choices=composer?.models || [];
      body.append(heading('Allowed orchestrator models','The main assistant uses this model to coordinate and carry out your requests.'));
      for(const model of choices) {
        const row=element('div',undefined,'orchestrator-model-row'), name=element('div');name.append(brandIcon(providerBrand(model.provider)),element('strong',model.label||model.model),element('small',providerLabel(model.provider),'hint'));
        const active=current.provider===model.provider&&current.model===model.model;
        const select=button(active?'Selected':'Use model',()=>void selectModel(model));select.disabled=busy||active||!!model.unavailable||!!composer.disabled;
        row.append(name,select);if(model.unavailable)row.append(element('p',model.unavailable,'hint'));body.append(row);
      }
      if(!choices.length)body.append(element('p','No API models configured. Set up a provider or choose a local model.','hint'));
      if(composer?.disabled)body.append(element('p',composer.disabled,'hint'));
      body.append(button('Manage local models',local),button('Provider setup',providers));
    } else {
      const cli=selected==='cli';const agents=inventory?.agents?.filter(agent=>(agent.kind==='cli')===cli)||[];
      body.append(heading(cli?'CLI agents':'Native specialists',cli?'Configured for foreground tasks. CLI billing and sign-in are separate from the orchestrator.':'Specialists inherit the orchestrator unless an explicit model is assigned. Availability also depends on task scope.'));
      if(!inventory)body.append(element('p','Loading model assignments…','hint'));
      else if(!agents.length)body.append(element('p',cli?'No CLI agents configured.':'No specialist assignments available.','hint'));
      for(const agent of agents)body.append(agentRow(agent));
      if(cli)body.append(element('p','Capabilities describe adapter support. Credentials and installed CLI compatibility are checked when work starts.','hint'));
    }
  }
  async function selectModel(model) { if(busy)return;busy=true;notice.hidden=true;render();try{await choose(model); }catch(error){notice.textContent=error.message;notice.hidden=false;}finally{busy=false;render();} }
  for(const [id,label] of [['orchestrator','Orchestrator'],['native','Specialists'],['cli','CLI agents']]) {
    const tab=button(label,()=>{selected=id;render();buttons.get(id).focus();motion.reveal();});tab.id='models-tab-'+id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',body.id);buttons.set(id,tab);tabs.append(tab);
    tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const values=[...buttons.values()],at=values.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?values.length-1:(at+(event.key==='ArrowLeft'?-1:1)+values.length)%values.length;values[next].click();});
  }
  async function load() { notice.hidden=true;root.setAttribute('aria-busy','true');try { const result=await request();inventory=result.inventory;if(!inventory)throw Error('Model assignments are unavailable. Refresh to try again.');render(); }catch(error){notice.textContent=error.message;notice.hidden=false;}finally{root.removeAttribute('aria-busy')} }
  footer.append(button('Refresh',()=>void load()));root.append(overview,tabs,notice,body,footer);render();
  return {element:root,load,update(){const current=state(),next=JSON.stringify([current.provider,current.model,current.composer]);if(signature!==next){signature=next;render();}}};
}
