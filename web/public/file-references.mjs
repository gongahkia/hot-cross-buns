import { element } from './text.mjs';

const extension = '(?:md|markdown|txt|json|jsonl|yaml|yml|toml|csv|tsv|pdf|docx|xlsx|pptx|js|mjs|jsx|ts|tsx|py|go|rs|swift|css|html|svg|png|jpe?g|webp|gif|mp4|webm|lua|sh|sql|xml|ini|cfg)';
const pattern = new RegExp('(?<![\\w./:~-])(?:~?/)?(?:[\\w-][\\w.-]*/)*[\\w-][\\w.-]*\\.' + extension + '\\b', 'gi');
function localName(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f\\]/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || /[?#]/.test(value)) return;
  if (!new RegExp('\\.' + extension + '$', 'i').test(value)) return;
  return value;
}

export function fileReferences({ request, pane }) {
  let context, timer;
  function open(name, run, trigger, focus = true) {
    const selectedContext = context;
    pane.openFile({ key: JSON.stringify([selectedContext, run || '', name]), name, trigger, focus,
      load: page => request({ context: selectedContext, name, page, ...(run ? { run } : {}) }),
      edit: view => document.dispatchEvent(new window.CustomEvent('open-canvas', { detail: {
        id: name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64), title: name,
        language: ['md','markdown'].includes(view.language) ? 'markdown' : ['html','svg','mermaid','js','ts','css','python','go'].includes(view.language) ? view.language : 'text', content: view.text,
      } })),
    });
  }
  function bind(node, name, run) {
    node.classList.add('file-reference'); node.setAttribute('aria-label', 'Preview ' + name); node.title = 'Open file beside this chat';
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => open(name, run, node, false), 250); };
    node.addEventListener('pointerenter', schedule);
    node.addEventListener('pointerleave', () => clearTimeout(timer)); node.addEventListener('blur', () => clearTimeout(timer));
    node.addEventListener('click', event => { event.preventDefault(); clearTimeout(timer); open(name, run, node); });
  }
  function decorate(root, run) {
    for (const link of root.querySelectorAll('a:not(.file-reference)')) {
      let name; try { name = localName(decodeURIComponent(link.getAttribute('href') || '')); } catch {}
      if (name) { link.removeAttribute('target'); bind(link, name, run); }
    }
    // Inline code can carry spaces or a complete absolute path. Preserve it as
    // one reference; the host still resolves only files in the admitted scope.
    for (const code of root.querySelectorAll('code:not(pre code)')) {
      if (code.closest('a, button') || code.querySelector('button')) continue;
      const name = localName(code.textContent.trim());
      if (name) { const button = element('button', code.textContent, 'file-reference'); button.type = 'button'; bind(button, name, run); code.replaceChildren(button); }
    }
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('a, button, pre, code, textarea, script, style, svg, .meta, .work-activity')) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const matches = [...node.textContent.matchAll(pattern)].filter(match => {
        const prefix = node.textContent.slice(0, match.index).split(/\s/).at(-1);
        return !prefix.includes('://') && !prefix.includes('@');
      });
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment(); let end = 0;
      for (const match of matches) {
        fragment.append(document.createTextNode(node.textContent.slice(end, match.index)));
        const button = element('button', match[0], 'file-reference'); button.type = 'button'; bind(button, match[0], run);
        fragment.append(button); end = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.textContent.slice(end))); node.replaceWith(fragment);
    }
  }
  return { decorate, open, reset(value) { if (context !== value) { clearTimeout(timer); pane.closeFiles(); } context = value; } };
}
