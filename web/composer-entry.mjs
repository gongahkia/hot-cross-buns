import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
import { markdown, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { syntaxTree, indentUnit } from '@codemirror/language';

const listNewline = insertNewlineContinueMarkupCommand({ nonTightLists: false });
export function composerListKey(event, editor) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || editor.state.readOnly ||
      !/^\s*(?:[-*+] |\d+[.)] )/.test(editor.state.doc.lineAt(editor.state.selection.main.head).text)) return false;
  if (event.key === 'Enter' && event.shiftKey) return listNewline(editor);
  if (event.key === 'Tab') return (event.shiftKey ? indentLess : indentMore)(editor);
  return false;
}

export function formatSelection(state, marker) {
  const { from, to } = state.selection.main, selected = state.sliceDoc(from, to);
  const wrapped = state.sliceDoc(Math.max(0, from - marker.length), from) === marker && state.sliceDoc(to, to + marker.length) === marker;
  return wrapped ? { changes: [{ from: from - marker.length, to: from, insert: '' }, { from: to, to: to + marker.length, insert: '' }], selection: { anchor: from - marker.length, head: to - marker.length } } :
    { changes: { from, to, insert: marker + selected + marker }, selection: { anchor: from + marker.length, head: to + marker.length } };
}
export function listSelection(state, ordered = false) {
  const { from, to } = state.selection.main, first = state.doc.lineAt(from), last = state.doc.lineAt(to);
  const lines = state.sliceDoc(first.from, last.to).split('\n');
  const remove = lines.every(line => /^\s*(?:[-*+] |\d+\. )/.test(line));
  return { changes: { from: first.from, to: last.to, insert: lines.map((line, i) => remove ? line.replace(/^(\s*)(?:[-*+] |\d+\. )/, '$1') : (ordered ? `${i + 1}. ` : '- ') + line).join('\n') } };
}
const knownLogos = { 'chatgpt.com': 'openai.png', 'openai.com': 'openai.png', 'github.com': 'github.png', 'gitlab.com': 'gitlab.png', 'notion.so': 'notion.png', 'slack.com': 'slack.png' };
export function linkInfo(text) {
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.replace(/^www\./, '');
    const local = host === 'localhost' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.local');
    return { href: url.href, logo: knownLogos[host] ? '/brands/' + knownLogos[host] : url.protocol === 'https:' && !local ? url.origin + '/favicon.ico' : '' };
  } catch { return null; }
}
class LinkWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const info = linkInfo(this.text), a = document.createElement('a');
    a.href = info.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'composer-link'; a.title = info.href;
    const fallback = () => { const mark = document.createElement('span'); mark.className = 'composer-link-icon'; mark.textContent = '🌐'; mark.setAttribute('aria-hidden','true'); return mark; };
    if (info.logo) { const img = document.createElement('img'); img.src = info.logo; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.replaceWith(fallback()), { once: true }); a.append(img); }
    else a.append(fallback());
    a.append(document.createTextNode(this.text)); return a;
  }
  ignoreEvent() { return true; }
}
class LogoWidget extends LinkWidget {
  toDOM() { const link = super.toDOM(); link.lastChild.remove(); link.classList.add('composer-link-logo'); if (!link.childElementCount) link.textContent = '🌐'; link.setAttribute('aria-label', 'Open ' + this.text); return link; }
}
function decorations(view) {
  const ranges = [], selection = view.state.selection.main;
  const active = (from, to) => view.hasFocus && selection.from <= to && selection.to >= from;
  syntaxTree(view.state).iterate({ enter(node) {
    const styles = { StrongEmphasis: 'composer-bold', Emphasis: 'composer-italic', Strikethrough: 'composer-strike', InlineCode: 'composer-code' };
    if (styles[node.name]) {
      ranges.push(Decoration.mark({ class: styles[node.name] }).range(node.from, node.to));
      if (!active(node.from, node.to)) for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (['EmphasisMark', 'StrikethroughMark', 'CodeMark'].includes(child.name)) ranges.push(Decoration.replace({}).range(child.from, child.to));
      }
    }
    if (node.name === 'ListMark' && /^[-*+]$/.test(view.state.sliceDoc(node.from, node.to))) {
      let depth = 0;
      for (let parent = node.node.parent; parent; parent = parent.parent) if (['BulletList', 'OrderedList'].includes(parent.name)) depth++;
      ranges.push(Decoration.mark({ class: 'composer-bullet composer-bullet-level-' + ((depth - 1) % 3) }).range(node.from, node.to));
    }
  }});
  const text = view.state.doc.toString();
  for (const match of text.matchAll(/https?:\/\/[^\s<>]+/g)) {
    const value = match[0].replace(/[.,;!?)]+$/, ''), from = match.index, to = from + value.length;
    if (!linkInfo(value) || /Code/.test(syntaxTree(view.state).resolveInner(from, 1).name)) continue;
    if (active(from,to)) ranges.push(Decoration.widget({ widget: new LogoWidget(value), side: -1 }).range(from));
    ranges.push((active(from, to) ? Decoration.mark({ class: 'composer-url' }) : Decoration.replace({ widget: new LinkWidget(value) })).range(from, to));
  }
  return Decoration.set(ranges, true);
}
const richText = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = decorations(view); }
  update(update) { if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) this.decorations = decorations(update.view); }
}, { decorations: plugin => plugin.decorations });

