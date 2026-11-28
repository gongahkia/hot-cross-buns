import { element } from './text.mjs';
import { icon } from './icons.mjs';

export function workspaceView({ source = '', request, selected, navigation }) {
  const root = element('section', undefined, 'workspace-view');
  root.append(element('p', navigation ? 'Search root: '+navigation.root+'. Choose a working folder without leaving this chat. File access still uses your existing permissions.' : 'Work reads a snapshot of this folder. Choosing a different folder opens a separate chat; your existing conversation, draft, and background work keep their workspace.', 'hint'));
  if(navigation?.recent_folders?.length){const recent=element('div',undefined,'workspace-folders');recent.setAttribute('aria-label','Recent folders');for(const item of navigation.recent_folders.slice(0,10)){const choice=element('button',item.path,'quiet');choice.type='button';choice.addEventListener('click',()=>void run('workspace-select',item.path));recent.append(choice)}root.append(recent);}
  const form = element('form'), label = element('label', 'Folder');
  const path = element('input'); path.value = source; path.required = true; path.setAttribute('aria-label', 'Workspace folder'); path.autocomplete = 'off'; label.append(path);
  const browse = element('button', 'Browse', 'quiet'); browse.type = 'submit'; browse.prepend(icon('folder-search'));
  const choose = element('button', 'Use this folder', 'quiet'); choose.type = 'button'; choose.prepend(icon('check'));
  const issue = element('p', '', 'hint'); issue.hidden = true; issue.setAttribute('role', 'status');
  const list = element('div', undefined, 'workspace-folders'); list.setAttribute('aria-label', 'Folders');
  form.append(label, browse, choose); root.append(form, issue, list);
  let busy = false;
  async function run(op, value) {
    if (busy) return;
    busy = true; issue.hidden = true;
    for (const node of root.querySelectorAll('button, input')) node.disabled = true;
    try {
      const result = await request({ op, path: value });
      if (op === 'workspace-select') { selected(result); return; }
      path.value = result.source; list.replaceChildren();
      if (result.parent !== result.source) add('Parent folder', result.parent, 'chevron-left');
      for (const folder of result.folders) add(folder.name, folder.path, 'folder-search');
      if (!result.folders.length) list.append(element('p', 'No visible subfolders. You can enter a hidden folder’s path above.', 'hint'));
      if (result.truncated) list.append(element('p', 'Showing the first 200 folders. Enter a path to go further.', 'hint'));
    } catch (error) { issue.textContent = error.message; issue.hidden = false; }
    finally { busy = false; for (const node of root.querySelectorAll('button, input')) node.disabled = false; }
  }
  function add(name, value, glyph) {
    const node = element('button', undefined, 'view-link'); node.type = 'button'; node.append(icon(glyph), element('span', name), icon('chevron-right'));
    node.addEventListener('click', () => void run('workspace-browse', value)); list.append(node);
  }
  form.addEventListener('submit', event => { event.preventDefault(); void run('workspace-browse', path.value); });
  choose.addEventListener('click', () => { if (path.reportValidity()) void run('workspace-select', path.value); });
  return { element: root, load: () => run('workspace-browse', source) };
}
