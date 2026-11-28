import { fileTypeIcon } from './file-types.mjs';
export function mentionQuery(text, cursor) {
  const before = text.slice(0,cursor), match = /(?:^|\s)@([^\s@"]*)$/.exec(before);
  if (!match || match[1].length>256 || match[1].includes('://')) return null;
  return { from:cursor-match[1].length-1, to:cursor, query:match[1] };
}
export function fileMentions(input, { context, enabled, search, select, parent, browse }) {
  const menu = document.createElement('div'); menu.className='file-mentions'; menu.hidden=true; menu.id='file-mentions'; menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Workspace files');parent.append(menu);
  let generation=0,timer,active,items=[],index=0,dismissed;
  const editor=()=>parent.querySelector('.cm-content') || input;
  function close(){generation++;clearTimeout(timer);menu.hidden=true;active=undefined;items=[];editor().setAttribute('aria-expanded','false');editor().removeAttribute('aria-activedescendant');editor().removeAttribute('aria-controls');}
  function mark(){[...menu.querySelectorAll('[role=option]')].forEach((node,i)=>{node.setAttribute('aria-selected',String(i===index));if(i===index){editor().setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});}});}
  async function choose(i){const item=items[i],query=active;if(!item||!query)return;close();await select(item,query);}
  function update(){
    const query=enabled()&&input.selectionStart===input.selectionEnd?mentionQuery(input.value,input.selectionStart):null;
    const key=context()+':'+JSON.stringify(query);if(!query||key===dismissed){close();return;}if(active?.key===key)return;
    close();active={...query,key,context:context()};const current=++generation;menu.hidden=false;menu.textContent='Searching files…';editor().setAttribute('aria-controls',menu.id);editor().setAttribute('aria-expanded','true');
    timer=setTimeout(async()=>{try{
      const result=await search(query.query);if(current!==generation||active?.context!==context())return;
      items=result.files;index=0;menu.replaceChildren();
      for(const [i,file] of items.entries()){
        const node=document.createElement('button');node.type='button';node.id='file-mention-'+i;node.setAttribute('role','option');node.tabIndex=-1;node.title=file.path;
        const badge=document.createElement('img');badge.className='file-mention-logo';badge.src=fileTypeIcon(file.name);badge.alt='';badge.setAttribute('aria-hidden','true');badge.addEventListener('error',()=>{if(!badge.src.endsWith('/file-icons/file.png'))badge.src='/file-icons/file.png';},{once:true});
        const name=document.createElement('span');name.className='file-mention-name';name.textContent=file.name;const path=document.createElement('small');path.textContent=file.directory;node.append(badge,name,path);
        node.addEventListener('mousedown',e=>e.preventDefault());node.addEventListener('click',()=>void choose(i));menu.append(node);
      }
      if(browse){const footer=document.createElement('div');footer.className='file-mention-location';const label=document.createElement('small');label.textContent=result.root?'Files in '+(result.working||result.root):'Workspace files';const change=document.createElement('button');change.type='button';change.textContent='Change working folder';change.addEventListener('click',()=>{close();browse()});footer.append(label,change);menu.append(footer);}
      const note=document.createElement('p');note.className='hint';note.textContent=!items.length?'No matching files in this search root.':result.truncated?'Keep typing to narrow results.':'↑ ↓ choose · Enter or Tab attach · Esc dismiss';menu.append(note);mark();
    }catch(error){if(current===generation){items=[];menu.textContent=error.message;}}},100);
  }
  input.addEventListener('input',()=>{dismissed=undefined;update();});input.addEventListener('composer-selection',update);
  input.addEventListener('keydown',event=>{
    if(menu.hidden||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Escape'){dismissed=active?.key;close();event.preventDefault();event.stopPropagation();return;}
    if(['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key)&&!event.shiftKey){event.preventDefault();event.stopPropagation();if(event.key==='ArrowDown'||event.key==='ArrowUp'){if(items.length)index=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;mark();}else void choose(index);}
  },true);
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!parent.querySelector('.rich-composer')?.contains(e.target))close();});
  return {close};
}
