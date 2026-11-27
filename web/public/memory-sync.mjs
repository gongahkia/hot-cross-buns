import {element} from './text.mjs';
import {icon} from './icons.mjs';

export function memorySyncView({request}) {
  const root=element('details',undefined,'memory-sync-settings'),summary=element('summary');summary.append(icon('refresh-cw'),document.createTextNode('Device sync'));root.append(summary);
  const content=element('div'),error=element('p',undefined,'issue');error.hidden=true;error.setAttribute('role','alert');root.append(error,content);
  let state,busy=false,loaded=false;
  function button(label,action){const node=element('button',label,'quiet');node.type='button';node.addEventListener('click',()=>void perform(action));return node;}
  async function perform(action){if(busy)return;busy=true;error.hidden=true;root.setAttribute('aria-busy','true');for(const control of root.querySelectorAll('button,input'))control.disabled=true;
    try {state=await request(action());loaded=true;render();}
    catch(issue){error.textContent=issue.message;error.hidden=false;}
    finally{busy=false;root.removeAttribute('aria-busy');for(const control of root.querySelectorAll('button,input'))control.disabled=false;}
  }
  function render(){
    content.replaceChildren();const cfg=state.config||{},report=state.report||{};
    content.append(element('p','Keep memories, preferences and saved notes available on your other computers through Syncthing. Models, credentials, permissions and running tasks stay on each device.','hint'));
    if(cfg.folder){
      const status=element('p',cfg.enabled?(report.delivery||'Automatic sync is ready.'): 'Automatic sync is paused.');status.setAttribute('role','status');content.append(status);
      if(report.last_run&&!report.last_run.startsWith('0001-'))content.append(element('p','Last checked '+new Date(report.last_run).toLocaleString(),'hint'));
      if(report.imported_devices)content.append(element('p','This revision has been imported by '+report.imported_devices+' other HCB device'+(report.imported_devices===1?'':'s')+'.','hint'));
      for(const issue of report.issues||[])content.append(element('p',issue,'hint'));
      const actions=element('div',undefined,'memory-controls');
      if(cfg.enabled)actions.append(button('Sync now',()=>({action:'run'})));
      actions.append(button(cfg.enabled?'Pause automatic sync':'Resume automatic sync',()=>({action:cfg.enabled?'disable':'enable',revision:state.revision})),button('Refresh status',()=>({action:'status'})));content.append(actions);
      content.append(element('p','Shared folder · '+cfg.folder,'hint'));
    }
    for(const conflict of report.conflicts||[]){
      const details=element('details',undefined,'memory-sync-conflict');details.append(element('summary','Conflicting update · '+conflict.key),element('p','Both edits are preserved. Choose the version to keep; HCB will check these exact revisions before applying it.','hint'));
      for(const choice of conflict.choices){const section=element('section');section.append(element('p','Device '+choice.device.slice(0,8),'hint'),element('pre',choice.text||'Privacy metadata changed.'),button('Keep this version',()=>({action:'resolve',key:conflict.key,revision:conflict.revision,choice:choice.hash})));details.append(section);}content.append(details);
    }
    const setup=element(cfg.folder?'details':'section',undefined,'memory-sync-connection');
    setup.append(element(cfg.folder?'summary':'h3',cfg.folder?'Connection details':'Connect Syncthing'));
    const form=element('form');
    function field(label,type,value,placeholder){const wrapper=element('label',label),input=element('input');input.type=type;input.value=value||'';input.placeholder=placeholder;input.setAttribute('aria-label',label);if(type==='password')input.autocomplete='new-password';wrapper.append(input);form.append(wrapper);return input;}
    const endpoint=field('Local Syncthing API','url',cfg.endpoint||'http://127.0.0.1:8384','http://127.0.0.1:8384');endpoint.required=true;
    const folder=field('Syncthing folder ID','text',cfg.folder_id,'The ID in Syncthing’s folder settings');folder.required=true;
    const key=field('Syncthing API key','password','','Stored privately on this device');
    form.append(element('p','Choose an existing send-and-receive folder paired with your own devices. HCB writes only its hcb-memory-profile subfolder. The API key is never included in synced memory.','hint'));
    const connect=element('button','Connect and sync automatically','send');connect.type='submit';form.append(connect);form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;void perform(()=>({action:'configure',revision:state.revision,endpoint:endpoint.value,folder_id:folder.value,api_key:key.value}));});
    setup.append(form);content.append(setup);
  }
  async function load(){await perform(()=>({action:'status'}));}
  root.addEventListener('toggle',event=>{if(event.target===root&&root.open&&!loaded)void load();});
  return {element:root,load};
}
