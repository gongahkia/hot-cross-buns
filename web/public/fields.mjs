import { element } from './text.mjs';

export function panelField(field, name) {
  const structured = ['multi', 'budget', 'mappings'].includes(field.kind);
  const root = element(structured ? 'fieldset' : 'label', structured ? undefined : name, 'panel-field');
  if (structured) root.append(element('legend', name));
  let read;
  if (field.kind === 'multi') {
    let values = [];
    try { const parsed = JSON.parse(field.value || '[]'); if (Array.isArray(parsed)) values = parsed.filter(value => typeof value === 'string'); } catch { /* the owning backend revalidates the selection */ }
    const selected = new Set(values), options = [...(field.options || [])];
    for (const value of selected) if (!options.some(option => option.value === value)) options.push({ value, label: value + ' · unavailable' });
    const checks = [];
    for (const option of options) {
      const label = element('label'), input = element('input'); input.type = 'checkbox'; input.value = option.value; input.checked = selected.has(option.value);
      label.append(input, element('span', option.label)); root.append(label); checks.push(input);
    }
    if (!options.length) root.append(element('p', 'No connected sources available. Local files remain included.', 'hint'));
    read = () => JSON.stringify(checks.filter(input => input.checked).map(input => input.value));
  } else if (field.kind === 'mappings') {
    let values = [];
    try { const parsed = JSON.parse(field.value || '[]'); if (Array.isArray(parsed)) values = parsed; } catch { /* Go validates the submitted mappings */ }
    const rows = element('div');
    const add = element('button', 'Add folder mapping', 'quiet'); add.type = 'button';
    function row(value = {}) {
      const item = element('div', undefined, 'mapping-row');
      for (const [key, caption] of [['from', 'Original folder'], ['to', 'Replacement folder']]) {
        const label = element('label', caption), input = element('input'); input.value = typeof value[key] === 'string' ? value[key] : ''; input.required = true; input.dataset.mapping = key;
        label.append(input); item.append(label);
      }
      const remove = element('button', 'Remove', 'quiet'); remove.type = 'button'; remove.addEventListener('click', () => { item.remove(); add.disabled = rows.children.length >= 32; }); item.append(remove); rows.append(item);
      add.disabled = rows.children.length >= 32;
    }
    for (const value of values) row(value);
    add.addEventListener('click', () => { if (rows.children.length < 32) row(); });
    root.append(rows, add);
    read = () => JSON.stringify([...rows.children].map(item => ({ from: item.querySelector('[data-mapping="from"]').value, to: item.querySelector('[data-mapping="to"]').value })));
  } else if (field.kind === 'budget') {
    const values = (field.value || '').split(','), inputs = [];
    const group = element('div', undefined, 'budget-fields');
    for (const [index, part] of (field.parts || []).entries()) {
      const label = element('label', part.label), input = element('input'); input.type = 'number'; input.step = '1'; input.min = part.min; input.max = part.max; input.value = values[index] || ''; input.required = true;
      label.append(input); group.append(label); inputs.push(input);
    }
    root.append(group); read = () => inputs.map(input => input.value).join(',');
  } else {
    const control = element(field.options?.length ? 'select' : field.multiline ? 'textarea' : 'input');
    if (field.options?.length) for (const option of field.options) { const node = element('option', option.label); node.value = option.value; control.append(node); }
    if (field.secret) { control.type = 'password'; control.autocomplete = 'off'; }
    else control.value = field.value || '';
    if (!field.secret && control.tagName === 'INPUT') {
      if (field.kind === 'datetime') {
        control.type = 'datetime-local';
        const date = new Date(field.value);
        control.value = field.value && Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      }
      else if (['number', 'date', 'time', 'url', 'email'].includes(field.kind)) control.type = field.kind;
      if (field.kind === 'number') { control.min = field.min; control.max = field.max; control.step = '1'; }
    }
    if (field.limit) control.maxLength = field.limit;
    if (field.placeholder) control.placeholder = field.placeholder;
    root.append(control); read = () => field.kind === 'datetime' && control.value ? new Date(control.value).toISOString() : control.value;
  }
  if (field.read_only) for (const input of root.querySelectorAll('input, select, textarea, button')) input.disabled = true;
  if (field.help) root.append(element('small', field.help));
  return { element: root, type: field.secret ? 'password' : 'field', get value() { return read(); }, valid() { return [...root.querySelectorAll('input, select, textarea')].every(input => input.reportValidity()); } };
}
