import { element } from './text.mjs';
import { previewContent } from './attachments.mjs';
import { icon } from './icons.mjs';

export function fileReferences({ request }) {
  const sidebar = element('aside', undefined, 'file-sidebar'); sidebar.hidden = true; sidebar.setAttribute('aria-label', 'File preview');
  const header = element('div', undefined, 'section-head'), title = element('h2');
  const closeButton = element('button', undefined, 'quiet icon-button'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close file preview'); closeButton.append(icon('close'));
  const content = element('div', undefined, 'file-sidebar-content'); header.append(title, closeButton); sidebar.append(header, content);
  let context, generation = 0, timer, origin;
  function close() { clearTimeout(timer); generation++; sidebar.hidden = true; document.body.classList.remove('file-preview-open'); }
  closeButton.addEventListener('click', () => { if (origin?.isConnected) origin.focus(); close(); });
  sidebar.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeButton.click(); } });
  async function open(name, run, node, focus) {
    const owned = ++generation, selectedContext = context; origin = node;
    title.textContent = name; content.replaceChildren(element('p', 'Loading preview…', 'hint'));
    document.dispatchEvent(new window.Event('local-file-preview-open'));
    sidebar.hidden = false; document.body.classList.add('file-preview-open');
    if (focus) closeButton.focus({ preventScroll: true });
    try {
      const view = await request({ context: selectedContext, name, ...(run ? { run } : {}) });
      if (owned !== generation || context !== selectedContext) return;
      content.replaceChildren(previewContent(view));
      if (view.kind === 'text' && !view.truncated) {
        const edit = element('button','Open in Canvas','quiet'); edit.type='button';
        edit.addEventListener('click',()=>document.dispatchEvent(new window.CustomEvent('open-canvas',{detail:{id:name.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,64),title:name,language:['md','markdown'].includes(view.language)?'markdown':['html','svg','mermaid','js','ts','css','python','go'].includes(view.language)?view.language:'text',content:view.text}})));
        content.prepend(edit);
      }
    } catch (error) {
      if (owned === generation) content.replaceChildren(element('p', error.message, 'hint'));
    }
  }
  function decorate(root, run) {
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('a, button, pre, textarea, script, style, svg, .meta, .work-activity')) nodes.push(walker.currentNode);
    const pattern = /(?<![\w./-])(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:md|markdown|txt|json|jsonl|yaml|yml|toml|csv|tsv|pdf|docx|xlsx|pptx|js|mjs|jsx|ts|tsx|py|go|rs|swift|css|html|svg|png|jpe?g|webp)\b/gi;
    for (const node of nodes) {
      const matches = [...node.textContent.matchAll(pattern)]; if (!matches.length) continue;
      const fragment = document.createDocumentFragment(); let end = 0;
      for (const match of matches) {
        fragment.append(document.createTextNode(node.textContent.slice(end, match.index)));
        const button = element('button', match[0], 'file-reference'); button.type = 'button'; button.setAttribute('aria-label', 'Preview ' + match[0]);
        const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void open(match[0], run, button, false), 250); };
        button.addEventListener('pointerenter', schedule); button.addEventListener('focus', schedule);
        button.addEventListener('pointerleave', () => clearTimeout(timer)); button.addEventListener('blur', () => clearTimeout(timer));
        button.addEventListener('click', () => { clearTimeout(timer); void open(match[0], run, button, true); });
        fragment.append(button); end = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.textContent.slice(end))); node.replaceWith(fragment);
    }
  }
  return { element: sidebar, decorate, close, reset(value) { if (context !== value) close(); context = value; } };
}
