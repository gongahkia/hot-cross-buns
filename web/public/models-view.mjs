import { element } from './text.mjs';
import { brandIcon, providerBrand, providerLabel, specialistBrand } from './brands.mjs';
import { viewTransition } from './surface-motion.mjs';
import { localModelsView } from './local-models.mjs';

export function modelsView({ state, request, choose, local, providers, localRequest, assign }) {
  const root = element('section', undefined, 'models-dashboard');
  const overview = element('dl', undefined, 'view-facts models-overview');
  const tabs = element('div', undefined, 'models-tabs'); tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Model categories');
  const body = element('section'); body.id = 'models-content'; body.setAttribute('role','tabpanel');
  const notice = element('p','','issue'); notice.hidden = true; notice.setAttribute('role','status');
  const footer = element('div',undefined,'review-actions');
  const buttons = new Map(), expanded = new Set(); let inventory, selected = 'orchestrator', busy = false, signature;
  let source = 'cloud', query = '', localPane;
  const search = element('input'); search.type = 'search'; search.placeholder = 'Search models or providers'; search.setAttribute('aria-label', 'Search models or providers');
  const results = element('div'); results.setAttribute('aria-label', 'Orchestrator model catalog');
  search.addEventListener('input', () => { query = search.value; renderCatalog(); });
  const motion = viewTransition(body);
  function button(label, run, className='quiet') { const node=element('button',label,className);node.type='button';node.addEventListener('click',run);return node; }
  function facts(values) { const list=element('dl',undefined,'view-facts');for(const [key,value] of values) if(value!==undefined&&value!=='')list.append(element('dt',key),element('dd',String(value)));return list; }
  function heading(title,note) { const section=element('div',undefined,'models-section-head');section.append(element('h3',title));if(note)section.append(element('p',note,'hint'));return section; }
  const isLocal = model => model.provider === 'hot-cross-buns-local' || ['local', 'local_endpoint'].includes(model.processing);
  const matches = (...values) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
  function modelRow(model, setup = false) {
    const current = state(), active = current.provider === model.provider && current.model === model.model;
    const row = element('div', undefined, 'orchestrator-model-row'), name = element('div');
    name.append(brandIcon(providerBrand(model.provider)), element('strong', model.label || model.model), element('small', providerLabel(model.provider), 'hint'));
    const select = button(setup ? 'Set up' : active ? 'Selected' : 'Use model', () => setup ? providers(model.provider, model.model) : void selectModel(model));
    select.disabled = busy || !setup && (active || !!model.unavailable || !!current.composer?.disabled);
    select.setAttribute('aria-label', (setup ? 'Set up ' : active ? 'Selected ' : 'Use ') + (model.label || model.model) + ' · ' + providerLabel(model.provider));
    row.append(name, select);
    if (model.unavailable) row.append(element('p', model.unavailable, 'hint'));
    return row;
  }
  function renderCatalog() {
    const choices = (state().composer?.models || []).filter(model => isLocal(model) === (source === 'local'));
    for (const detail of results.querySelectorAll('details[data-provider]')) {
      if (detail.open) expanded.add(detail.dataset.provider); else expanded.delete(detail.dataset.provider);
    }
    results.replaceChildren();
    const available = choices.filter(model => matches(model.label, model.model, model.provider, providerLabel(model.provider)));
    if (available.length) {
      results.append(element('h4', 'Configured models'));
      for (const model of available) results.append(modelRow(model, !!model.unavailable));
    }
    if (source === 'local') {
      if (localRequest) {
        if (!localPane) { localPane = localModelsView({ request: localRequest }); void localPane.load(); }
        results.append(localPane.element);
      } else results.append(button('Manage local models', local));
      return;
    }
    const providersList = (inventory?.providers || []).filter(provider => matches(provider.id, providerLabel(provider.id), ...(provider.models || [])));
    if (providersList.length) results.append(element('h4', 'Browse providers'));
    for (const provider of providersList) {
      const detail = element('details', undefined, 'model-detail-row'); detail.dataset.provider = provider.id;
      detail.open = expanded.has(provider.id) || !!query.trim();
      const summary = element('summary'), name = element('span', undefined, 'model-detail-label');
      name.append(element('strong', providerLabel(provider.id)), element('small', provider.id, 'hint'));
      summary.append(brandIcon(providerBrand(provider.id)), name, element('span', provider.ready ? 'Configured' : 'Needs setup', 'hint'));
      detail.append(summary);
      for (const model of provider.models || []) {
        if (!matches(provider.id, providerLabel(provider.id), model)) continue;
        if (choices.some(choice => choice.provider === provider.id && choice.model === model)) continue;
        detail.append(modelRow({ provider: provider.id, model }, true));
      }
      const add = button('Add a model', () => providers(provider.id)); add.disabled = busy;
      detail.append(element('p', provider.issue || (provider.ready ? 'Model availability and billing depend on your provider account.' : 'Connect your API key and any required endpoint to use this provider.'), 'hint'), add);
      results.append(detail);
    }
    if (!inventory) results.append(element('p', 'Loading provider catalog…', 'hint'));
    else if (!available.length && !providersList.length) results.append(element('p', 'No models or providers match your search.', 'hint'));
  }
  function agentRow(agent) {
    const row=element('details',undefined,'model-detail-row'), summary=element('summary');row.dataset.agent=agent.kind+':'+agent.name;row.open=expanded.has(row.dataset.agent);
    const source=agent.inherits ? state() : agent;
    const title=element('span',undefined,'model-detail-label');title.append(element('strong',agent.name.replaceAll('_',' ')),element('small',agent.inherits ? 'Uses the orchestrator model' : agent.model || 'CLI default','hint'));
    const brand=agent.kind==='cli' ? specialistBrand('cli_'+agent.name) : providerBrand(source.provider);
    summary.append(brandIcon(brand),title,element('span',agent.kind==='cli'?'Local CLI':'Native specialist','hint'));row.append(summary);
    row.append(facts([['Provider',source.provider ? providerLabel(source.provider) : 'CLI default'],['Model',source.model || 'CLI default'],['Authentication',agent.auth],['Continuation',agent.continuation],['Live guidance',agent.steering?'Supported':'Unavailable'],['Structured questions',agent.questions?'Supported':'Unavailable'],['Edits',agent.kind==='cli'?(agent.allow_edits?'Reviewable patches when task scope permits':'Read only'):(agent.name==='code'?'Isolated coding when enabled':'Read only')],['Step limit',agent.max_steps||undefined],['Timeout',agent.timeout_seconds?agent.timeout_seconds+' seconds':undefined]]));
    if(agent.kind!=='cli' && agent.name!=='code' && assign) {
      const form=element('form'), label=element('label','Model for this specialist'),select=element('select');select.setAttribute('aria-label','Model for '+agent.name.replaceAll('_',' '));
      const choices=[{provider:'',model:'',label:'Use orchestrator model'},...(state().composer?.models||[]).filter(model=>!model.unavailable)];
      for(const [index,model] of choices.entries()){const option=element('option',model.label||model.model);option.value=String(index);option.selected=agent.inherits?index===0:model.provider===agent.provider&&model.model===agent.model;select.append(option)}
      const stepsLabel=element('label','Step limit'),steps=element('input');steps.type='number';steps.min='1';steps.max='32';steps.value=String(agent.max_steps||8);steps.setAttribute('aria-label','Step limit for '+agent.name.replaceAll('_',' '));
      const preview=element('div'),submit=element('button','Review assignment');submit.type='submit';label.append(select);stepsLabel.append(steps);form.append(label,stepsLabel,submit,preview);
      form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;preview.replaceChildren();try{const model=choices[Number(select.value)];const result=await assign({action:'specialist_review',role:agent.name,provider:model.provider,model:model.model,max_steps:Number(steps.value),inherit:Number(select.value)===0});if(!result.review?.id)throw Error('Assignment review is unavailable.');preview.append(element('p',(model.label||model.model)+' · '+steps.value+' steps. Applies to future tasks, including subsequent scheduled runs. Existing permissions and CLI login stay the same.'));const save=button('Save assignment',async()=>{save.disabled=true;try{const saved=await assign({action:'specialist_save',reviewId:result.review.id});if(!saved.confirmed)throw Error('Assignment was not saved.');await load();}catch(error){notice.textContent=error.message;notice.hidden=false;save.disabled=false;}});preview.append(save);}catch(error){notice.textContent=error.message;notice.hidden=false;}finally{busy=false;submit.disabled=false;}});
      select.addEventListener('change',()=>preview.replaceChildren());steps.addEventListener('input',()=>preview.replaceChildren());row.append(form);
    }
    return row;
  }
  function render() {
    const current=state(), composer=current.composer;
    for(const row of body.querySelectorAll('details[data-agent]')) { if(row.open)expanded.add(row.dataset.agent);else expanded.delete(row.dataset.agent); }
    overview.replaceChildren(...facts([['Orchestrator',current.model||'No model selected'],['Provider',current.provider?providerLabel(current.provider):'Not configured'],['Processing',composer?.readiness?.processing?.description],['Access',composer?.readiness?.issue || 'Configured'],['Work budget',composer?.budget?composer.budget.work_steps+' work steps · '+composer.budget.code_steps+' code steps':undefined]]).childNodes);
    for(const [id,node] of buttons){node.setAttribute('aria-selected',String(selected===id));node.tabIndex=selected===id?0:-1;node.disabled=busy;}
    body.setAttribute('aria-labelledby','models-tab-'+selected);body.replaceChildren();
    if(selected==='orchestrator') {
      body.append(heading('Allowed orchestrator models','The main assistant uses this model to coordinate and carry out your requests.'));
      const sources = element('div', undefined, 'models-sources'); sources.setAttribute('role', 'group'); sources.setAttribute('aria-label', 'Orchestrator model source');
      for (const [id, label] of [['cloud', 'Cloud models'], ['local', 'On this computer']]) {
        const control = button(label, () => { source = id; query = ''; search.value = ''; render(); motion.reveal(); });
        control.setAttribute('aria-pressed', String(source === id)); control.disabled = busy; sources.append(control);
      }
      body.append(sources);
      if (source === 'cloud') body.append(search);
      body.append(results); renderCatalog();
      if(composer?.disabled)body.append(element('p',composer.disabled,'hint'));
      body.append(button('Provider setup', () => providers()));
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
  async function load() { notice.hidden=true;root.setAttribute('aria-busy','true');try { const result=await request();inventory=result.inventory;if(!inventory)throw Error('Model assignments are unavailable. Refresh to try again.');if(selected==='orchestrator'&&source==='local'&&localPane)await localPane.load();render(); }catch(error){notice.textContent=error.message;notice.hidden=false;}finally{root.removeAttribute('aria-busy')} }
  footer.append(button('Refresh',()=>void load()));root.append(overview,tabs,notice,body,footer);render();
  return {element:root,load,update(){const current=state(),next=JSON.stringify([current.provider,current.model,current.composer]);if(signature!==next){signature=next;render();}}};
}
