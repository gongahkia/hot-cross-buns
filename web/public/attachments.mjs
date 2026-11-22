import { element, codeBlock } from './text.mjs';
import { icon } from './icons.mjs';

export function fileSize(bytes) {
  return bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? Math.ceil(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
}
export function previewContent(view, compact = false) {
  const node = element('div', undefined, compact ? 'attachment-thumbnail' : 'file-preview');
  if (['image', 'pdf'].includes(view.kind) && /^data:image\/(png|jpeg|webp);base64,/i.test(view.data || '')) {
    const image = element('img');
    image.src = view.data;
    image.alt = compact ? '' : view.kind === 'pdf' ? 'PDF page ' + view.page : 'Attached image';
    node.append(image);
  } else if (view.kind === 'text') {
    if (compact) node.append(element('pre', view.text.slice(0, 1600), 'attachment-snippet'));
    else node.append(view.language ? codeBlock(view.text, view.language) : element('pre', view.text, 'document-text'));
  } else if (view.kind === 'table') {
    const wrap = element('div', undefined, 'file-table-wrap'), table = element('table');
    for (const row of view.rows.slice(0, compact ? 5 : 40)) {
      const line = element('tr');
      for (const cell of row.slice(0, compact ? 3 : 12)) line.append(element('td', cell));
      table.append(line);
    }
    wrap.append(table); node.append(wrap);
  } else {
    node.append(icon('file'));
    if (!compact) node.append(element('p', view.notice || 'Preview unavailable.', 'hint'));
  }
  if (!compact && view.note) node.prepend(element('p', view.note, 'hint'));
  if (!compact && view.truncated) node.append(element('p', 'Preview shortened. Download the original for the full file.', 'hint'));
  return node;
}
export function attachmentCard(file, { load, open, remove, disabled = false }) {
  const card = element('div', undefined, 'attachment-card');
  const preview = element('button', undefined, 'attachment-open');
  preview.type = 'button';
  preview.setAttribute('aria-label', 'Preview ' + file.name);
  const placeholder = element('div', undefined, 'attachment-thumbnail attachment-loading');
  placeholder.append(icon('file'));
  const caption = element('span', undefined, 'attachment-caption');
  caption.append(element('span', file.name, 'attachment-name'), element('small', fileSize(file.size), 'attachment-size'));
  preview.append(placeholder, caption);
  preview.addEventListener('click', open);
  const close = element('button', undefined, 'attachment-remove');
  close.type = 'button';
  close.append(icon('close'));
  close.setAttribute('aria-label', 'Remove ' + file.name);
  close.title = 'Remove ' + file.name;
  close.disabled = disabled;
  close.addEventListener('click', remove);
  card.append(preview, close);
  void load().then(view => placeholder.replaceWith(previewContent(view, true))).catch(() => {
    placeholder.classList.remove('attachment-loading');
    placeholder.append(element('small', 'Preview unavailable'));
  });
  return card;
}
export function pastedFiles(clipboard) {
  const files = [...clipboard.files];
  const text = clipboard.getData('text/plain');
  if (text.length > 4000) files.push(new File([text], 'Pasted text.txt', { type: 'text/plain' }));
  return { files, text: text.length > 4000 ? '' : text };
}
