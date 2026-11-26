import { element } from './text.mjs';

export function eventEndpoint({ id, request, origin = location.origin }) {
  const root = element('section'), notice = element('p', '', 'hint'), content = element('div');
  notice.setAttribute('role', 'status'); root.append(notice, content); let busy = false;
  function button(label, action) { const node=element('button',label,'quiet');node.type='button';node.addEventListener('click',()=>void action());return node; }
  async function run(action, review) {
    if(busy)return;busy=true;notice.textContent='Loading…';
    try {
      const value=await request({id,action,review}); content.replaceChildren();notice.textContent='';
      if(value.title)content.append(element('h3',value.title));
      if(value.timing)content.append(element('p',value.timing,'hint'));
      if(value.review){content.append(element('p',value.effect),button('Confirm endpoint',()=>run('enable',value.review)));return;}
      content.append(element('p',value.enabled?'Endpoint enabled':'Endpoint disabled','hint'));
      if(value.path){const label=element('label','Delivery URL'),field=element('input');field.readOnly=true;field.value=origin+value.path;label.append(field);content.append(label);}
      if(value.key){const label=element('label','Signing key · copy once'),key=element('input');key.type='password';key.readOnly=true;key.value=value.key;key.autocomplete='off';label.append(key);content.append(label);const copy=element('button','Copy signing key','quiet');copy.type='button';copy.addEventListener('click',()=>void navigator.clipboard.writeText(key.value).then(()=>notice.textContent='Signing key copied.',()=>notice.textContent='Copy failed. Select the key field to copy it.'));content.append(copy);}
      content.append(element('p','Send JSON with type and data. Sign the exact body with HMAC-SHA256 over timestamp + "." + delivery ID + "." + body. Headers: X-HCB-Timestamp (Unix seconds), X-HCB-Event-ID and X-HCB-Signature (hex).','hint'),element('p','The address is local to this computer. Remote services need an explicitly configured forwarding route; HCB does not expose your laptop automatically. Duplicate deliveries are ignored.','hint'),button(value.enabled?'Rotate signing key':'Enable endpoint',()=>run('review')));
      if(value.enabled)content.append(button('Disable endpoint',()=>run('disable')));
    }catch(error){notice.textContent=error.message}finally{busy=false}
  }
  return {element:root,load:()=>run('status')};
}
