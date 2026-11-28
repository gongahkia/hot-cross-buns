import { element } from './text.mjs';
import { previewContent } from './attachments.mjs';

export function attachmentEditor({ view, state, save }) {
  if (!['image','pdf'].includes(view.kind)) return previewContent(view);
  const root=element('section',undefined,'attachment-editor'),issue=element('p','','issue');issue.setAttribute('role','alert');
  function button(text,run){const node=element('button',text,'quiet');node.type='button';node.addEventListener('click',()=>void run());return node;}
  if(view.kind==='image'){
    const tools=element('div',undefined,'attachment-edit-tools'),stage=element('div',undefined,'attachment-edit-stage'),image=element('img'),canvas=element('canvas');let start,crop;
    image.src=view.data;image.alt='Image to crop';canvas.setAttribute('aria-label','Select image crop');canvas.style.touchAction='none';
    function paint(){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);const c=crop||state.crop;if(c){ctx.strokeStyle='#2871c2';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.strokeRect(c.x*canvas.width,c.y*canvas.height,c.width*canvas.width,c.height*canvas.height);}}
    image.onload=()=>{const scale=Math.min(1,1200/image.naturalWidth);canvas.width=Math.ceil(image.naturalWidth*scale);canvas.height=Math.ceil(image.naturalHeight*scale);paint();};
    const point=event=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))];};
    canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);start=point(event)});
    canvas.addEventListener('pointermove',event=>{if(!start)return;const p=point(event);crop={x:Math.min(start[0],p[0]),y:Math.min(start[1],p[1]),width:Math.abs(p[0]-start[0]),height:Math.abs(p[1]-start[1])};paint()});
    canvas.addEventListener('pointerup',()=>{if(crop?.width>.005&&crop?.height>.005)state.crop=crop;start=crop=undefined;paint()});
    canvas.addEventListener('pointercancel',()=>{start=crop=undefined;paint()});
    tools.append(element('span','Drag over the image to crop.','hint'),button('Reset crop',()=>{delete state.crop;crop=undefined;paint()}));stage.append(image,canvas);root.append(tools,stage);
  }else{
    root.append(previewContent(view));const label=element('label','Pages to send '),pages=element('input');pages.value=state.pages||'';pages.placeholder=`All ${view.pages} pages, or 1-3, 5`;pages.setAttribute('aria-label','Pages to send');pages.oninput=()=>state.pages=pages.value;label.append(pages);root.append(label);
  }
  const apply=button('Save attachment changes',async()=>{apply.disabled=true;issue.textContent='';try{await save(state)}catch(error){issue.textContent=error.message}finally{apply.disabled=false}});apply.classList.add('send');root.append(element('p','Changes apply to a copy for this message.','hint'),issue,apply);return root;
}