export function richComposer(input) {
  const parent = document.createElement('div'); parent.className = 'rich-composer'; input.after(parent); input.hidden = true;
  const access = new Compartment(), hint = new Compartment();
  const nativeValue = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLTextAreaElement.prototype, 'value');
  const nativeSelect = input.setSelectionRange.bind(input), nativeRange = input.setRangeText.bind(input);
  let syncing = false;
  const format = marker => view => { view.dispatch(formatSelection(view.state, marker)); return true; };
  const list = ordered => view => { view.dispatch(listSelection(view.state, ordered)); return true; };
  const extensions = [
    markdown({ addKeymap: false }), indentUnit.of('    '), history(), richText, EditorView.lineWrapping,
    access.of([]), hint.of(placeholder(input.placeholder)),
    Prec.highest(keymap.of([{ key: 'Mod-b', run: format('**') }, { key: 'Mod-i', run: format('*') }, { key: 'Mod-e', run: format('`') }, { key: 'Mod-Shift-x', run: format('~~') }, { key: 'Mod-Shift-8', run: list(false) }, { key: 'Mod-Shift-7', run: list(true) }])),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({ 'aria-label': 'Message', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' }),
    EditorState.transactionFilter.of(tr => new TextEncoder().encode(tr.newDoc.toString()).length > 128 * 1024 ? [] : tr),
    Prec.highest(EditorView.domEventHandlers({
      keydown(event, editor) {
        if (event.isComposing || event.defaultPrevented) return false;
        if (composerListKey(event, editor)) { event.preventDefault(); return true; }
        const forwarded = new KeyboardEvent('keydown', { key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, isComposing: event.isComposing, bubbles: true, cancelable: true });
        input.dispatchEvent(forwarded); if (forwarded.defaultPrevented) { event.preventDefault(); return true; } return false;
      },
      paste(event) { const forwarded = new ClipboardEvent('paste', { clipboardData: event.clipboardData, bubbles: true, cancelable: true }); input.dispatchEvent(forwarded); if (forwarded.defaultPrevented) { event.preventDefault(); return true; } return false; },
      pointerdown() { input.dispatchEvent(new Event('pointerdown')); return false; },
    })),
    EditorView.updateListener.of(update => {
      if (syncing) return;
      syncing = true;
      try {
        nativeValue.set.call(input, update.state.doc.toString());
        nativeSelect(update.state.selection.main.from, update.state.selection.main.to);
        if (update.docChanged) input.dispatchEvent(new Event('input', { bubbles: true }));
        if (update.selectionSet || update.focusChanged) input.dispatchEvent(new Event('composer-selection'));
      } finally { syncing = false; }
    }),
    EditorView.theme({ '&': { fontSize: '1rem' }, '.cm-content': { fontFamily: 'inherit', padding: '0', minHeight: '3rem' }, '.cm-line': { padding: '0' }, '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7', overflow: 'auto', maxHeight: '42vh' }, '&.cm-focused': { outline: 'none' }, '.cm-placeholder': { color: '#a09f99' } }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: input.value, extensions }) });
  function sync() {
    if (syncing || nativeValue.get.call(input) === view.state.doc.toString()) return;
    syncing = true; try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: nativeValue.get.call(input) } }); } finally { syncing = false; }
  }
  Object.defineProperty(input, 'value', { configurable: true, get() { return nativeValue.get.call(input); }, set(text) { nativeValue.set.call(input, text); sync(); } });
  input.setSelectionRange = (start, end, direction) => { nativeSelect(start, end, direction); view.dispatch({ selection: { anchor: start, head: end } }); };
  input.setRangeText = (...args) => { nativeRange(...args); sync(); view.dispatch({ selection: { anchor: input.selectionStart, head: input.selectionEnd } }); };
  input.focus = () => view.focus();
  input.addEventListener('input', sync);
  let accessKey;
  return { view, reset() { view.setState(EditorState.create({ doc: input.value, extensions })); accessKey = undefined; }, update() { const key = [input.disabled, input.readOnly, input.placeholder].join(':'); if (key === accessKey) return; accessKey = key; view.dispatch({ effects: [access.reconfigure([EditorState.readOnly.of(input.disabled || input.readOnly), EditorView.editable.of(!input.disabled && !input.readOnly)]), hint.reconfigure(placeholder(input.placeholder))] }); }, destroy() { view.destroy(); parent.remove(); input.hidden = false; } };
}
