import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { brandIcon, providerBrand, providerLabel } from './brands.mjs';
import { animateSurfaceHeight, viewTransition } from './surface-motion.mjs';

const efforts = [['low','Low','12 work steps · 8 code steps'],['standard','Standard','24 work steps · 16 code steps'],['high','High','48 work steps · 32 code steps']];
export function modelPicker({ select, local, providers }) {
  const root = element('aside', undefined, 'model-menu'); root.id = 'model-menu'; root.setAttribute('popover', 'auto'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Model and effort');
  const layout = element('div', undefined, 'model-menu-layout'), rail = element('nav', undefined, 'model-provider-rail'); rail.setAttribute('aria-label', 'Model providers');
  const center = element('section', undefined, 'model-menu-models');
  const label = element('label', 'Search models', 'sr-only'); label.htmlFor = 'model-search';
  const search = element('input'); search.id = label.htmlFor; search.type = 'search'; search.placeholder = 'Search models…'; search.autocomplete = 'off';
  const list = element('div', undefined, 'model-menu-list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Available models');
  const reasoning = element('section', undefined, 'model-menu-effort'); reasoning.setAttribute('aria-label', 'Work effort');
  const footer = element('div', undefined, 'model-menu-footer'), feedback = element('p', '', 'hint model-menu-feedback'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
  function button(text, action, className = 'quiet') { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; }
  footer.append(button('Local models', () => { root.hidePopover(); local(); }), button('Set up a provider', () => { root.hidePopover(); providers(); }));
  center.append(label, search, list); layout.append(rail, center, reasoning); root.append(layout, feedback, footer); animateSurfaceHeight(root);
  const motion = viewTransition(list);
  let state, available = false, provider = '', busy = false, signature, returnFocus;
  async function apply(action) {
    if (busy || !available || !state?.composer || state.composer.disabled) return;
    const selected = state; busy = true; feedback.hidden = true; paint();
    try { await select(action, selected); }
    catch (error) { feedback.textContent = error.message; feedback.hidden = false; }
    finally { busy = false; paint(); if (action.action === 'effort') reasoning.querySelector('button[aria-pressed="true"]')?.focus(); else search.focus(); }
  }
  function paint() {
    if (!state) return;
    const disabled = busy || !available || !state.composer || !!state.composer.disabled;
    const values = state.composer?.models || [];
    const names = [...new Set(values.map(item => item.provider))];
    if (provider && !names.includes(provider)) provider = '';
    const filter = (value, text, mark) => { const node = button('', () => { provider = value; paint(); rail.querySelector('[aria-pressed="true"]')?.focus(); motion.reveal(); }); node.title = text; node.setAttribute('aria-label', text); node.setAttribute('aria-pressed', String(provider === value)); node.append(mark); return node; };
    rail.replaceChildren(filter('', 'All models', icon('cpu')), ...names.map(name => filter(name, providerLabel(name), brandIcon(providerBrand(name)))));
    const terms = search.value.toLowerCase().trim().split(/\s+/);
    const matches = values.filter(item => (!provider || item.provider === provider) && terms.every(term => (item.label + ' ' + item.model + ' ' + providerLabel(item.provider)).toLowerCase().includes(term)));
    list.replaceChildren(...matches.map(item => {
      const chosen = state.provider === item.provider && state.model === item.model;
      const node = button('', () => void apply({action:'model',provider:item.provider,model:item.model}), 'quiet model-menu-choice'); node.disabled = disabled || !!item.unavailable; node.setAttribute('aria-pressed', String(chosen));
      const text = element('span'); text.append(element('span', item.label || item.model), element('small', item.unavailable || providerLabel(item.provider), 'hint'));
      node.append(brandIcon(providerBrand(item.provider)), text); if (chosen) node.append(icon('check')); return node;
    }));
    if (!matches.length) list.append(element('p', values.length ? 'No matching models.' : 'No configured models. Set up a provider to begin.', 'hint'));
    reasoning.replaceChildren(element('h2', 'Work effort'), ...efforts.map(([value, title, description]) => {
      const node = button('', () => void apply({action:'effort',effort:value}), 'quiet model-menu-choice'); node.disabled = disabled; node.setAttribute('aria-pressed', String(state.composer?.effort === value));
      const text = element('span'); text.append(element('span', title), element('small', description, 'hint')); node.append(text); if (state.composer?.effort === value) node.append(icon('check')); return node;
    }));
    footer.querySelectorAll('button').forEach(node => { node.disabled = busy || !available; });
    if (state.composer?.disabled && !busy) { feedback.textContent = state.composer.disabled; feedback.hidden = false; }
  }
  search.addEventListener('input', paint);
  root.addEventListener('keydown', event => { if (!['ArrowDown','ArrowUp'].includes(event.key)) return; const nodes = [...(reasoning.contains(event.target) ? reasoning : list).querySelectorAll('button:not(:disabled)')]; if (!nodes.length) return; event.preventDefault(); const index = nodes.indexOf(document.activeElement); nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length].focus(); });
  root.addEventListener('toggle', event => { if (event.newState === 'closed') { returnFocus?.setAttribute('aria-expanded','false'); returnFocus?.focus({preventScroll:true}); } });
  return {element:root, update(value, enabled) { const next = JSON.stringify([value.context,value.composer,value.provider,value.model,enabled]); state = value; available = enabled; if (signature !== next) { signature = next; paint(); } }, open(trigger, effort = false) { returnFocus?.setAttribute('aria-expanded','false'); returnFocus = trigger; trigger?.setAttribute('aria-expanded','true'); root.showPopover(); paint(); if (effort) reasoning.querySelector('button[aria-pressed="true"]')?.focus(); else search.focus(); }};
}
